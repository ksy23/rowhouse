/**
 * GridNesting — child tables under a grid's rows.
 *
 * A Grid Child Table record says: under each row of this grid, show a tab with
 * that grid, limited to the records whose Relationship Field points to the
 * row. A child grid is an ordinary grid in every other way: its own columns,
 * editing, mass actions, import and grouping, from its own configuration.
 *
 * THREE JOBS
 *   childrenOf()    — the tabs a configuration lists, each checked against the
 *                     schema. A tab an admin got wrong (no such configuration,
 *                     a field that is not a lookup to the parent's object) is
 *                     left out with a warning, as for format rules.
 *   scopeFor()      — the parent filter for a request from a child grid. The
 *                     browser names the tab and the parent record; nothing
 *                     else about the filter comes from the browser (HR-6). The
 *                     field is the one the tab's configuration names, checked
 *                     against describe, and the record Id is bound, never
 *                     concatenated.
 *   countChildren() — how many related records each row has, per tab.
 *   addChildTotals() — a child total column's figure for each row.
 *
 * What a user sees of a child grid is still decided by the child's own
 * configuration and the user's access, in user mode: the filter only narrows.
 */
public with sharing class GridNesting {
    /** A top-level grid, its children and theirs; deeper tabs are not offered. */
    public static final Integer MAX_LEVELS = 3;
    /** Child total columns a grid may have: each is a query for every page of rows. */
    public static final Integer MAX_CHILD_TOTALS = 5;
    /** A child total column's key: this, then its Grid Column's API name. '_' cannot start a field name. */
    public static final String TOTAL_PREFIX = '_ct_';
    /** A child grid's height, at least: the same floor as a grid's own Height. */
    public static final Integer MIN_HEIGHT = 160;
    private static final Map<String, String> TOTAL_NAMES = new Map<String, String>{
        'sum' => 'Sum',
        'average' => 'Average',
        'min' => 'Lowest',
        'max' => 'Highest',
        'count' => 'Count'
    };

    /**
     * What a child total column works out: `kind` (sum, average, min,
     * max or count) of `field` (null: count the records) of the records of
     * `objectApiName` whose `relationshipField` points to the row, as the
     * child grid `childConfig` filters them.
     */
    public class ChildTotal {
        public String link;
        public String childConfig;
        public String objectApiName;
        public String relationshipField;
        public String field;
        public String kind;
        public String type;
        public Integer scale;
        public String defaultLabel;
    }

    /** The parent filter of a child grid's request. */
    public class Scope {
        /** The relationship field's API name, from describe. */
        public String fieldApiName;
        public Schema.SObjectField field;
        public Id parentId;
    }

    /** The tabs a configuration lists, in Sort Order; one that cannot work is skipped with a warning. */
    public static List<GridConfig.Child> childrenOf(
        Grid_Configuration__mdt cfg,
        Schema.SObjectType parentType,
        List<String> warnings
    ) {
        return childrenFrom(linksOf(cfg), parentType, warnings);
    }

    /** Every Grid Child Table record of a configuration, turned off or not, in no particular order. */
    public static List<Grid_Child__mdt> linksOf(Grid_Configuration__mdt cfg) {
        List<Grid_Child__mdt> out = new List<Grid_Child__mdt>();
        for (Grid_Child__mdt link : Grid_Child__mdt.getAll().values()) {
            if (GridConfig.belongsTo(link.Grid_Configuration__c, cfg)) {
                out.add(link);
            }
        }
        return out;
    }

    /**
     * The tabs from these records (the org's, or a draft on the Grid Admin
     * tab), in Sort Order, leaving out any marked Inactive; one that
     * cannot work is skipped with a warning.
     */
    public static List<GridConfig.Child> childrenFrom(
        List<Grid_Child__mdt> records,
        Schema.SObjectType parentType,
        List<String> warnings
    ) {
        List<Grid_Child__mdt> links = new List<Grid_Child__mdt>();
        for (Grid_Child__mdt link : records) {
            if (link.Inactive__c != true) {
                links.add(link);
            }
        }
        links.sort(new InOrder());
        List<GridConfig.Child> out = new List<GridConfig.Child>();
        for (Grid_Child__mdt link : links) {
            try {
                out.add(child(link, parentType));
            } catch (GridException e) {
                warnings.add('Grid Child Table ' + link.DeveloperName + ' was skipped: ' + e.getMessage());
            }
        }
        return out;
    }

    /** Can this user open the tab? Its object and its relationship field must be readable. */
    public static Boolean canOpen(GridConfig.Child c) {
        Schema.SObjectType childType = GridDescribe.typeFor(c.objectApiName);
        return GridSecurity.canRead(childType) &&
            GridSecurity.canRead(GridDescribe.field(childType, c.relationshipField));
    }

    /**
     * The parent filter for a request from a child grid, or null for a
     * top-level grid (no tab and no parent). Throws when the tab does not show
     * this grid, the parent is not a record of the parent grid's object, or
     * the user cannot read the relationship field.
     */
    public static Scope scopeFor(GridConfig.Definition def, String linkName, String parentId) {
        if (String.isBlank(linkName) && String.isBlank(parentId)) {
            return null;
        }
        if (String.isBlank(linkName) || String.isBlank(parentId)) {
            throw new GridException('A child table needs both its tab and its parent record.');
        }
        Grid_Child__mdt link = Grid_Child__mdt.getInstance(linkName.trim());
        // A tab turned off is not offered, so it is not served either.
        if (link == null || link.Inactive__c == true) {
            throw new GridException('No Grid Child Table named "' + linkName + '".');
        }
        Grid_Configuration__mdt childCfg = configFor(link.Child_Configuration__c, link, 'Child Configuration');
        if (childCfg.DeveloperName != def.name) {
            throw new GridException(
                'Grid Child Table ' + link.DeveloperName + ' does not show the grid ' + def.name + '.'
            );
        }
        Grid_Configuration__mdt parentCfg = configFor(link.Grid_Configuration__c, link, 'Grid Configuration');
        Schema.SObjectType parentType = GridDescribe.typeFor(parentCfg.Object_API_Name__c);
        Schema.SObjectType childType = GridDescribe.typeFor(def.objectApiName);
        Schema.SObjectField f = relationshipField(link, childType, parentType);
        if (!GridSecurity.canRead(f)) {
            throw new GridException(
                'You do not have access to ' + GridDescribe.localName(childType) + '.' + GridDescribe.localName(f) + '.'
            );
        }
        Id recordId;
        try {
            recordId = Id.valueOf(parentId.trim());
        } catch (Exception e) {
            throw new GridException('Not a record Id: ' + parentId);
        }
        if (recordId.getSObjectType() != parentType) {
            throw new GridException('Record ' + parentId + ' is not a ' + GridDescribe.localName(parentType) + '.');
        }
        Scope s = new Scope();
        s.field = f;
        s.fieldApiName = GridDescribe.apiName(f);
        s.parentId = recordId;
        return s;
    }

    /** Parent records one count call takes: one aggregate row each, per tab. */
    public static final Integer MAX_COUNT_PARENTS = 2000;

    /**
     * How many related records each of these rows has, per tab, so a
     * row with none offers no toggle and a tab says "Contacts (3)" before it is
     * opened: { parentId: { total, byTab: { tab name: n } } }, with a 0 for
     * every tab a row has nothing in.
     *
     * One aggregate query per tab, in user mode, over the tab's relationship
     * field: a COUNT with GROUP BY reads one row per parent against the query
     * row limit (measured for), so a call costs at most
     * MAX_COUNT_PARENTS rows a tab. Only Ids of the grid's own object are
     * counted; anything else in the request is ignored. The tabs are the
     * user's (forUser has already dropped any the user cannot open), so the
     * counts are of what the tab would show.
     */
    public static Map<String, Object> countChildren(GridConfig.Definition def, List<String> parentIds) {
        Schema.SObjectType parentType = GridDescribe.typeFor(def.objectApiName);
        Set<Id> ids = new Set<Id>();
        for (String raw : parentIds == null ? new List<String>() : parentIds) {
            if (String.isBlank(raw)) {
                continue;
            }
            Id recordId;
            try {
                recordId = Id.valueOf(raw.trim());
            } catch (Exception e) {
                continue; // not an Id: nothing to count
            }
            if (recordId.getSObjectType() == parentType) {
                ids.add(recordId);
            }
        }
        if (ids.size() > MAX_COUNT_PARENTS) {
            throw new GridException('Counts are asked for at most ' + MAX_COUNT_PARENTS + ' records at a time.');
        }
        Map<Id, Map<String, Integer>> byParent = new Map<Id, Map<String, Integer>>();
        for (Id recordId : ids) {
            byParent.put(recordId, new Map<String, Integer>());
        }
        if (!ids.isEmpty()) {
            for (GridConfig.Child tab : def.children) {
                Schema.SObjectType childType = GridDescribe.typeFor(tab.objectApiName);
                Schema.SObjectField f = GridDescribe.field(childType, tab.relationshipField);
                String fieldApi = GridDescribe.apiName(f);
                for (Map<String, Integer> counts : byParent.values()) {
                    counts.put(tab.name, 0);
                }
                // The child grid's own filters count too, so a tab's count is
                // what it shows. A filter on a field this user cannot read stops the
                // child grid itself; its tab then counts nothing.
                List<GridFilters.Condition> filters = GridConfig.load(tab.configName).filters;
                if (!readable(childType, filters)) {
                    continue;
                }
                Map<String, Object> binds = new Map<String, Object>{ 'ids' => ids };
                List<String> conditions = new List<String>{ fieldApi + ' IN :ids' };
                conditions.addAll(GridFilters.clauses(childType, filters, binds));
                // The field comes from describe, the Ids and values are bound (HR-6).
                for (
                    SObject r : GridSecurity.query(
                        'SELECT ' +
                            fieldApi +
                            ' p, COUNT(Id) n FROM ' +
                            GridDescribe.apiName(childType) +
                            ' WHERE ' +
                            String.join(conditions, ' AND ') +
                            ' GROUP BY ' +
                            fieldApi,
                        binds
                    )
                ) {
                    Id parent = (Id) r.get('p');
                    if (byParent.containsKey(parent)) {
                        byParent.get(parent).put(tab.name, (Integer) r.get('n'));
                    }
                }
            }
        }
        Map<String, Object> out = new Map<String, Object>();
        for (Id recordId : byParent.keySet()) {
            Map<String, Integer> counts = byParent.get(recordId);
            Integer total = 0;
            for (Integer n : counts.values()) {
                total += n;
            }
            out.put(String.valueOf(recordId), new Map<String, Object>{ 'total' => total, 'byTab' => counts });
        }
        return out;
    }

    // ---------------------------------------------------------------- helpers

    /** Can the user read every field these filters test? */
    private static Boolean readable(Schema.SObjectType objectType, List<GridFilters.Condition> filters) {
        for (GridFilters.Condition c : filters) {
            if (!GridSecurity.canRead(GridDescribe.field(objectType, c.field))) {
                return false;
            }
        }
        return true;
    }

    private static GridConfig.Child child(Grid_Child__mdt link, Schema.SObjectType parentType) {
        Grid_Configuration__mdt childCfg = configFor(link.Child_Configuration__c, link, 'Child Configuration');
        // An archived grid is out of use: its tab is hidden until it is restored.
        if (childCfg.Archived__c == true) {
            throw new GridException('its grid ' + childCfg.DeveloperName + ' is archived.');
        }
        Schema.SObjectType childType;
        try {
            childType = GridDescribe.typeFor(childCfg.Object_API_Name__c);
        } catch (GridException e) {
            throw new GridException('its child configuration ' + childCfg.DeveloperName + ' shows an unknown object.');
        }
        Schema.SObjectField f = relationshipField(link, childType, parentType);
        GridConfig.Child c = new GridConfig.Child();
        c.name = link.DeveloperName;
        c.configName = childCfg.DeveloperName;
        c.label = String.isNotBlank(link.Tab_Label__c) ? link.Tab_Label__c.trim() : childCfg.MasterLabel;
        c.objectApiName = GridDescribe.localName(childType);
        c.relationshipField = GridDescribe.localName(f);
        c.height = link.Height_Px__c == null ||
            link.Height_Px__c <= 0
            ? null
            : Math.max(MIN_HEIGHT, link.Height_Px__c.intValue());
        return c;
    }

    // ---------------------------------------------------------- child totals

    /**
     * What a child total column of a grid on `parentType` works out, checked:
     * its Child Table must be one of this grid's (`links`) and on; its Child
     * Total a kind of total; its Child Field one of the child object's that
     * the total fits (blank only for a count of records). Throws a
     * GridException in an admin's terms.
     */
    public static ChildTotal childTotalOf(
        String tableName,
        String kindName,
        String fieldName,
        Schema.SObjectType parentType,
        List<Grid_Child__mdt> links
    ) {
        String wanted = tableName == null ? '' : tableName.trim();
        Grid_Child__mdt link = null;
        for (Grid_Child__mdt l : links == null ? new List<Grid_Child__mdt>() : links) {
            if (l.DeveloperName != null && l.DeveloperName.equalsIgnoreCase(wanted)) {
                link = l;
            }
        }
        if (link == null) {
            throw new GridException('this grid has no child table named "' + wanted + '".');
        }
        if (link.Inactive__c == true) {
            throw new GridException('its child table ' + link.DeveloperName + ' is turned off.');
        }
        Grid_Configuration__mdt childCfg = configFor(link.Child_Configuration__c, link, 'Child Configuration');
        Schema.SObjectType childType = GridDescribe.typeFor(childCfg.Object_API_Name__c);
        Schema.SObjectField rel = relationshipField(link, childType, parentType);
        String kind = String.isBlank(kindName) ? 'count' : kindName.trim().toLowerCase();
        if (!TOTAL_NAMES.containsKey(kind)) {
            throw new GridException('unknown Child Total "' + kindName + '".');
        }
        String tabLabel = String.isNotBlank(link.Tab_Label__c) ? link.Tab_Label__c.trim() : childCfg.MasterLabel;
        ChildTotal t = new ChildTotal();
        t.link = link.DeveloperName;
        t.childConfig = childCfg.DeveloperName;
        t.objectApiName = GridDescribe.localName(childType);
        t.relationshipField = GridDescribe.localName(rel);
        t.kind = kind;
        if (String.isBlank(fieldName)) {
            if (kind != 'count') {
                throw new GridException(
                    'a ' + TOTAL_NAMES.get(kind).toLowerCase() + ' needs the Child Field to work out.'
                );
            }
            t.type = 'number';
            t.scale = 0;
            t.defaultLabel = tabLabel;
            return t;
        }
        Schema.SObjectField f;
        try {
            f = GridDescribe.field(childType, fieldName);
        } catch (GridException e) {
            throw new GridException(t.objectApiName + ' has no field "' + fieldName.trim() + '".');
        }
        Schema.DescribeFieldResult d = f.getDescribe();
        if (!GridDescribe.subtotalFits(kind, d)) {
            throw new GridException(
                'a ' +
                    TOTAL_NAMES.get(kind).toLowerCase() +
                    ' does not apply to ' +
                    d.getLabel() +
                    ', a ' +
                    GridDescribe.cellType(f) +
                    ' field.'
            );
        }
        t.field = d.getLocalName();
        t.type = kind == 'count' ? 'number' : GridDescribe.cellType(f);
        t.scale = kind == 'count'
            ? 0
            : (kind == 'average' && t.type != 'currency' ? Math.max(2, d.getScale()) : d.getScale());
        t.defaultLabel = tabLabel + ': ' + TOTAL_NAMES.get(kind) + ' of ' + d.getLabel();
        return t;
    }

    /** Can this user see a child total? The child records, their link to the row, and the field totalled. */
    public static Boolean canTotal(ChildTotal t) {
        Schema.SObjectType childType = GridDescribe.typeFor(t.objectApiName);
        return GridSecurity.canRead(childType) &&
            GridSecurity.canRead(GridDescribe.field(childType, t.relationshipField)) &&
            (t.field == null || GridSecurity.canRead(GridDescribe.field(childType, t.field)));
    }

    /**
     * Each child total column's figure on each row, keyed by the
     * column: one aggregate query per column for the page, in user mode, over
     * the child records the child grid would show (its own filters too). A
     * count is 0 for a row with no records; any other total is blank. A total
     * that would read more child records than the transaction has left to
     * read is left blank rather than stop the page: a sum, an average, a
     * lowest and a highest count every record they read.
     */
    public static void addChildTotals(List<Map<String, Object>> rows, GridConfig.Definition def) {
        Set<Id> ids = new Set<Id>();
        for (Map<String, Object> row : rows) {
            ids.add((Id) row.get('Id'));
        }
        if (ids.isEmpty()) {
            return;
        }
        for (GridConfig.Column c : def.columns) {
            if (c.childTotal == null) {
                continue;
            }
            Map<Id, Object> byParent = totals(c.childTotal, ids);
            for (Map<String, Object> row : rows) {
                Object value = byParent == null ? null : byParent.get((Id) row.get('Id'));
                if (value == null && byParent != null && c.childTotal.kind == 'count') {
                    value = 0;
                }
                row.put(c.field, value);
            }
        }
    }

    /** The child grids' filters read in this transaction, by configuration: one load each. */
    private static Map<String, List<GridFilters.Condition>> childFilters = new Map<String, List<GridFilters.Condition>>();

    /** One total for each parent; null when it cannot be worked out (unreadable filters, too many records). */
    private static Map<Id, Object> totals(ChildTotal t, Set<Id> ids) {
        Schema.SObjectType childType = GridDescribe.typeFor(t.objectApiName);
        if (!childFilters.containsKey(t.childConfig)) {
            // Archived or not: the total is the parent grid's, over the related records.
            childFilters.put(t.childConfig, GridConfig.load(t.childConfig, true).filters);
        }
        List<GridFilters.Condition> filters = childFilters.get(t.childConfig);
        // A filter on a field this user cannot read stops the child grid itself: nothing to total.
        if (!readable(childType, filters)) {
            return null;
        }
        String rel = GridDescribe.apiName(GridDescribe.field(childType, t.relationshipField));
        Schema.SObjectField f = t.field == null ? null : GridDescribe.field(childType, t.field);
        Map<String, Object> binds = new Map<String, Object>{ 'ids' => ids };
        List<String> conditions = new List<String>{ rel + ' IN :ids' };
        conditions.addAll(GridFilters.clauses(childType, filters, binds));
        String source = ' FROM ' + GridDescribe.apiName(childType) + ' WHERE ' + String.join(conditions, ' AND ');
        if (t.kind != 'count') {
            Integer records = GridSecurity.countQuery('SELECT COUNT()' + source, binds);
            if (records > Limits.getLimitQueryRows() - Limits.getQueryRows() - 1000) {
                return null;
            }
        }
        String measure;
        switch on t.kind {
            when 'sum' {
                measure = 'SUM(' + GridDescribe.apiName(f) + ')';
            }
            when 'average' {
                measure = 'AVG(' + GridDescribe.apiName(f) + ')';
            }
            when 'min' {
                measure = 'MIN(' + GridDescribe.apiName(f) + ')';
            }
            when 'max' {
                measure = 'MAX(' + GridDescribe.apiName(f) + ')';
            }
            when else {
                measure = 'COUNT(' + (f == null ? 'Id' : GridDescribe.apiName(f)) + ')';
            }
        }
        Map<Id, Object> out = new Map<Id, Object>();
        // The fields come from describe, the Ids and values are bound (HR-6).
        for (
            SObject r : GridSecurity.query(
                'SELECT ' + rel + ' p, ' + measure + ' v' + source + ' GROUP BY ' + rel,
                binds
            )
        ) {
            out.put((Id) r.get('p'), plain(r.get('v'), t.type));
        }
        return out;
    }

    /** A total as the browser reads a row's value: decimal strings, ISO dates, ISO date/times in GMT. */
    /**
     * A total as the browser reads it: a decimal string, an ISO date, or an
     * ISO date/time in GMT. Decided by the column's type, not instanceof: a
     * Date held as an Object is also an instanceof Datetime, so a lowest date
     * would otherwise arrive as a date/time.
     */
    @TestVisible
    private static Object plain(Object value, String type) {
        if (value == null) {
            return null;
        }
        if (type == 'date') {
            return String.valueOf((Date) value);
        }
        if (type == 'datetime') {
            return ((Datetime) value).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        }
        if (value instanceof Decimal) {
            return ((Decimal) value).toPlainString();
        }
        return value;
    }

    /** The configuration a metadata relationship field names. Throws if there is none. */
    private static Grid_Configuration__mdt configFor(Object ref, Grid_Child__mdt link, String fieldLabel) {
        if (ref != null) {
            for (Grid_Configuration__mdt cfg : Grid_Configuration__mdt.getAll().values()) {
                if (GridConfig.belongsTo(ref, cfg)) {
                    return cfg;
                }
            }
        }
        throw new GridException('it has no ' + fieldLabel + '.');
    }

    /** The child object's field that points to the parent's object. Throws in an admin's terms. */
    private static Schema.SObjectField relationshipField(
        Grid_Child__mdt link,
        Schema.SObjectType childType,
        Schema.SObjectType parentType
    ) {
        String childName = GridDescribe.localName(childType);
        if (String.isBlank(link.Relationship_Field__c)) {
            throw new GridException('it has no Relationship Field.');
        }
        Schema.SObjectField f;
        try {
            f = GridDescribe.field(childType, link.Relationship_Field__c);
        } catch (GridException e) {
            throw new GridException(childName + ' has no field "' + link.Relationship_Field__c.trim() + '".');
        }
        Schema.DescribeFieldResult d = f.getDescribe();
        if (d.getType() != Schema.DisplayType.REFERENCE || !d.getReferenceTo().contains(parentType)) {
            throw new GridException(
                childName +
                    '.' +
                    d.getLocalName() +
                    ' does not point to ' +
                    GridDescribe.localName(parentType) +
                    ' records.'
            );
        }
        return f;
    }

    private class InOrder implements Comparator<Grid_Child__mdt> {
        public Integer compare(Grid_Child__mdt a, Grid_Child__mdt b) {
            Decimal x = a.Sort_Order__c == null ? 9999 : a.Sort_Order__c;
            Decimal y = b.Sort_Order__c == null ? 9999 : b.Sort_Order__c;
            if (x != y) {
                return x < y ? -1 : 1;
            }
            return a.DeveloperName.compareTo(b.DeveloperName);
        }
    }
}
