/**
 * GridDescribe — schema lookups, normalised to LOCAL names (HR-4).
 *
 * The same code sees 'rowhouse__Grid_Configuration__mdt' in the managed build
 * and 'Grid_Configuration__mdt' in the unlocked one. Every name that leaves this
 * class is a local name (no namespace prefix), and every name that comes in may
 * be either. That is the sharpest correctness hazard in a dual build, so it is
 * handled in exactly one place.
 *
 * Results are cached per transaction: describe calls are cheap individually and
 * expensive in a loop over a thousand-field object.
 */
public with sharing class GridDescribe {
    private static final String NAMESPACE = namespacePrefix();
    private static Map<String, Schema.SObjectType> typeCache = new Map<String, Schema.SObjectType>();
    private static Map<String, Map<String, Schema.SObjectField>> fieldsByLocal = new Map<String, Map<String, Schema.SObjectField>>();
    private static Map<String, Map<String, Schema.SObjectField>> fieldsByLower = new Map<String, Map<String, Schema.SObjectField>>();

    /** '' in the unlocked build, 'rowhouse' in the managed one. */
    private static String namespacePrefix() {
        String name = GridDescribe.class.getName();
        return name.contains('.') ? name.substringBefore('.') : '';
    }

    public static String localName(Schema.SObjectType objectType) {
        return objectType.getDescribe(SObjectDescribeOptions.DEFERRED).getLocalName();
    }

    public static String localName(Schema.SObjectField field) {
        return field.getDescribe().getLocalName();
    }

    /** The fully-qualified API name, for building SOQL. */
    public static String apiName(Schema.SObjectType objectType) {
        return objectType.getDescribe(SObjectDescribeOptions.DEFERRED).getName();
    }

    public static String apiName(Schema.SObjectField field) {
        return field.getDescribe().getName();
    }

    /**
     * Resolve an object by local or qualified name. Throws — never returns null —
     * and the message names the object, because a subscriber's only diagnostic is
     * the message (HR-1: no typed exceptions).
     *
     * By name, with describeSObjects: 1–4 ms. Schema.getGlobalDescribe(),
     * used before, lists every object in the org and took 67–78 ms in the dev
     * org's 1,326, more in a bigger org, on every call the
     * grid makes. The name is tried as given first, then with the package's
     * namespace, as before.
     */
    public static Schema.SObjectType typeFor(String objectName) {
        if (String.isBlank(objectName)) {
            throw new GridException('No object name was given.');
        }
        String key = objectName.trim().toLowerCase();
        if (typeCache.containsKey(key)) {
            return typeCache.get(key);
        }
        Schema.SObjectType found = describedType(key);
        if (found == null && String.isNotBlank(NAMESPACE) && !key.startsWith(NAMESPACE.toLowerCase() + '__')) {
            found = describedType(NAMESPACE.toLowerCase() + '__' + key);
        }
        if (found == null) {
            throw new GridException('Unknown object: ' + objectName);
        }
        typeCache.put(key, found);
        return found;
    }

    /** The object of this exact name, or null when there is none. */
    private static Schema.SObjectType describedType(String name) {
        try {
            List<Schema.DescribeSObjectResult> described = Schema.describeSObjects(
                new List<String>{ name },
                SObjectDescribeOptions.DEFERRED
            );
            return described.isEmpty() ? null : described[0].getSObjectType();
        } catch (InvalidParameterValueException e) {
            return null; // "The sobject provided does not exist."
        }
    }

    /** Every field on the object, keyed by LOCAL name exactly as the platform spells it. */
    public static Map<String, Schema.SObjectField> fieldsFor(String objectName) {
        Schema.SObjectType objectType = typeFor(objectName);
        load(objectType);
        return fieldsByLocal.get(apiName(objectType));
    }

    /** One field, by local or qualified name, in any case. Throws if absent. */
    public static Schema.SObjectField field(Schema.SObjectType objectType, String fieldName) {
        if (String.isBlank(fieldName)) {
            throw new GridException('No field name was given for ' + localName(objectType) + '.');
        }
        load(objectType);
        Map<String, Schema.SObjectField> lower = fieldsByLower.get(apiName(objectType));
        String key = fieldName.trim().toLowerCase();
        Schema.SObjectField found = lower.get(key);
        if (found == null && String.isNotBlank(NAMESPACE) && key.startsWith(NAMESPACE.toLowerCase() + '__')) {
            found = lower.get(key.removeStart(NAMESPACE.toLowerCase() + '__'));
        }
        if (found == null) {
            throw new GridException('Unknown field: ' + localName(objectType) + '.' + fieldName);
        }
        return found;
    }

    private static void load(Schema.SObjectType objectType) {
        String key = apiName(objectType);
        if (fieldsByLocal.containsKey(key)) {
            return;
        }
        Map<String, Schema.SObjectField> byLocal = new Map<String, Schema.SObjectField>();
        Map<String, Schema.SObjectField> byLower = new Map<String, Schema.SObjectField>();
        for (Schema.SObjectField f : objectType.getDescribe().fields.getMap().values()) {
            String local = f.getDescribe().getLocalName();
            byLocal.put(local, f);
            byLower.put(local.toLowerCase(), f);
        }
        fieldsByLocal.put(key, byLocal);
        fieldsByLower.put(key, byLower);
    }

    /**
     * The grid's cell type for a field: the column's configured type if valid,
     * otherwise derived from the platform type.
     */
    public static String cellType(Schema.SObjectField field) {
        if (isOwner(field)) {
            return 'owner';
        }
        switch on field.getDescribe().getType() {
            when BOOLEAN {
                return 'checkbox';
            }
            when CURRENCY {
                return 'currency';
            }
            when PERCENT {
                return 'percent';
            }
            when DOUBLE, INTEGER, LONG {
                return 'number';
            }
            when DATE {
                return 'date';
            }
            when DATETIME {
                return 'datetime';
            }
            when TIME {
                return 'time';
            }
            when PICKLIST {
                return 'picklist';
            }
            when MULTIPICKLIST {
                return 'multipicklist';
            }
            when EMAIL {
                return 'email';
            }
            when PHONE {
                return 'phone';
            }
            when URL {
                return 'url';
            }
            when TEXTAREA {
                return 'textarea';
            }
            when REFERENCE {
                return 'reference';
            }
            when ID {
                return 'id';
            }
            when else {
                return 'text';
            }
        }
    }

    // ------------------------------------------------------------ lookups

    /** The record owner: a User or a Queue, which the platform stores as a Group. */
    public static Boolean isOwner(Schema.SObjectField field) {
        Schema.DescribeFieldResult d = field.getDescribe();
        return d.getType() == Schema.DisplayType.REFERENCE && d.getLocalName() == 'OwnerId';
    }

    /** The objects a lookup can point to, as local names. */
    public static List<String> referenceTargets(Schema.SObjectField field) {
        List<String> out = new List<String>();
        for (Schema.SObjectType t : field.getDescribe().getReferenceTo()) {
            out.add(localName(t));
        }
        return out;
    }

    /** The field that names a record (Name, CaseNumber, Subject...), or null. */
    public static Schema.SObjectField nameField(Schema.SObjectType objectType) {
        load(objectType);
        for (Schema.SObjectField f : fieldsByLocal.get(apiName(objectType)).values()) {
            if (f.getDescribe().isNameField()) {
                return f;
            }
        }
        return null;
    }

    /**
     * The path that reads a lookup's display name in SOQL: 'Account__r.Name',
     * 'Owner.Name'. A lookup that can point to more than one object (Owner:
     * User or Queue) reads the platform's polymorphic Name, which every
     * target has. Null when the target has no name field.
     */
    public static String namePath(Schema.SObjectField field) {
        Schema.DescribeFieldResult d = field.getDescribe();
        String relationship = d.getRelationshipName();
        if (String.isBlank(relationship)) {
            return null;
        }
        List<Schema.SObjectType> targets = d.getReferenceTo();
        if (targets.size() != 1) {
            return relationship + '.Name';
        }
        Schema.SObjectField name = nameField(targets[0]);
        return name == null ? null : relationship + '.' + apiName(name);
    }

    // ------------------------------------------------- grouping and subtotals

    private static final Set<Schema.DisplayType> NUMBER_TYPES = new Set<Schema.DisplayType>{
        Schema.DisplayType.DOUBLE,
        Schema.DisplayType.CURRENCY,
        Schema.DisplayType.PERCENT,
        Schema.DisplayType.INTEGER,
        Schema.DisplayType.LONG
    };

    /**
     * Can a grid group by this field? What describe says, with two exceptions
     * measured in a Developer Edition org: a date/time reports itself as not
     * groupable, yet groups by its day, month, quarter or year through SOQL's
     * date functions, which is how the grid groups it; and the record Id,
     * which is groupable, would make one group per row.
     */
    public static Boolean isGroupable(Schema.DescribeFieldResult d) {
        if (d.getType() == Schema.DisplayType.DATETIME) {
            return !d.isCalculated();
        }
        return d.isGroupable() && d.getType() != Schema.DisplayType.ID;
    }

    /** A date or date/time: grouped by a unit, not by its exact value. */
    public static Boolean isDateLike(Schema.DescribeFieldResult d) {
        return d.getType() == Schema.DisplayType.DATE || d.getType() == Schema.DisplayType.DATETIME;
    }

    /**
     * Does a subtotal make sense for this field? Sum and average for numbers;
     * min and max for numbers and dates; count (of values that are not blank)
     * for anything SOQL can aggregate. A checkbox cannot be aggregated at all.
     */
    public static Boolean subtotalFits(String subtotal, Schema.DescribeFieldResult d) {
        if (!d.isAggregatable()) {
            return false;
        }
        Boolean isNumber = NUMBER_TYPES.contains(d.getType());
        switch on subtotal {
            when 'sum', 'average' {
                return isNumber;
            }
            when 'min', 'max' {
                return isNumber || isDateLike(d);
            }
            when 'count' {
                return true;
            }
            when else {
                return false;
            }
        }
    }

    // ------------------------------------------------- dependent picklists

    /**
     * For a dependent picklist: each active value, and the controlling values
     * it is valid for. Null when the field has no controlling field.
     *
     * Apex describe exposes the dependency only as `validFor`, a base64 bitmap
     * with one bit per controlling value, in the order the controlling field
     * lists its values (inactive ones included), most significant bit first.
     * A checkbox controller has two positions: unchecked, then checked.
     */
    public static Map<String, List<String>> dependencies(Schema.SObjectField dependent) {
        Schema.DescribeFieldResult d = dependent.getDescribe();
        Schema.SObjectField controller = d.getController();
        if (controller == null) {
            return null;
        }
        List<String> controllingValues = controllingValues(controller);
        Map<String, List<String>> out = new Map<String, List<String>>();
        for (Schema.PicklistEntry e : d.getPicklistValues()) {
            if (!e.isActive()) {
                continue;
            }
            Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(e));
            out.put(e.getValue(), validFor((String) raw.get('validFor'), controllingValues));
        }
        return out;
    }

    private static List<String> controllingValues(Schema.SObjectField controller) {
        Schema.DescribeFieldResult cd = controller.getDescribe();
        if (cd.getType() == Schema.DisplayType.BOOLEAN) {
            return new List<String>{ 'false', 'true' };
        }
        List<String> values = new List<String>();
        for (Schema.PicklistEntry e : cd.getPicklistValues()) {
            values.add(e.getValue());
        }
        return values;
    }

    /** The controlling values whose bit is set in a validFor bitmap. */
    @TestVisible
    private static List<String> validFor(String bitmap, List<String> controllingValues) {
        List<String> valid = new List<String>();
        if (String.isBlank(bitmap)) {
            return valid;
        }
        String hex = EncodingUtil.convertToHex(EncodingUtil.base64Decode(bitmap));
        for (Integer i = 0; i < controllingValues.size() && i / 8 * 2 + 1 < hex.length(); i++) {
            Integer octet =
                '0123456789abcdef'.indexOf(hex.substring(i / 8 * 2, i / 8 * 2 + 1)) * 16 +
                '0123456789abcdef'.indexOf(hex.substring(i / 8 * 2 + 1, i / 8 * 2 + 2));
            if ((octet & (128 >> Math.mod(i, 8))) != 0) {
                valid.add(controllingValues[i]);
            }
        }
        return valid;
    }

    /**
     * Required as a user sees it. The schema reports a text Name field as
     * nillable (isNillable true, isDefaultedOnCreate true), because the platform
     * fills a blank Name with the record Id; every Salesforce form still treats
     * Name as required, and so does the grid.
     */
    public static Boolean isRequired(Schema.DescribeFieldResult d) {
        if (d.getType() == Schema.DisplayType.BOOLEAN || d.isAutoNumber() || d.isCalculated()) {
            return false;
        }
        return !d.isNillable() || d.isNameField();
    }
}
