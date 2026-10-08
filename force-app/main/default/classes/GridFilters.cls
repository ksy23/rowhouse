/**
 * GridFilters — the conditions that narrow which records a grid shows: the
 * admin's Grid Filters, the user's own column filters and, on a
 * record page, the page's record.
 *
 * THREE SOURCES, ONE SHAPE
 * Each becomes a Condition: a field of the grid's object, an operator and a
 * value already checked against the field and normalised by the display rules'
 * code (GridConfig.requireFits, GridConfig.conditionValue): a picklist by its
 * API value, a date as ISO or TODAY with an offset, a lookup as an Id or
 * $User. Every Condition must hold (AND).
 *   - the admin's come from the configuration. One that cannot work stops the
 *     grid with a message naming it: skipping it would show records the admin
 *     meant to keep out (fromRecords);
 *   - the user's come from the browser, so nothing about them is trusted
 *     (HR-6): each must name a column of the grid as this user sees it that
 *     can be filtered, with an operator that fits it, at most
 *     MAX_USER_FILTERS (userConditions);
 *   - the record page's names the configuration's Record Page Field and the
 *     page's record, checked to be a record that field points to
 *     (recordCondition).
 *
 * SOQL
 * clauses() turns Conditions into WHERE conditions. The field comes from
 * describe, every value is bound, never concatenated (TC-021), and LIKE
 * wildcards in a value are escaped. The queries run in user mode
 * (GridSecurity), so a field the user cannot read could not be named: the
 * user's filters are on readable columns only, and GridConfig.forUser refuses
 * a grid whose own filters read a field the user cannot.
 *
 * HOW EACH TYPE COMPARES, as the display rules do in the browser
 *   text, picklist   SOQL's own comparison, which ignores case
 *   multi-select     equals: the same values; contains: INCLUDES; does not
 *                    contain: EXCLUDES
 *   date/time        by calendar day in the user's time zone: equals is
 *                    "from that day's midnight to the next"
 *   blank            "does not equal" and "does not contain" include blanks,
 *                    as they do in a list view filter (SOQL's != and NOT LIKE
 *                    include nulls)
 */
public with sharing class GridFilters {
    /** Filters one user may add to one grid. */
    public static final Integer MAX_USER_FILTERS = 10;

    private static final Set<String> NUMBER_TYPES = new Set<String>{ 'number', 'currency', 'percent' };
    private static final Map<String, String> OPERATOR_WORDS = new Map<String, String>{
        'equals' => 'is',
        'not_equals' => 'is not',
        'greater_than' => 'is greater than',
        'greater_or_equal' => 'is at least',
        'less_than' => 'is less than',
        'less_or_equal' => 'is at most',
        'between' => 'is between',
        'contains' => 'contains',
        'not_contains' => 'does not contain',
        'starts_with' => 'starts with',
        'is_blank' => 'is blank',
        'is_not_blank' => 'is not blank'
    };

    /** One condition, checked and normalised. */
    public class Condition {
        /** The Grid Filter's API name; null for a user's filter or the record page. */
        @AuraEnabled
        public String name;
        /** The field, local name (HR-4). */
        @AuraEnabled
        public String field;
        /** The grid's type for the field: text, picklist, date, reference and so on. */
        @AuraEnabled
        public String type;
        @AuraEnabled
        public String operator;
        /** Normalised; null for the blank tests. */
        @AuraEnabled
        public String value;
        /** Between's upper end; null otherwise. */
        @AuraEnabled
        public String valueTo;
        /** What it means, in words: "Stage is not Closed Lost". For the grid to show. */
        @AuraEnabled
        public String text;
        /** A lookup filtered by its record's name (a user's filter only). */
        public Boolean byName = false;
    }

    // ------------------------------------------------------------ the admin's

    /** Every Grid Filter of a configuration, turned off or not, in no particular order. */
    public static List<Grid_Filter__mdt> recordsOf(Grid_Configuration__mdt cfg) {
        List<Grid_Filter__mdt> out = new List<Grid_Filter__mdt>();
        for (Grid_Filter__mdt f : Grid_Filter__mdt.getAll().values()) {
            if (GridConfig.belongsTo(f.Grid_Configuration__c, cfg)) {
                out.add(f);
            }
        }
        return out;
    }

    /**
     * The conditions from these records (the org's, or a draft on the Grid
     * Admin tab), leaving out any marked Inactive, in Sort Order. Throws, naming
     * the filter, when one cannot work.
     */
    public static List<Condition> fromRecords(List<Grid_Filter__mdt> records, Schema.SObjectType objectType) {
        List<Grid_Filter__mdt> active = new List<Grid_Filter__mdt>();
        for (Grid_Filter__mdt r : records == null ? new List<Grid_Filter__mdt>() : records) {
            if (r.Inactive__c != true) {
                active.add(r);
            }
        }
        active.sort(new InOrder());
        List<Condition> out = new List<Condition>();
        for (Grid_Filter__mdt r : active) {
            try {
                Condition c = condition(objectType, r.Field_API_Name__c, r.Operator__c, r.Value__c, r.Value_To__c);
                c.name = r.DeveloperName;
                out.add(c);
            } catch (Exception e) {
                // Any failure names the filter, so the admin knows which one to fix.
                throw new GridException('Grid Filter ' + r.DeveloperName + ': ' + e.getMessage());
            }
        }
        return out;
    }

    /** One condition, checked against the schema and normalised. Throws in an admin's terms. */
    @TestVisible
    private static Condition condition(
        Schema.SObjectType objectType,
        String fieldName,
        String operator,
        String value,
        String valueTo
    ) {
        if (String.isBlank(fieldName)) {
            throw new GridException('it has no Field API Name.');
        }
        // A field of the grid's object, or of a parent record (GridPaths).
        GridPaths.FieldPath fp = GridPaths.resolve(objectType, fieldName);
        Schema.SObjectField f = fp.field;
        Schema.DescribeFieldResult d = f.getDescribe();
        if (GridDescribe.isEncrypted(d)) {
            throw new GridException(d.getLabel() + ' is encrypted, so the grid cannot filter on it.');
        }
        if (!d.isFilterable()) {
            throw new GridException(d.getLabel() + ' cannot be filtered on.');
        }
        Condition c = new Condition();
        c.field = fp.local;
        c.type = GridDescribe.cellType(f);
        c.operator = String.isBlank(operator) ? 'equals' : operator.trim().toLowerCase();
        GridConfig.requireFits(c.operator, c.type, d.getLabel());
        c.value = GridConfig.conditionValue(c.operator, c.type, d, value);
        if (c.operator == 'between') {
            if (String.isBlank(valueTo)) {
                throw new GridException('Between needs Value To, the upper end of the range.');
            }
            c.valueTo = GridConfig.conditionValue(c.operator, c.type, d, valueTo);
        }
        c.text = describe(c, d);
        return c;
    }

    // ------------------------------------------------------------ the user's

    /**
     * The user's filters, from the browser: [{ field, operator, value,
     * valueTo }]. Each must name a column of the grid as this user sees it
     * that can be filtered (HR-6). Throws on anything else, so a bad request
     * shows rather than silently widening.
     */
    public static List<Condition> userConditions(GridConfig.Definition def, List<Map<String, Object>> raw) {
        List<Condition> out = new List<Condition>();
        if (raw == null || raw.isEmpty()) {
            return out;
        }
        if (raw.size() > MAX_USER_FILTERS) {
            throw new GridException('Filter by at most ' + MAX_USER_FILTERS + ' columns.');
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            byField.put(c.field.toLowerCase(), c);
        }
        for (Map<String, Object> entry : raw) {
            String name = text(entry, 'field');
            GridConfig.Column col = name == null ? null : byField.get(name.toLowerCase());
            if (col == null || col.filterable != true) {
                throw new GridException('Cannot filter by ' + name + '.');
            }
            String operator = text(entry, 'operator');
            operator = operator == null ? 'equals' : operator.toLowerCase();
            Schema.SObjectField f = GridPaths.resolve(objectType, col.field).field;
            Condition c;
            if ((col.type == 'reference' || col.type == 'owner') && operator == 'contains') {
                // A lookup is filtered by the name the user sees.
                String term = text(entry, 'value');
                if (term == null) {
                    throw new GridException('Enter part of a name to filter ' + col.label + ' by.');
                }
                if (GridDescribe.namePath(f) == null || !GridSecurity.canReadName(f)) {
                    throw new GridException('Cannot filter ' + col.label + ' by name.');
                }
                c = new Condition();
                c.field = col.field;
                c.type = col.type;
                c.operator = operator;
                c.value = term;
                c.byName = true;
            } else {
                c = condition(objectType, col.field, operator, text(entry, 'value'), text(entry, 'valueTo'));
            }
            out.add(c);
        }
        return out;
    }

    private static String text(Map<String, Object> entry, String key) {
        Object v = entry == null ? null : entry.get(key);
        return v == null || String.isBlank(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }

    // ------------------------------------------------------------ the record page

    /**
     * The record page's condition: the configuration's Record Page
     * Field points to the page's record. Null when there is no record (an App
     * or Home page) or no Record Page Field. Throws when the record is not one
     * the field can point to, or the user cannot read the field.
     */
    public static Condition recordCondition(GridConfig.Definition def, String recordId) {
        if (String.isBlank(recordId) || String.isBlank(def.recordPageField)) {
            return null;
        }
        Schema.SObjectField f = recordField(def);
        Id parsed;
        try {
            parsed = Id.valueOf(recordId.trim());
        } catch (Exception e) {
            throw new GridException('Not a record Id: ' + recordId);
        }
        Schema.DescribeFieldResult d = f.getDescribe();
        if (!d.getReferenceTo().contains(parsed.getSObjectType())) {
            throw new GridException(
                'This grid shows ' +
                    def.objectLabel +
                    ' related to ' +
                    String.join(GridDescribe.referenceTargets(f), ' or ') +
                    ' records, and this page shows ' +
                    parsed.getSObjectType().getDescribe(SObjectDescribeOptions.DEFERRED).getLabel() +
                    '. Ask your Salesforce admin to place it on a matching page, or to clear its Record Page Field.'
            );
        }
        if (!GridSecurity.canRead(f)) {
            throw new GridException('You do not have access to ' + def.objectApiName + '.' + d.getLocalName() + '.');
        }
        Condition c = new Condition();
        c.field = d.getLocalName();
        c.type = GridDescribe.cellType(f);
        c.operator = 'equals';
        c.value = String.valueOf(parsed);
        c.text = GridConfig.defaultLabel(d) + ' is this record';
        return c;
    }

    /**
     * The scope a new record created on a record page takes: the Record Page
     * Field set to the page's record, as a child table sets its parent.
     * Null when there is none.
     */
    public static GridNesting.Scope recordScope(GridConfig.Definition def, String recordId) {
        Condition c = recordCondition(def, recordId);
        if (c == null) {
            return null;
        }
        Schema.SObjectField f = recordField(def);
        GridNesting.Scope s = new GridNesting.Scope();
        s.field = f;
        s.fieldApiName = GridDescribe.apiName(f);
        s.parentId = Id.valueOf(c.value);
        return s;
    }

    /** The configuration's Record Page Field: a lookup of its object. Throws in an admin's terms. */
    public static Schema.SObjectField recordField(GridConfig.Definition def) {
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        Schema.SObjectField f;
        try {
            f = GridDescribe.field(objectType, def.recordPageField);
        } catch (GridException e) {
            throw new GridException('Record Page Field: ' + e.getMessage());
        }
        if (f.getDescribe().getType() != Schema.DisplayType.REFERENCE) {
            throw new GridException('Record Page Field: ' + f.getDescribe().getLabel() + ' is not a lookup.');
        }
        return f;
    }

    // ------------------------------------------------------------ for a request

    /**
     * Everything that narrows one request for rows or totals: the admin's
     * filters, the user's, and the record page's (a top-level grid only; a
     * child table is narrowed by its parent instead).
     */
    public static List<Condition> forRequest(
        GridConfig.Definition def,
        List<Map<String, Object>> userFilters,
        String recordId,
        Boolean nested
    ) {
        List<Condition> out = new List<Condition>(def.filters);
        out.addAll(userConditions(def, userFilters));
        if (nested != true) {
            Condition page = recordCondition(def, recordId);
            if (page != null) {
                out.add(page);
            }
        }
        return out;
    }

    // ------------------------------------------------------------ SOQL

    /**
     * The conditions as SOQL, one string each, their values in `binds` under
     * names (flt0, flt0b...) that cannot meet any other bind's.
     */
    public static List<String> clauses(
        Schema.SObjectType objectType,
        List<Condition> conditions,
        Map<String, Object> binds
    ) {
        List<String> out = new List<String>();
        if (conditions == null) {
            return out;
        }
        for (Integer i = 0; i < conditions.size(); i++) {
            out.add(clause(objectType, conditions[i], binds, 'flt' + i));
        }
        return out;
    }

    private static String clause(Schema.SObjectType objectType, Condition c, Map<String, Object> binds, String key) {
        GridPaths.FieldPath fp = GridPaths.resolve(objectType, c.field);
        Schema.SObjectField f = fp.field;
        String api = fp.soql;
        String op = c.operator;
        if (op == 'is_blank') {
            return api + ' = null';
        }
        if (op == 'is_not_blank') {
            return api + ' != null';
        }
        if (c.byName) {
            binds.put(key, '%' + GridDataService.escapeLike(c.value) + '%');
            String own = GridDescribe.namePath(f);
            return (fp.isPath() ? String.join(fp.relationships, '.') + '.' + own : own) + ' LIKE :' + key;
        }
        String type = c.type;
        if (type == 'datetime') {
            return dateTimeClause(api, c, binds, key);
        }
        if (type == 'multipicklist') {
            binds.put(key, c.value);
            if (op == 'contains') {
                return api + ' INCLUDES (:' + key + ')';
            }
            if (op == 'not_contains') {
                return api + ' EXCLUDES (:' + key + ')';
            }
            return api + (op == 'not_equals' ? ' != :' : ' = :') + key;
        }
        if (op == 'contains' || op == 'not_contains' || op == 'starts_with') {
            String escaped = GridDataService.escapeLike(c.value);
            binds.put(key, op == 'starts_with' ? escaped + '%' : '%' + escaped + '%');
            return op == 'not_contains' ? '(NOT ' + api + ' LIKE :' + key + ')' : api + ' LIKE :' + key;
        }
        binds.put(key, bindValue(type, c.value));
        if (op == 'between') {
            binds.put(key + 'b', bindValue(type, c.valueTo));
            return '(' + api + ' >= :' + key + ' AND ' + api + ' <= :' + key + 'b)';
        }
        return api + ' ' + SOQL_OPERATORS.get(op) + ' :' + key;
    }

    private static final Map<String, String> SOQL_OPERATORS = new Map<String, String>{
        'equals' => '=',
        'not_equals' => '!=',
        'greater_than' => '>',
        'greater_or_equal' => '>=',
        'less_than' => '<',
        'less_or_equal' => '<='
    };

    /**
     * A date/time by calendar day in the user's time zone, as the grid shows
     * it: a day is from its midnight to the next (Datetime.newInstance works
     * in the user's zone).
     */
    private static String dateTimeClause(String api, Condition c, Map<String, Object> binds, String key) {
        Date day = toDate(c.value);
        Datetime dayStart = Datetime.newInstance(day, Time.newInstance(0, 0, 0, 0));
        Datetime dayAfter = Datetime.newInstance(day.addDays(1), Time.newInstance(0, 0, 0, 0));
        binds.put(key, dayStart);
        binds.put(key + 'n', dayAfter);
        switch on c.operator {
            when 'equals' {
                return '(' + api + ' >= :' + key + ' AND ' + api + ' < :' + key + 'n)';
            }
            when 'not_equals' {
                return '(' + api + ' = null OR ' + api + ' < :' + key + ' OR ' + api + ' >= :' + key + 'n)';
            }
            when 'greater_than' {
                return api + ' >= :' + key + 'n';
            }
            when 'greater_or_equal' {
                return api + ' >= :' + key;
            }
            when 'less_than' {
                return api + ' < :' + key;
            }
            when 'less_or_equal' {
                return api + ' < :' + key + 'n';
            }
            when else {
                // between, both days included
                binds.put(key + 'e', Datetime.newInstance(toDate(c.valueTo).addDays(1), Time.newInstance(0, 0, 0, 0)));
                return '(' + api + ' >= :' + key + ' AND ' + api + ' < :' + key + 'e)';
            }
        }
    }

    /** A normalised value as the Apex type SOQL compares the field with. */
    private static Object bindValue(String type, String value) {
        if (NUMBER_TYPES.contains(type)) {
            return Decimal.valueOf(value);
        }
        if (type == 'date') {
            return toDate(value);
        }
        if (type == 'time') {
            List<String> parts = value.split(':');
            return Time.newInstance(Integer.valueOf(parts[0]), Integer.valueOf(parts[1]), Integer.valueOf(parts[2]), 0);
        }
        if (type == 'checkbox') {
            return value == 'true';
        }
        if ((type == 'reference' || type == 'owner') && value == '$User') {
            return UserInfo.getUserId();
        }
        return value;
    }

    /** An ISO date, or TODAY with an offset in days, as a Date in the user's time zone. */
    @TestVisible
    private static Date toDate(String value) {
        if (value.startsWith('TODAY')) {
            String offset = value.removeStart('TODAY');
            return String.isBlank(offset)
                ? Date.today()
                : Date.today().addDays(Integer.valueOf(offset.removeStart('+')));
        }
        return Date.valueOf(value);
    }

    // ------------------------------------------------------------ words

    /** "Stage is not Closed Lost": what a condition means, for the grid to show. */
    @TestVisible
    private static String describe(Condition c, Schema.DescribeFieldResult d) {
        String out = GridConfig.defaultLabel(d) + ' ' + OPERATOR_WORDS.get(c.operator);
        if (c.value == null) {
            return out;
        }
        if (c.type == 'checkbox' && c.operator == 'equals') {
            return GridConfig.defaultLabel(d) + (c.value == 'true' ? ' is checked' : ' is not checked');
        }
        if (c.type == 'checkbox' && c.operator == 'not_equals') {
            return GridConfig.defaultLabel(d) + (c.value == 'true' ? ' is not checked' : ' is checked');
        }
        out += ' ' + shown(c.value, c.type, d);
        if (c.operator == 'between') {
            out += ' and ' + shown(c.valueTo, c.type, d);
        }
        return out;
    }

    private static String shown(String value, String type, Schema.DescribeFieldResult d) {
        // $User and TODAY mean something only for a lookup and a date: a text
        // filter "starts with TODAYS" is just text.
        if ((type == 'reference' || type == 'owner') && value == '$User') {
            return 'me';
        }
        if ((type == 'date' || type == 'datetime') && value.startsWith('TODAY')) {
            String offset = value.removeStart('TODAY');
            if (String.isBlank(offset)) {
                return 'today';
            }
            Integer days = Integer.valueOf(offset.removeStart('+'));
            return String.valueOf(Math.abs(days)) +
                (Math.abs(days) == 1 ? ' day ' : ' days ') +
                (days < 0 ? 'ago' : 'from today');
        }
        if (type == 'picklist' || type == 'multipicklist') {
            List<String> labels = new List<String>();
            for (String part : value.split(';')) {
                String label = part;
                for (Schema.PicklistEntry e : d.getPicklistValues()) {
                    if (e.getValue() == part) {
                        label = e.getLabel();
                        break;
                    }
                }
                labels.add(label);
            }
            return String.join(labels, ', ');
        }
        return value;
    }

    private class InOrder implements Comparator<Grid_Filter__mdt> {
        public Integer compare(Grid_Filter__mdt a, Grid_Filter__mdt b) {
            Decimal x = a.Sort_Order__c == null ? 9999 : a.Sort_Order__c;
            Decimal y = b.Sort_Order__c == null ? 9999 : b.Sort_Order__c;
            if (x != y) {
                return x < y ? -1 : 1;
            }
            return a.DeveloperName.compareTo(b.DeveloperName);
        }
    }
}
