/**
 * GridGroupService — the counts and subtotals of a grouped grid.
 *
 * The grid groups the rows it has loaded, but a group's count and its
 * subtotals cover every record that matches, loaded or not, so they come from
 * SOQL aggregates here. The browser sends the grouping (up to three levels)
 * and the quick-search term; the columns and their subtotals come from the
 * configuration, never from the request (HR-6).
 *
 * WHAT ONE CALL CAN AGGREGATE (measured in a Developer Edition org)
 * A SUM, AVG, MIN or MAX counts every record it reads against the 50,000
 * query rows one transaction may read; a COUNT with GROUP BY counts one row
 * per group. So:
 *   - counts alone (no subtotal, or only Count): one query whatever the size,
 *     at one row per group;
 *   - other subtotals over at most sliceRows records: one query;
 *   - over more: the records are cut into slices of sliceRows by Id. The first
 *     call finds where each slice starts (an Apex cursor over the Ids: opening
 *     it costs nothing, each boundary one row) and aggregates the first slice;
 *     the browser then asks for each other slice by its Id range and adds the
 *     answers up. Sums, counts, mins and maxes combine exactly, and an average
 *     is a sum over a count.
 * Only the deepest level is returned. The browser adds up the levels above it
 * and the Total row, so no record is read twice.
 *
 * THE ANSWER
 *   groups: [{ k: [key per level], l: [name per level, lookups only],
 *              n: records, v: { field: { s: sum, c: count, mn: min, mx: max } } }]
 *     A key is a date as 2026-09-28, a week as the date it starts on
 *     (2026-09-27: the first day of the week in the user's locale), a month as
 *     2026-09, a quarter as 2026-Q3, a year as 2026, a fiscal quarter as
 *     FY2026-Q3 and a fiscal year as FY2026 (a date/time in the user's
 *     time zone, as the grid shows it); true or false; an 18-character Id;
 *     text or a picklist value as
 *     stored (SOQL groups text without regard to case); '' for blank, never
 *     null (Lightning drops null elements from a list sent to the browser).
 *     Numbers travel as decimal strings, as row values do.
 *   boundaries: where the other slices start, on a first call that needed
 *     them; null when the answer is complete.
 *   tooManyGroups: more than maxGroups groups. Nothing else is returned.
 */
public with sharing class GridGroupService {
    /** Records per slice: the 50,000-row budget, less room for the count and the boundaries. */
    @TestVisible
    private static Integer sliceRows = 45000;
    /** Groups one answer holds. More are too many to read, and too much to send. */
    @TestVisible
    private static Integer maxGroups = 5000;
    /**
     * Days read for a grouping by week: SOQL has no week of the user's
     * locale, so the days are read and added up into weeks here. The weeks
     * must still be at most maxGroups.
     */
    @TestVisible
    private static Integer maxDays = 20000;

    public class Result {
        @AuraEnabled
        public List<Map<String, Object>> groups = new List<Map<String, Object>>();
        @AuraEnabled
        public List<String> boundaries;
        @AuraEnabled
        public Boolean tooManyGroups = false;
    }

    /** One level of the grouping, checked against the grid. */
    public class Level {
        /** Local name. */
        public String field;
        /** day, week, month, quarter, year, fiscal_quarter or fiscal_year for a date; null otherwise. */
        public String unit;
        public Schema.SObjectField f;
        public Schema.DescribeFieldResult d;
        /** A lookup's name, which labels its groups. */
        public String namePath;
    }

    /**
     * The grouping the browser asked for, outermost first: "Field__c", or
     * "Field__c:month" for a date. Each must be a column of this grid that the
     * user can group by, at most three, none twice; a date without a unit is
     * grouped by month. Anything else refuses the whole request.
     */
    public static List<Level> levels(GridConfig.Definition def, List<String> grouping) {
        List<Level> out = new List<Level>();
        if (grouping == null || grouping.isEmpty()) {
            return out;
        }
        if (grouping.size() > GridConfig.MAX_GROUP_LEVELS) {
            throw new GridException('Group by at most ' + GridConfig.MAX_GROUP_LEVELS + ' columns.');
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            byField.put(c.field.toLowerCase(), c);
        }
        Set<String> seen = new Set<String>();
        for (String entry : grouping) {
            String name = entry == null ? '' : entry.substringBefore(':').trim();
            String unit = entry != null && entry.contains(':') ? entry.substringAfter(':').trim().toLowerCase() : null;
            GridConfig.Column c = byField.get(name.toLowerCase());
            if (c == null || c.groupable != true) {
                throw new GridException('Cannot group by ' + name + '.');
            }
            if (!seen.add(c.field)) {
                throw new GridException('Cannot group by ' + c.label + ' twice.');
            }
            Level lv = new Level();
            lv.field = c.field;
            lv.f = GridDescribe.field(objectType, c.field);
            lv.d = lv.f.getDescribe();
            if (GridDescribe.isDateLike(lv.d)) {
                lv.unit = String.isBlank(unit) ? 'month' : unit;
                if (!GridConfig.GROUP_UNITS.contains(lv.unit)) {
                    throw new GridException('Cannot group ' + c.label + ' by "' + unit + '".');
                }
            }
            // forUser() allows a lookup only when the user can read its names.
            if (lv.d.getType() == Schema.DisplayType.REFERENCE) {
                lv.namePath = GridDescribe.namePath(lv.f);
            }
            out.add(lv);
        }
        return out;
    }

    /**
     * The org's fiscal year, for the browser to group the rows it has
     * by fiscal quarter and year as FISCAL_QUARTER and FISCAL_YEAR group them
     * here: { startMonth, nameByStart, periods: [{ type: 'year' | 'quarter',
     * start, end, number, name }] }. The periods are the years and quarters
     * the org has defined (custom fiscal years, or the standard ones
     * Salesforce keeps for a few years); outside them the browser works a
     * period out from the start month. Null for a grid with no date column to
     * group by, so no other grid pays for the two queries.
     */
    public static Map<String, Object> fiscalCalendarFor(GridConfig.Definition def) {
        Boolean wanted = false;
        for (GridConfig.Column c : def.columns) {
            wanted = wanted || (c.groupable == true && (c.type == 'date' || c.type == 'datetime'));
        }
        if (!wanted) {
            return null;
        }
        Map<String, Object> out = new Map<String, Object>{ 'startMonth' => 1, 'nameByStart' => false };
        try {
            List<SObject> org = GridSecurity.query(
                'SELECT FiscalYearStartMonth, UsesStartDateAsFiscalYearName FROM Organization LIMIT 1',
                new Map<String, Object>()
            );
            if (!org.isEmpty()) {
                out.put('startMonth', org[0].get('FiscalYearStartMonth'));
                out.put('nameByStart', org[0].get('UsesStartDateAsFiscalYearName') == true);
            }
        } catch (Exception e) {
            // Unreadable: a fiscal year that starts in January, the calendar's.
        }
        List<Map<String, Object>> periods = new List<Map<String, Object>>();
        try {
            for (
                SObject p : GridSecurity.query(
                    'SELECT Type, Number, StartDate, EndDate, FiscalYearSettings.Name FROM Period' +
                    ' WHERE Type IN (\'Year\', \'Quarter\') ORDER BY StartDate LIMIT 1000',
                    new Map<String, Object>()
                )
            ) {
                SObject settings = p.getSObject('FiscalYearSettings');
                periods.add(
                    new Map<String, Object>{
                        'type' => String.valueOf(p.get('Type')).toLowerCase(),
                        'start' => String.valueOf((Date) p.get('StartDate')),
                        'end' => String.valueOf((Date) p.get('EndDate')),
                        'number' => p.get('Number'),
                        'name' => settings == null ? null : settings.get('Name')
                    }
                );
            }
        } catch (Exception e) {
            // Unreadable: worked out from the start month alone.
        }
        out.put('periods', periods);
        return out;
    }

    /** The levels' fields, outermost first: the order GridDataService puts rows in. */
    public static List<String> fields(List<Level> levels) {
        List<String> out = new List<String>();
        for (Level lv : levels) {
            out.add(lv.field);
        }
        return out;
    }

    /**
     * Counts and subtotals for a grouping. A first call passes no Ids; a call
     * for a later slice passes the slice's first Id (fromId) and the next
     * slice's first Id (toId, null for the last slice).
     */
    public static Result summarize(
        String configName,
        String searchTerm,
        List<String> grouping,
        String fromId,
        String toId
    ) {
        return summarize(configName, searchTerm, grouping, fromId, toId, null, null);
    }

    /** The same, for a child grid: only the records under one parent count. */
    public static Result summarize(
        String configName,
        String searchTerm,
        List<String> grouping,
        String fromId,
        String toId,
        String parentLink,
        String parentId
    ) {
        return summarize(configName, searchTerm, grouping, fromId, toId, parentLink, parentId, null, null);
    }

    /**
     * The same, narrowed as the rows are: the admin's filters,
     * the user's, and on a record page the page's record. So a group's count
     * is the count of its rows.
     */
    public static Result summarize(
        String configName,
        String searchTerm,
        List<String> grouping,
        String fromId,
        String toId,
        String parentLink,
        String parentId,
        List<Map<String, Object>> filters,
        String recordId
    ) {
        GridConfig.Definition def = GridConfig.forUser(configName);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridSecurity.requireRead(objectType);
        GridNesting.Scope scope = GridNesting.scopeFor(def, parentLink, parentId);
        List<Level> levels = levels(def, grouping);
        List<GridConfig.Column> totals = new List<GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            if (c.subtotal != null) {
                totals.add(c);
            }
        }
        Result result = new Result();
        if (levels.isEmpty() && totals.isEmpty()) {
            return result;
        }

        Map<String, Object> binds = new Map<String, Object>();
        List<String> conditions = new List<String>();
        String parent = scope == null
            ? null
            : GridDataService.parentCondition(scope.fieldApiName, scope.parentId, binds);
        if (parent != null) {
            conditions.add(parent);
        }
        String search = GridDataService.searchCondition(objectType, def.fieldNames(), searchTerm, binds);
        if (search != null) {
            conditions.add(search);
        }
        conditions.addAll(
            GridFilters.clauses(objectType, GridFilters.forRequest(def, filters, recordId, scope != null), binds)
        );
        String source = ' FROM ' + GridDescribe.apiName(objectType);

        if (fromId != null || toId != null) {
            addRange(conditions, binds, objectType, fromId, toId);
        } else if (readsEveryRecord(totals)) {
            Integer total = GridSecurity.countQuery('SELECT COUNT()' + source + whereClause(conditions), binds);
            if (total > sliceRows) {
                List<String> starts = boundaries(source + whereClause(conditions), binds, total);
                if (!starts.isEmpty()) {
                    result.boundaries = starts;
                    addRange(conditions, binds, objectType, null, starts[0]);
                }
            }
        }
        aggregate(result, levels, totals, source + whereClause(conditions), binds, objectType);
        return result;
    }

    /** Anything but a count reads every record it covers (see the class comment). */
    private static Boolean readsEveryRecord(List<GridConfig.Column> totals) {
        for (GridConfig.Column c : totals) {
            if (c.subtotal != 'count') {
                return true;
            }
        }
        return false;
    }

    /** Where each slice after the first starts: every sliceRows-th Id, in Id order. */
    private static List<String> boundaries(String sourceAndWhere, Map<String, Object> binds, Integer total) {
        Integer needed = (total - 1) / sliceRows;
        if (needed > Limits.getLimitFetchCallsOnApexCursor() - Limits.getFetchCallsOnApexCursor()) {
            throw new GridException(total.format() + ' records match, too many to total. Search to narrow the list.');
        }
        Database.Cursor ids = GridSecurity.openIdCursor('SELECT Id' + sourceAndWhere + ' ORDER BY Id', binds);
        Integer count = ids.getNumRecords();
        List<String> out = new List<String>();
        for (Integer position = sliceRows; position < count; position += sliceRows) {
            out.add(String.valueOf(ids.fetch(position, 1)[0].Id));
        }
        return out;
    }

    /** Limit the query to one slice. The Ids come from the browser, so they are checked (HR-6). */
    private static void addRange(
        List<String> conditions,
        Map<String, Object> binds,
        Schema.SObjectType objectType,
        String fromId,
        String toId
    ) {
        if (fromId != null) {
            binds.put('sliceFrom', recordId(fromId, objectType));
            conditions.add('Id >= :sliceFrom');
        }
        if (toId != null) {
            binds.put('sliceTo', recordId(toId, objectType));
            conditions.add('Id < :sliceTo');
        }
    }

    private static Id recordId(String value, Schema.SObjectType objectType) {
        Id parsed;
        try {
            parsed = Id.valueOf(value);
        } catch (Exception e) {
            throw new GridException('Not a record Id: ' + value);
        }
        if (parsed.getSObjectType() != objectType) {
            throw new GridException('Record ' + value + ' is not a ' + GridDescribe.localName(objectType) + '.');
        }
        return parsed;
    }

    private static String whereClause(List<String> conditions) {
        return conditions.isEmpty() ? '' : ' WHERE ' + String.join(conditions, ' AND ');
    }

    /** One aggregate query, grouped by every level, into result.groups. */
    private static void aggregate(
        Result result,
        List<Level> levels,
        List<GridConfig.Column> totals,
        String sourceAndWhere,
        Map<String, Object> binds,
        Schema.SObjectType objectType
    ) {
        List<String> selects = new List<String>();
        List<String> groupBy = new List<String>();
        // A field grouped by its own value (a picklist, a date by day) cannot
        // also be aggregated in the same query: SOQL refuses it ("Grouped field
        // should not be aggregated"). Its subtotal in a group is its key, so it
        // is worked out from the key instead (found by's tests).
        Map<String, String> groupedAlias = new Map<String, String>();
        for (Integer i = 0; i < levels.size(); i++) {
            List<String> exprs = expressions(levels[i]);
            for (Integer j = 0; j < exprs.size(); j++) {
                selects.add(exprs[j] + ' g' + i + (j == 0 ? 'a' : 'b'));
                groupBy.add(exprs[j]);
            }
            if (exprs.size() == 1 && exprs[0] == GridDescribe.apiName(levels[i].f)) {
                groupedAlias.put(exprs[0].toLowerCase(), 'g' + i + 'a');
            }
            if (levels[i].namePath != null) {
                selects.add(levels[i].namePath + ' l' + i);
                groupBy.add(levels[i].namePath);
            }
        }
        selects.add('COUNT(Id) n');
        List<Schema.DescribeFieldResult> totalFields = new List<Schema.DescribeFieldResult>();
        List<String> keyAlias = new List<String>();
        for (Integer i = 0; i < totals.size(); i++) {
            Schema.SObjectField f = GridDescribe.field(objectType, totals[i].field);
            totalFields.add(f.getDescribe());
            String api = GridDescribe.apiName(f);
            keyAlias.add(groupedAlias.get(api.toLowerCase()));
            if (keyAlias[i] != null) {
                continue; // from the group's key, below
            }
            switch on totals[i].subtotal {
                when 'sum' {
                    selects.add('SUM(' + api + ') s' + i);
                }
                when 'average' {
                    selects.add('SUM(' + api + ') s' + i);
                    selects.add('COUNT(' + api + ') c' + i);
                }
                when 'min' {
                    selects.add('MIN(' + api + ') m' + i);
                }
                when 'max' {
                    selects.add('MAX(' + api + ') x' + i);
                }
                when else {
                    selects.add('COUNT(' + api + ') c' + i);
                }
            }
        }
        String soql = 'SELECT ' + String.join(selects, ', ') + sourceAndWhere;
        // A week is read as its days and added up below.
        Boolean byWeek = false;
        for (Level lv : levels) {
            byWeek = byWeek || lv.unit == 'week';
        }
        Integer readLimit = byWeek ? maxDays : maxGroups;
        if (!groupBy.isEmpty()) {
            // The limit stops a grouping by, say, Name from reading a row per record.
            soql += ' GROUP BY ' + String.join(groupBy, ', ') + ' LIMIT ' + (readLimit + 1);
        }
        List<SObject> rows = GridSecurity.query(soql, binds);
        if (rows.size() > readLimit) {
            result.tooManyGroups = true;
            result.boundaries = null;
            return;
        }
        for (SObject row : rows) {
            AggregateResult ar = (AggregateResult) row;
            List<String> keys = new List<String>();
            List<String> labels = new List<String>();
            // A blank travels as '', never null: Lightning drops null elements
            // from a list on its way to the browser, which shifted every later
            // key into the wrong level (found in Lightning Experience). ''
            // cannot be a real key: Salesforce stores empty text as null.
            for (Integer i = 0; i < levels.size(); i++) {
                String key = keyOf(levels[i], ar, i);
                keys.add(key == null ? '' : key);
                Object name = levels[i].namePath == null ? null : ar.get('l' + i);
                labels.add(name == null ? '' : String.valueOf(name));
            }
            Map<String, Object> values = new Map<String, Object>();
            for (Integer i = 0; i < totals.size(); i++) {
                if (keyAlias[i] != null) {
                    values.put(
                        totals[i].field,
                        fromKey(totals[i].subtotal, ar.get(keyAlias[i]), (Integer) ar.get('n'), totalFields[i])
                    );
                    continue;
                }
                Map<String, Object> v = new Map<String, Object>();
                String kind = totals[i].subtotal;
                if (kind == 'sum' || kind == 'average') {
                    v.put('s', plain(ar.get('s' + i), totalFields[i]));
                }
                if (kind == 'average' || kind == 'count') {
                    v.put('c', ar.get('c' + i));
                }
                if (kind == 'min') {
                    v.put('mn', plain(ar.get('m' + i), totalFields[i]));
                }
                if (kind == 'max') {
                    v.put('mx', plain(ar.get('x' + i), totalFields[i]));
                }
                values.put(totals[i].field, v);
            }
            result.groups.add(new Map<String, Object>{ 'k' => keys, 'l' => labels, 'n' => ar.get('n'), 'v' => values });
        }
        if (byWeek) {
            result.groups = foldDays(result.groups, totals, totalFields);
            if (result.groups.size() > maxGroups) {
                result.groups = new List<Map<String, Object>>();
                result.tooManyGroups = true;
                result.boundaries = null;
            }
        }
    }

    /**
     * Groups with the same keys made one: the days of a week, once
     * keyOf has given each day its week's key. Counts add, sums add exactly,
     * the lowest and highest compare, as the browser adds up slices.
     */
    @TestVisible
    private static List<Map<String, Object>> foldDays(
        List<Map<String, Object>> groups,
        List<GridConfig.Column> totals,
        List<Schema.DescribeFieldResult> totalFields
    ) {
        Map<String, Map<String, Object>> byKey = new Map<String, Map<String, Object>>();
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Map<String, Object> g : groups) {
            String key = JSON.serialize(g.get('k'));
            Map<String, Object> kept = byKey.get(key);
            if (kept == null) {
                byKey.put(key, g);
                out.add(g);
                continue;
            }
            kept.put('n', (Integer) kept.get('n') + (Integer) g.get('n'));
            Map<String, Object> keptValues = (Map<String, Object>) kept.get('v');
            Map<String, Object> fromValues = (Map<String, Object>) g.get('v');
            for (Integer i = 0; i < totals.size(); i++) {
                String field = totals[i].field;
                keptValues.put(
                    field,
                    merged(
                        (Map<String, Object>) keptValues.get(field),
                        (Map<String, Object>) fromValues.get(field),
                        totalFields[i]
                    )
                );
            }
        }
        return out;
    }

    /** Two groups' { s, c, mn, mx } for one field, as one. */
    private static Map<String, Object> merged(
        Map<String, Object> a,
        Map<String, Object> b,
        Schema.DescribeFieldResult d
    ) {
        if (a == null || b == null) {
            return a == null ? b : a;
        }
        Map<String, Object> out = new Map<String, Object>();
        if (a.containsKey('s') || b.containsKey('s')) {
            String x = (String) a.get('s');
            String y = (String) b.get('s');
            out.put('s', x == null ? y : (y == null ? x : (Decimal.valueOf(x) + Decimal.valueOf(y)).toPlainString()));
        }
        if (a.containsKey('c') || b.containsKey('c')) {
            Integer x = a.get('c') == null ? 0 : Integer.valueOf(a.get('c'));
            Integer y = b.get('c') == null ? 0 : Integer.valueOf(b.get('c'));
            out.put('c', x + y);
        }
        if (a.containsKey('mn') || b.containsKey('mn')) {
            out.put('mn', lowest((String) a.get('mn'), (String) b.get('mn'), d, true));
        }
        if (a.containsKey('mx') || b.containsKey('mx')) {
            out.put('mx', lowest((String) a.get('mx'), (String) b.get('mx'), d, false));
        }
        return out;
    }

    /** The lower of two subtotal values (or the higher): numbers by value, dates and date/times as ISO text. */
    private static String lowest(String x, String y, Schema.DescribeFieldResult d, Boolean wantLow) {
        if (x == null || y == null) {
            return x == null ? y : x;
        }
        Boolean xFirst;
        Schema.DisplayType t = d.getType();
        if (t == Schema.DisplayType.DATE || t == Schema.DisplayType.DATETIME) {
            xFirst = x < y;
        } else {
            xFirst = Decimal.valueOf(x) < Decimal.valueOf(y);
        }
        return xFirst == wantLow ? x : y;
    }

    /**
     * The subtotal of a field the group is keyed by: every record in the group
     * holds the key, so the minimum and the maximum are the key, a count is
     * the group's records (none when the key is blank), and a sum is the key
     * times them.
     */
    @TestVisible
    private static Map<String, Object> fromKey(String kind, Object key, Integer n, Schema.DescribeFieldResult d) {
        Map<String, Object> v = new Map<String, Object>();
        Integer present = key == null ? 0 : n;
        if (kind == 'sum' || kind == 'average') {
            v.put('s', key == null ? null : plain(((Decimal) key) * n, d));
        }
        if (kind == 'average' || kind == 'count') {
            v.put('c', present);
        }
        if (kind == 'min') {
            v.put('mn', plain(key, d));
        }
        if (kind == 'max') {
            v.put('mx', plain(key, d));
        }
        return v;
    }

    /**
     * What a level groups by: the field itself, or its calendar parts. A
     * date/time is converted to the user's time zone first, so its day is the
     * day the grid shows.
     */
    private static List<String> expressions(Level lv) {
        String api = GridDescribe.apiName(lv.f);
        if (lv.unit == null) {
            return new List<String>{ api };
        }
        Boolean isDateTime = lv.d.getType() == Schema.DisplayType.DATETIME;
        String v = isDateTime ? 'convertTimezone(' + api + ')' : api;
        switch on lv.unit {
            when 'day', 'week' {
                // A week is read by its days and added up (foldDays).
                return new List<String>{ isDateTime ? 'DAY_ONLY(' + v + ')' : api };
            }
            when 'fiscal_quarter' {
                return new List<String>{ 'FISCAL_YEAR(' + v + ')', 'FISCAL_QUARTER(' + v + ')' };
            }
            when 'fiscal_year' {
                return new List<String>{ 'FISCAL_YEAR(' + v + ')' };
            }
            when 'month' {
                return new List<String>{ 'CALENDAR_YEAR(' + v + ')', 'CALENDAR_MONTH(' + v + ')' };
            }
            when 'quarter' {
                return new List<String>{ 'CALENDAR_YEAR(' + v + ')', 'CALENDAR_QUARTER(' + v + ')' };
            }
            when else {
                return new List<String>{ 'CALENDAR_YEAR(' + v + ')' };
            }
        }
    }

    /** A group's key for one level; see the class comment for the forms. */
    private static String keyOf(Level lv, AggregateResult ar, Integer i) {
        Object a = ar.get('g' + i + 'a');
        if (a == null) {
            return null;
        }
        switch on lv.unit {
            when 'day' {
                return String.valueOf((Date) a);
            }
            when 'week' {
                // The first day of the week in the user's locale: Sunday in the
                // United States, Monday in most of Europe (Date.toStartOfWeek).
                return String.valueOf(((Date) a).toStartOfWeek());
            }
            when 'fiscal_quarter' {
                return 'FY' + String.valueOf(a) + '-Q' + String.valueOf(ar.get('g' + i + 'b'));
            }
            when 'fiscal_year' {
                return 'FY' + String.valueOf(a);
            }
            when 'month' {
                return String.valueOf(a) + '-' + String.valueOf(ar.get('g' + i + 'b')).leftPad(2, '0');
            }
            when 'quarter' {
                return String.valueOf(a) + '-Q' + String.valueOf(ar.get('g' + i + 'b'));
            }
            when else {
                return String.valueOf(a);
            }
        }
    }

    /** A subtotal value as the browser reads it: a decimal string, an ISO date, or an ISO date/time in GMT. */
    private static Object plain(Object value, Schema.DescribeFieldResult d) {
        if (value == null) {
            return null;
        }
        if (d.getType() == Schema.DisplayType.DATE) {
            return String.valueOf((Date) value);
        }
        if (d.getType() == Schema.DisplayType.DATETIME) {
            return ((Datetime) value).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        }
        return ((Decimal) value).toPlainString();
    }
}
