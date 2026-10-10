/**
 * GridCreateService — the grid's New button: what a new row may hold, and the
 * records new rows become when the grid is saved.
 *
 * WHAT THE GRID IS TOLD (newRowFor)
 * When a grid opens, the server says whether this user may add records, and
 * how:
 *   inline   the new record is a row at the top of the grid, filled in in
 *            its cells and saved with the grid's other changes. Only when the
 *            grid edits cells, the object offers this user at most one record
 *            type, and every field a new record must have is an editable
 *            column (or the grid fills it in: the parent of a child table, the
 *            record of a record page). Otherwise New opens Salesforce's own
 *            New form, which asks for the record type and every required field.
 *   defaults what a new record starts with, as Salesforce's New form fills
 *            it in: picklist and checkbox defaults, default values, the
 *            owner. Only for the columns a new row fills in.
 *   presets  the field the grid fills in itself, with its record: the
 *            parent of a child table, the page's record on a record page.
 * Nothing at all (null) when the grid has no New button for this user, or
 * when the parent or page record cannot be set on a new record.
 *
 * WRITING (create)
 * Nothing about the request is trusted (HR-6), as for a save:
 *   the configuration must allow new records and edit cells (read here);
 *   only the grid's editable columns are written, through the same field
 *   rules as a save (GridSaveService.fillFields); any other field is refused
 *   and named in `rejectedFields`;
 *   field-level security then removes what the user may not set on a new
 *   record, named in `strippedFields`;
 *   the user must have create permission on the object;
 *   a required column left blank is refused before anything is written.
 * The parent of a child table, or the record of a record page, is set from
 * the server's own scope (GridNesting.scopeFor, GridFilters.recordScope),
 * never from the browser, and the user must be allowed to set it on create.
 * Then one partial insert in user mode: a row that fails (sharing, a
 * validation rule, a trigger, a required field that is not a column) fails
 * alone and says why. Each row is answered by the key the browser gave it,
 * since a new row has no record Id until it is saved.
 *
 * Synchronous, unlike a save of changes (GridSaveService): new rows are typed
 * one by one, so a save holds a handful, at most MAX_ROWS, and the browser
 * needs the new Ids at once to show the records. In a grid that logs its
 * changes each record created is logged in this same transaction, all or
 * nothing.
 */
public with sharing class GridCreateService {
    /** One DML statement's worth, as for a save chunk. */
    public static final Integer MAX_ROWS = 200;

    /** What happened to one new row, by the key the browser gave it. */
    public class RowResult {
        @AuraEnabled
        public String key;
        /** The record created; null when it was not. */
        @AuraEnabled
        public Id recordId;
        @AuraEnabled
        public Boolean success = false;
        /** Why not: a cell when fieldName is set, otherwise the whole row. */
        @AuraEnabled
        public List<GridSaveError> errors = new List<GridSaveError>();
    }

    public class Result {
        @AuraEnabled
        public List<RowResult> rows = new List<RowResult>();
        /** Fields not written because they are not editable columns of this grid. */
        @AuraEnabled
        public List<String> rejectedFields = new List<String>();
        /** Fields not written because of field-level security. */
        @AuraEnabled
        public List<String> strippedFields = new List<String>();
    }

    // ------------------------------------------------------------ the new row

    /**
     * How this user adds records in this grid, here: { objectLabel, inline,
     * missing, recordTypes, defaults, names, presets, recordTypeId }; null for
     * no New button. `missing` names the required fields a new row could not
     * fill in; `names` the records the defaults and presets point to;
     * `recordTypeId` the record type its picklists follow, if they do.
     */
    public static Map<String, Object> newRowFor(
        GridConfig.Definition def,
        String parentLink,
        String parentId,
        String pageRecordId
    ) {
        if (def == null || def.allowNewRecords != true) {
            return null;
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridNesting.Scope scope = scopeOf(def, parentLink, parentId, pageRecordId);
        if (scope != null && !GridSecurity.canSetOnCreate(scope.field)) {
            return null; // as for an import: the record would not be under its parent
        }
        Map<String, GridConfig.Column> fillable = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            if (c.creatable == true) {
                fillable.put(c.field.toLowerCase(), c);
            }
        }
        List<String> missing = new List<String>();
        for (Schema.SObjectField f : objectType.getDescribe().fields.getMap().values()) {
            Schema.DescribeFieldResult d = f.getDescribe();
            String local = GridDescribe.localName(f).toLowerCase();
            if (
                neededOnCreate(f) &&
                !fillable.containsKey(local) &&
                (scope == null ||
                GridDescribe.localName(scope.field).toLowerCase() != local)
            ) {
                missing.add(d.getLabel());
            }
        }
        missing.sort();
        Integer recordTypes = recordTypesFor(objectType);

        // Salesforce's own defaults for this user's default record type.
        SObject template = objectType.newSObject(null, true);
        Map<String, Object> defaults = new Map<String, Object>();
        Map<String, String> names = new Map<String, String>();
        Map<String, Object> populated = template.getPopulatedFieldsAsMap();
        for (GridConfig.Column c : fillable.values()) {
            Schema.SObjectField f = GridDescribe.field(objectType, c.field);
            if (!populated.containsKey(GridDescribe.apiName(f))) {
                continue;
            }
            Object value = template.get(f);
            if (value == null) {
                continue;
            }
            defaults.put(c.field, GridController.toClientValue(value, f));
            if (value instanceof Id && (Id) value == UserInfo.getUserId()) {
                names.put(String.valueOf(value), UserInfo.getName()); // the owner: this user
            }
        }
        Map<String, Object> presets = new Map<String, Object>();
        if (scope != null) {
            presets.put(GridDescribe.localName(scope.field), scope.parentId);
            Map<Id, String> parentName = GridAudit.namesOf(
                scope.parentId.getSObjectType(),
                new List<Id>{ scope.parentId }
            );
            if (parentName.get(scope.parentId) != null) {
                names.put(String.valueOf(scope.parentId), parentName.get(scope.parentId));
            }
        }
        return new Map<String, Object>{
            // "New Contact": the object's own label, as Salesforce's New form is headed.
            'objectLabel' => objectType.getDescribe(SObjectDescribeOptions.DEFERRED).getLabel(),
            'inline' => def.allowInlineEdit == true &&
            missing.isEmpty() &&
            recordTypes <= 1,
            'missing' => missing,
            'recordTypes' => recordTypes,
            'defaults' => defaults,
            'names' => names,
            'presets' => presets,
            // The record type a new row gets, when the grid's picklists follow
            // it: this user's default, as Salesforce gives a new record.
            'recordTypeId' => def.byRecordType == true ? populated.get('RecordTypeId') : null
        };
    }

    /**
     * A field every new record must be given, as Salesforce's New form asks
     * for it: required, settable on create, and not filled in by the platform
     * (the owner, a default value). A text Name counts, though the schema
     * calls it optional (GridDescribe.isRequired).
     */
    @TestVisible
    private static Boolean neededOnCreate(Schema.SObjectField f) {
        Schema.DescribeFieldResult d = f.getDescribe();
        return GridSecurity.canSetOnCreate(f) &&
            GridDescribe.isRequired(d) &&
            (d.isNameField() || !d.isDefaultedOnCreate());
    }

    /** Record types this user may create, the master one aside. */
    @TestVisible
    private static Integer recordTypesFor(Schema.SObjectType objectType) {
        Integer n = 0;
        for (Schema.RecordTypeInfo rt : objectType.getDescribe().getRecordTypeInfos()) {
            if (rt.isAvailable() && !rt.isMaster()) {
                n++;
            }
        }
        return n;
    }

    // ---------------------------------------------------------------- writing

    /**
     * Create the records of up to MAX_ROWS new rows: each row is { key,
     * <field>: value, ... }. In a child table (parentLink, parentId) the
     * records are created under the parent; on a record page
     * (pageRecordId) with the Record Page Field set to that record.
     */
    public static Result create(
        String configName,
        List<Map<String, Object>> rows,
        String parentLink,
        String parentId,
        String pageRecordId
    ) {
        Result result = new Result();
        if (rows == null || rows.isEmpty()) {
            return result; // nothing asked, no DML
        }
        GridConfig.Definition def = GridConfig.load(configName);
        if (def.allowNewRecords != true || def.allowInlineEdit != true) {
            throw new GridException('This grid does not allow new records.');
        }
        if (rows.size() > MAX_ROWS) {
            throw new GridException(
                'Save at most ' + MAX_ROWS + ' new records at a time; this request has ' + rows.size() + '.'
            );
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridSecurity.requireCreate(objectType);
        GridNesting.Scope scope = scopeOf(def, parentLink, parentId, pageRecordId);
        if (scope != null && !GridSecurity.canSetOnCreate(scope.field)) {
            throw new GridException(
                'You cannot set ' +
                    GridDescribe.localName(scope.field) +
                    ' on new records, so this grid cannot create them.'
            );
        }
        Set<String> allowed = def.editableFields();
        Set<String> rejected = new Set<String>();
        List<SObject> inserts = new List<SObject>();
        List<RowResult> writing = new List<RowResult>();

        for (Map<String, Object> raw : rows) {
            RowResult r = new RowResult();
            result.rows.add(r);
            Map<String, Object> row = new Map<String, Object>();
            for (String k : (raw == null ? new Map<String, Object>() : raw).keySet()) {
                if (k == 'key') {
                    r.key = raw.get(k) == null ? null : String.valueOf(raw.get(k));
                } else if (k != 'Id') {
                    row.put(k, raw.get(k)); // a new row has no Id; one sent is ignored
                }
            }
            SObject record = objectType.newSObject();
            if (!GridSaveService.fillFields(record, row, objectType, allowed, rejected, r.errors, null)) {
                continue;
            }
            requireColumns(record, def, objectType, r.errors);
            if (!r.errors.isEmpty()) {
                continue;
            }
            if (scope != null && record.get(scope.field) == null) {
                record.put(scope.field, scope.parentId);
            }
            inserts.add(record);
            writing.add(r);
        }
        result.rejectedFields.addAll(rejected);
        if (inserts.isEmpty()) {
            return result;
        }
        GridAudit.Context audit = GridAudit.start(def); // throws if the user cannot log
        SObjectAccessDecision decision = GridSecurity.stripForCreate(inserts);
        Set<String> stripped = new Set<String>();
        for (Set<String> fields : decision.getRemovedFields().values()) {
            for (String f : fields) {
                stripped.add(GridDescribe.localName(GridDescribe.field(objectType, f))); // HR-4
            }
        }
        List<SObject> written = decision.getRecords();
        List<Database.SaveResult> outcomes = GridSecurity.insertRecords(written); // one DML statement
        for (Integer i = 0; i < outcomes.size(); i++) {
            RowResult r = writing[i];
            if (outcomes[i].isSuccess()) {
                r.success = true;
                r.recordId = outcomes[i].getId();
                continue;
            }
            for (Database.Error e : outcomes[i].getErrors()) {
                List<String> fields = e.getFields();
                if (fields == null || fields.isEmpty()) {
                    r.errors.add(new GridSaveError(null, null, e.getMessage()));
                }
                for (String f : fields == null ? new List<String>() : fields) {
                    r.errors.add(new GridSaveError(null, localNameOf(objectType, f), e.getMessage()));
                }
            }
        }
        GridAudit.write(GridAudit.creates(audit, objectType, written, outcomes)); // throws, and undoes the insert, if the log cannot be written
        result.strippedFields.addAll(stripped);
        return result;
    }

    /**
     * A column every new record must be given (neededOnCreate) must be
     * filled in on a new row: the platform does not always refuse a blank
     * one (a blank text Name becomes the record Id). A required field the
     * platform fills in itself, such as the owner, may be left blank.
     */
    private static void requireColumns(
        SObject record,
        GridConfig.Definition def,
        Schema.SObjectType objectType,
        List<GridSaveError> errors
    ) {
        for (GridConfig.Column c : def.columns) {
            if (c.adminEditable != true || c.isFormula == true || c.isChildTotal == true) {
                continue;
            }
            Schema.SObjectField f = GridDescribe.field(objectType, c.field);
            if (!neededOnCreate(f)) {
                continue;
            }
            Object value = record.get(f);
            if (value == null || (value instanceof String && String.isBlank((String) value))) {
                errors.add(new GridSaveError(null, c.field, GridSaveService.REQUIRED_MESSAGE));
            }
        }
    }

    /** The parent of a child table, or the record of a record page; null for neither. */
    private static GridNesting.Scope scopeOf(
        GridConfig.Definition def,
        String parentLink,
        String parentId,
        String pageRecordId
    ) {
        GridNesting.Scope scope = GridNesting.scopeFor(def, parentLink, parentId);
        return scope != null ? scope : GridFilters.recordScope(def, pageRecordId);
    }

    /** HR-4: report the LOCAL name, whichever build this is. */
    private static String localNameOf(Schema.SObjectType objectType, String fieldName) {
        try {
            return GridDescribe.localName(GridDescribe.field(objectType, fieldName));
        } catch (GridException e) {
            return fieldName;
        }
    }
}
