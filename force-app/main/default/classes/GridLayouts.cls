/**
 * GridLayouts — each user's layout of each grid, kept in Salesforce:
 * the column widths they set, Wrap or Clip, the sort, the grouping and the
 * rows whose related records are open, so the grid looks the same the next
 * time, on any device.
 *
 * One Grid User Layout record per user per grid, owned by the user; the object
 * is private, and every read and write is in user mode (GridSecurity), so a
 * user reaches only their own. Its Key is the user's Id and the grid's API
 * name, which makes the record unique and lets a save upsert by it.
 *
 * What the layout holds is the browser's business: the server checks only
 * that it is a JSON object of a sensible size, for a grid that exists. The
 * browser checks each part against the grid as it loads it, and leaves out
 * what no longer fits (a column the grid no longer has).
 *
 * A layout is a convenience. A user without access to Grid User Layout (no
 * Rowhouse Grid User permission set) gets none, and the grid works as before.
 */
public with sharing class GridLayouts {

    /** Characters a layout may hold: well inside the field's 32,768. */
    public static final Integer MAX_LENGTH = 30000;

    /** This user's layout of the grid, as JSON, or null. */
    public static String read(String configName) {
        String name = configNamed(configName);
        if (!GridSecurity.canRead(Grid_User_Layout__c.SObjectType) || !GridSecurity.canRead(Grid_User_Layout__c.Layout__c)) {
            return null;
        }
        List<Grid_User_Layout__c> rows = own(name);
        return rows.isEmpty() ? null : rows[0].Layout__c;
    }

    /**
     * Keep this user's layout of the grid. False when the user may not keep
     * one; throws when the layout is not one (HR-6: it comes from the browser).
     */
    public static Boolean save(String configName, String layout) {
        String name = configNamed(configName);
        if (String.isBlank(layout)) {
            throw new GridException('There is no layout to keep.');
        }
        if (layout.length() > MAX_LENGTH) {
            throw new GridException('A layout is ' + MAX_LENGTH + ' characters at most; this one is ' + layout.length() + '.');
        }
        Object parsed;
        try {
            parsed = JSON.deserializeUntyped(layout);
        } catch (Exception e) {
            throw new GridException('A layout must be JSON.');
        }
        if (!(parsed instanceof Map<String, Object>)) {
            throw new GridException('A layout must be a JSON object.');
        }
        if (!GridSecurity.canCreate(Grid_User_Layout__c.SObjectType) || !GridSecurity.canUpdate(Grid_User_Layout__c.SObjectType)
                || !GridSecurity.canEdit(Grid_User_Layout__c.Layout__c)) {
            return false;
        }
        Grid_User_Layout__c record = new Grid_User_Layout__c(Name = name, Key__c = keyFor(name), Layout__c = layout);
        GridSecurity.upsertOwnRecord(record, Grid_User_Layout__c.Key__c);
        return true;
    }

    /** Forget this user's layout of the grid (Reset layout). */
    public static void reset(String configName) {
        String name = configNamed(configName);
        if (!GridSecurity.canRead(Grid_User_Layout__c.SObjectType) || !GridSecurity.canDelete(Grid_User_Layout__c.SObjectType)) {
            return;
        }
        GridSecurity.deleteOwnRecords(own(name));
    }

    /**
     * The sort and grouping a grid's first page is fetched with when it opens:
     * the layout's where they still fit the grid, the admin's where
     * they do not. It reads the layout exactly as the browser does (gridView's
     * readLayout): a sort key on a column the grid no longer has, or cannot
     * sort by, is passed over and the first one left is the sort; a grouping
     * level on a column that cannot be grouped is passed over, a date level
     * without a known unit is by month, and a grouping with levels none of
     * which is left falls back to the admin's, while an empty one is none.
     *
     * The answer is { sortField, sortDirection, groupBy }: the sort as the
     * server applies it (the admin's when the layout has none; null when
     * neither has one) and the grouping as fetchRows takes it ("Field__c" or
     * "Field__c:month"). The browser compares it with its own reading and
     * fetches the rows again where they differ, so a difference here costs a
     * call, never a wrong order.
     */
    public static Map<String, Object> startOf(GridConfig.Definition def, String layout) {
        Map<String, Object> saved = parsed(layout);
        // Keyed exactly as the browser keys them: by the column's own spelling.
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            byField.put(c.field, c);
        }
        String sortField = String.isBlank(def.sortField) ? null : def.sortField;
        String sortDirection = sortField == null ? null : ('desc'.equals(def.sortDirection) ? 'desc' : 'asc');
        Object savedSort = saved == null ? null : saved.get('sort');
        if (savedSort instanceof List<Object>) {
            for (Object key : (List<Object>) savedSort) {
                Map<String, Object> k = key instanceof Map<String, Object> ? (Map<String, Object>) key : null;
                GridConfig.Column c = k != null && k.get('field') instanceof String ? byField.get((String) k.get('field')) : null;
                if (c != null && c.sortable != false) {
                    sortField = c.field;
                    sortDirection = 'desc'.equals(k.get('direction')) ? 'desc' : 'asc';
                    break;
                }
            }
        }
        List<String> groupBy = null;
        Object savedGrouping = saved == null ? null : saved.get('grouping');
        if (savedGrouping instanceof List<Object>) {
            List<Object> levels = (List<Object>) savedGrouping;
            List<String> fit = groupingThatFits(levels, byField);
            if (!fit.isEmpty() || levels.isEmpty()) {
                groupBy = fit;
            }
        }
        if (groupBy == null) {
            List<Object> admin = new List<Object>();
            for (Map<String, String> level : def.grouping) {
                admin.add(new Map<String, Object>{ 'field' => level.get('field'), 'unit' => level.get('unit') });
            }
            groupBy = groupingThatFits(admin, byField);
        }
        return new Map<String, Object>{ 'sortField' => sortField, 'sortDirection' => sortDirection, 'groupBy' => groupBy };
    }

    /** gridGroups' normalizeGrouping, as fetchRows takes the levels. */
    private static List<String> groupingThatFits(List<Object> levels, Map<String, GridConfig.Column> byField) {
        List<String> out = new List<String>();
        Set<String> seen = new Set<String>();
        for (Object entry : levels) {
            Map<String, Object> level = entry instanceof Map<String, Object> ? (Map<String, Object>) entry : null;
            GridConfig.Column c = level != null && level.get('field') instanceof String ? byField.get((String) level.get('field')) : null;
            if (c == null || c.groupable != true || out.size() >= GridConfig.MAX_GROUP_LEVELS || seen.contains(c.field)) {
                continue;
            }
            seen.add(c.field);
            if ('date'.equals(c.type) || 'datetime'.equals(c.type)) {
                Object unit = level.get('unit');
                out.add(c.field + ':' + (unit instanceof String && GridConfig.GROUP_UNITS.contains((String) unit) ? (String) unit : 'month'));
            } else {
                out.add(c.field);
            }
        }
        return out;
    }

    /** A layout as a JSON object, or null for none or anything else. */
    private static Map<String, Object> parsed(String layout) {
        if (String.isBlank(layout)) {
            return null;
        }
        try {
            Object value = JSON.deserializeUntyped(layout);
            return value instanceof Map<String, Object> ? (Map<String, Object>) value : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** The record's Key: the user's Id and the grid's API name. */
    @TestVisible
    private static String keyFor(String configName) {
        return UserInfo.getUserId() + ':' + configName;
    }

    /** This user's record for the grid, if there is one. */
    private static List<Grid_User_Layout__c> own(String configName) {
        return (List<Grid_User_Layout__c>) GridSecurity.query(
            'SELECT Id, Layout__c FROM Grid_User_Layout__c WHERE Key__c = :layoutKey AND OwnerId = :me LIMIT 1',
            new Map<String, Object>{ 'layoutKey' => keyFor(configName), 'me' => UserInfo.getUserId() }
        );
    }

    /**
     * The grid's API name as the org spells it, so one grid has one Key
     * whatever the case it is asked for in. Throws when there is no such grid.
     */
    private static String configNamed(String configName) {
        if (String.isNotBlank(configName)) {
            Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance(configName.trim());
            if (cfg != null) {
                return cfg.DeveloperName;
            }
            for (String name : Grid_Configuration__mdt.getAll().keySet()) {
                if (name.equalsIgnoreCase(configName.trim())) {
                    return name;
                }
            }
        }
        throw new GridException('No Grid Configuration named "' + configName + '".');
    }
}
