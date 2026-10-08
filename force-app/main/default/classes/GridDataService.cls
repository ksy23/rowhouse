/**
 * GridDataService — reads pages of records through Database.PaginationCursor.
 *
 * WHAT THE CURSOR GIVES, AND WHAT IT DOES NOT
 * A pagination cursor is snapshot-stable and skips rows deleted after it
 * opened (GridDataServiceTest proves both).
 *
 * ONE CURSOR PER QUERY, NOT PER PAGE
 * Opening a cursor runs the whole query, and the org is charged every row of
 * the result against a daily budget shared by the whole org
 * (DailyApexCursorRowsLimit, 100 million), however few rows are then fetched:
 * a cursor over 50,000 rows costs 50,000 even for a 10-row page (measured).
 * So the cursor is opened once, on the first page, and handed to
 * the browser as a token (Salesforce's documented pattern for scrolling UIs);
 * the next request hands it back. The locator carries the query's
 * fingerprint, the next index and the row count, and is checked as before.
 *
 * A handed-back cursor is not trusted (HR-6). The platform refuses another
 * user's cursor, and the rows it returns must be this query's: the same object,
 * no field outside this grid's select list. A cursor that has expired (two
 * days) or cannot be used is replaced by a fresh one on the same query; rows are
 * ordered with an Id tiebreak, so that is deterministic, and a row inserted or
 * deleted in between can shift the page by one, which the client de-duplicates
 * by Id.
 *
 * LIMITS (measured in a Developer Edition org, not assumed)
 *   2,000 rows per fetchPage, 100,000 rows per cursor,
 *   Limits.getLimitFetchCallsOnApexCursor() = 100 fetch calls per transaction.
 */
public with sharing class GridDataService {
    public static final Integer DEFAULT_PAGE_SIZE = 200;
    public static final Integer MAX_PAGE_SIZE = 2000;
    @TestVisible
    private static final String FOREIGN_LOCATOR = 'The page locator does not belong to this query. Reload the grid.';

    /** Cursors opened in this transaction, by query fingerprint. */
    private static Map<String, Database.PaginationCursor> openCursors = new Map<String, Database.PaginationCursor>();

    /** Tests: forget this transaction's cursors, as a new request would. */
    @TestVisible
    private static void forgetOpenCursors() {
        openCursors.clear();
    }

    private static final Set<Schema.DisplayType> SEARCHABLE_TYPES = new Set<Schema.DisplayType>{
        Schema.DisplayType.STRING,
        Schema.DisplayType.EMAIL,
        Schema.DisplayType.PHONE,
        Schema.DisplayType.URL,
        Schema.DisplayType.PICKLIST,
        Schema.DisplayType.COMBOBOX
    };

    public static GridPage fetchPage(GridRequest request) {
        Schema.SObjectType objectType = GridDescribe.typeFor(request.objectApiName);
        GridSecurity.requireRead(objectType);

        GridPage page = new GridPage();
        List<String> selectList = new List<String>{ 'Id' };
        Set<String> selectedLower = new Set<String>{ 'id' };

        for (String requested : request.fields) {
            GridPaths.FieldPath fp = GridPaths.resolve(objectType, requested);
            Schema.SObjectField f = fp.field;
            String local = fp.local;
            if (!GridSecurity.canReadPath(fp)) {
                // The query must not even name the field: in user mode that throws.
                page.strippedFields.add(local);
                continue;
            }
            String api = fp.soql;
            if (selectedLower.add(api.toLowerCase())) {
                selectList.add(api);
            }
            page.selectedFields.add(local);
            if (fp.isPath()) {
                // A parent record's field, and the Id of the record that holds it,
                // which an edit is saved to (GridSaveService).
                page.paths.put(local, fp);
                if (selectedLower.add(fp.holderIdSoql.toLowerCase())) {
                    selectList.add(fp.holderIdSoql);
                }
                // The row carries the first lookup's record, and the platform fills in
                // that lookup's Id too (measured): both belong to this query.
                belongs(selectedLower, fp.relationships[0]);
                belongs(selectedLower, GridDescribe.apiName(fp.hops[0]));
            }
            Schema.DescribeFieldResult d = f.getDescribe();
            // A lookup shows its record's name, read in the same query.
            String path = d.getType() == Schema.DisplayType.REFERENCE && GridSecurity.canReadName(f)
                ? namePathOf(fp)
                : null;
            if (path != null && selectedLower.add(path.toLowerCase())) {
                selectList.add(path);
                page.namePaths.put(local, path);
                // The row carries the related record under its relationship
                // name, with or without the package namespace (HR-4); requireThisQuery
                // must know it belongs to this query.
                belongs(selectedLower, path.substringBefore('.'));
            }
        }

        // What the grid's formulas read, once, after the columns.
        for (String path : request.formulaPaths) {
            if (selectedLower.add(path.toLowerCase())) {
                selectList.add(path);
            }
            if (path.contains('.')) {
                String relationship = path.substringBefore('.');
                selectedLower.add(relationship.toLowerCase());
                selectedLower.add(stripNamespace(relationship).toLowerCase());
            }
        }

        String soql = 'SELECT ' + String.join(selectList, ', ') + ' FROM ' + GridDescribe.apiName(objectType);
        Map<String, Object> binds = new Map<String, Object>();
        List<String> conditions = conditionsFor(request, objectType, binds);
        if (!conditions.isEmpty()) {
            soql += ' WHERE ' + String.join(conditions, ' AND ');
        }
        soql += orderBy(objectType, request);

        String fingerprint = EncodingUtil.convertToHex(
                Crypto.generateDigest('SHA-256', Blob.valueOf(soql + '|' + JSON.serialize(binds)))
            )
            .left(16);
        List<Integer> position = readLocator(request.cursorLocator, fingerprint);
        Integer start = position[0];
        Integer size = request.pageSize == null
            ? DEFAULT_PAGE_SIZE
            : Math.max(1, Math.min(MAX_PAGE_SIZE, request.pageSize));

        Database.PaginationCursor cursor = openCursors.get(fingerprint);
        if (
            cursor == null &&
            start > 0 &&
            continueOnHandedBack(
                page,
                request.cursorToken,
                new List<Integer>{ start, size, position[1] },
                fingerprint,
                objectType,
                selectedLower
            )
        ) {
            return page;
        }
        if (cursor == null) {
            cursor = GridSecurity.openCursor(soql, binds);
            openCursors.put(fingerprint, cursor);
        }
        fill(page, cursor, new List<Integer>{ start, size, null }, fingerprint);
        page.cursorToken = JSON.serialize(cursor);
        return page;
    }

    /** A relationship the rows carry belongs to this query, with or without the namespace (HR-4). */
    private static void belongs(Set<String> selectedLower, String relationship) {
        selectedLower.add(relationship.toLowerCase());
        selectedLower.add(stripNamespace(relationship).toLowerCase());
    }

    /**
     * The SOQL path of a lookup's display name, for a lookup of the grid's
     * object ('Account.Name') or one on a parent record ('Account.Parent.Name').
     */
    private static String namePathOf(GridPaths.FieldPath fp) {
        String own = GridDescribe.namePath(fp.field);
        if (own == null || !fp.isPath()) {
            return own;
        }
        return String.join(fp.relationships, '.') + '.' + own;
    }

    /**
     * The request's WHERE conditions, each a bound clause: the Ids asked for,
     * a child grid's parent, the search, and the admin's, the user's and
     * the record page's filters. The rows, and the records a
     * delete of every match reaches (idsMatching), filter through here.
     */
    private static List<String> conditionsFor(
        GridRequest request,
        Schema.SObjectType objectType,
        Map<String, Object> binds
    ) {
        List<String> conditions = new List<String>();
        if (request.recordIds != null) {
            conditions.add('Id IN :recordIds');
            binds.put('recordIds', request.recordIds);
        }
        String parent = parentCondition(request.parentField, request.parentId, binds);
        if (parent != null) {
            conditions.add(parent);
        }
        String search = searchCondition(objectType, request.fields, request.searchTerm, binds);
        if (search != null) {
            conditions.add(search);
        }
        conditions.addAll(GridFilters.clauses(objectType, request.conditions, binds));
        return conditions;
    }

    /**
     * The Ids of the records the request matches, in Id order, after `afterId`
     * (null for the first), at most `max`: what "delete every matching
     * record" deletes, a slice at a time. In user mode, so only records the
     * user can see. `afterId` comes from the browser: it must be a record of
     * the request's object (HR-6).
     */
    public static List<Id> idsMatching(GridRequest request, Id afterId, Integer max) {
        Schema.SObjectType objectType = GridDescribe.typeFor(request.objectApiName);
        GridSecurity.requireRead(objectType);
        Map<String, Object> binds = new Map<String, Object>();
        List<String> conditions = conditionsFor(request, objectType, binds);
        if (afterId != null) {
            if (afterId.getSObjectType() != objectType) {
                throw new GridException('Record ' + afterId + ' is not a ' + GridDescribe.localName(objectType) + '.');
            }
            conditions.add('Id > :afterId');
            binds.put('afterId', afterId);
        }
        String soql =
            'SELECT Id FROM ' +
            GridDescribe.apiName(objectType) +
            (conditions.isEmpty() ? '' : ' WHERE ' + String.join(conditions, ' AND ')) +
            ' ORDER BY Id LIMIT ' +
            Math.max(1, Math.min(MAX_PAGE_SIZE, max == null ? MAX_PAGE_SIZE : max));
        List<Id> out = new List<Id>();
        for (SObject r : GridSecurity.query(soql, binds)) {
            out.add(r.Id);
        }
        return out;
    }

    /**
     * Continue on the cursor the browser handed back. False when it cannot be
     * used (none, expired, another user's, not a cursor): the caller then opens
     * a fresh one. Throws when it CAN be used but belongs to another query.
     */
    private static Boolean continueOnHandedBack(
        GridPage page,
        String token,
        List<Integer> window,
        String fingerprint,
        Schema.SObjectType objectType,
        Set<String> selectedLower
    ) {
        Database.PaginationCursor cursor = GridSecurity.resumeCursor(token);
        if (cursor == null) {
            return false;
        }
        try {
            fill(page, cursor, window, fingerprint);
        } catch (System.FatalCursorException e) {
            return false; // expired, or not this user's: "Apex Cursor not found"
        } catch (System.TransientCursorException e) {
            return false; // documented as retryable; a fresh cursor is the retry
        } catch (System.InvalidParameterValueException e) {
            return false; // "Fetch beyond bound": the locator's row count was wrong
        }
        requireThisQuery(page.rows, objectType, selectedLower);
        openCursors.put(fingerprint, cursor);
        page.cursorToken = token;
        return true;
    }

    /**
     * HR-6: rows from a handed-back cursor must be rows of THIS query. One row
     * is enough: every row of a cursor has the same object and select list.
     */
    private static void requireThisQuery(List<SObject> rows, Schema.SObjectType objectType, Set<String> selectedLower) {
        if (rows.isEmpty()) {
            return;
        }
        Boolean same = rows[0].getSObjectType() == objectType;
        for (String f : rows[0].getPopulatedFieldsAsMap().keySet()) {
            same = same && selectedLower.contains(f.toLowerCase());
        }
        if (!same) {
            throw new GridException(FOREIGN_LOCATOR);
        }
    }

    /**
     * One page from the cursor, into the page: rows, total, and where to go next.
     * window = [start, page size, row count or null]. With a row count (from
     * the locator), the cursor is fetched from BEFORE it is asked for its own
     * count: on an unknown or expired cursor fetchPage throws a catchable
     * FatalCursorException, while getNumRecords fails with an internal
     * "Salesforce System Error" that no catch block stops (measured).
     * A cursor this request opened is asked first, as before.
     */
    private static void fill(
        GridPage page,
        Database.PaginationCursor cursor,
        List<Integer> window,
        String fingerprint
    ) {
        Integer start = window[0];
        Integer size = window[1];
        Integer total = window[2] == null ? cursor.getNumRecords() : window[2];
        page.totalRows = total;
        if (start < total) {
            // fetchPage throws "Fetch beyond bound detected" when start + count
            // runs past the end, rather than returning a short page. Clamp.
            Database.CursorFetchResult result = cursor.fetchPage(start, Math.min(size, total - start));
            if (window[2] != null) {
                page.totalRows = cursor.getNumRecords(); // safe now: the fetch proved the cursor
            }
            page.rows = result.getRecords();
            // Measured in a Developer Edition org (API 67): when a fetch reaches the last row,
            // getNextIndex() returns 0, not the row count. Read literally, that
            // restarts paging from the top. An index at or before the start
            // therefore means "no more rows".
            Integer next = result.getNextIndex();
            if (next <= start) {
                next = page.totalRows;
            }
            page.hasMore = next < page.totalRows;
            page.cursorLocator = page.hasMore ? fingerprint + ':' + next + ':' + page.totalRows : null;
        }
    }

    /**
     * A child grid's parent filter, or null for a top-level grid. The
     * field is an API name GridNesting took from describe; the Id is bound. The
     * rows and the subtotals both filter through here.
     */
    public static String parentCondition(String fieldApiName, Id parentId, Map<String, Object> binds) {
        if (String.isBlank(fieldApiName) || parentId == null) {
            return null;
        }
        binds.put('parentId', parentId);
        return fieldApiName + ' = :parentId';
    }

    /**
     * The quick-search condition over the grid's fields, or null with no term:
     * every readable, filterable text-like field, and a lookup's name, LIKE the
     * term, which is bound, never concatenated (TC-021). A term with nothing to
     * search matches nothing. The rows and the subtotals both filter
     * through here, so a group's count is the count of its rows.
     */
    public static String searchCondition(
        Schema.SObjectType objectType,
        List<String> fields,
        String term,
        Map<String, Object> binds
    ) {
        if (String.isBlank(term)) {
            return null;
        }
        List<String> searchable = new List<String>();
        Set<String> seen = new Set<String>();
        for (String requested : fields) {
            GridPaths.FieldPath fp = GridPaths.resolve(objectType, requested);
            Schema.SObjectField f = fp.field;
            if (!GridSecurity.canReadPath(fp)) {
                continue;
            }
            Schema.DescribeFieldResult d = f.getDescribe();
            String api = fp.soql;
            // An encrypted field cannot be searched with LIKE (GridDescribe.isEncrypted).
            if (
                SEARCHABLE_TYPES.contains(d.getType()) &&
                d.isFilterable() &&
                !GridDescribe.isEncrypted(d) &&
                seen.add(api.toLowerCase())
            ) {
                searchable.add(api);
            }
            String path = d.getType() == Schema.DisplayType.REFERENCE && GridSecurity.canReadName(f)
                ? namePathOf(fp)
                : null;
            if (path != null && seen.add(path.toLowerCase())) {
                searchable.add(path);
            }
        }
        if (searchable.isEmpty()) {
            return 'Id = null';
        }
        List<String> likes = new List<String>();
        for (String path : searchable) {
            likes.add(path + ' LIKE :searchTerm');
        }
        binds.put('searchTerm', '%' + escapeLike(term.trim()) + '%');
        return '(' + String.join(likes, ' OR ') + ')';
    }

    /**
     * ORDER BY with an explicit NULLS LAST (the SOQL default for ASC is NULLS
     * FIRST, and the client sorts nulls last — the two must agree), and an Id
     * tiebreak so re-opening the same query always gives the same order.
     *
     * A grouped grid orders by its group fields first, ascending unless
     * the user sorted that column the other way, so each group's rows arrive
     * together. A lookup orders by the name shown and then by the Id, so two
     * records with the same name still make two groups, each in one piece.
     */
    private static String orderBy(Schema.SObjectType objectType, GridRequest request) {
        List<String> keys = new List<String>();
        Set<String> used = new Set<String>();
        for (String groupField : request.groupFields) {
            GridPaths.FieldPath fp = sortableField(objectType, groupField, 'group');
            String direction = groupField.equalsIgnoreCase(request.sortField) &&
                'desc'.equalsIgnoreCase(request.sortDirection)
                ? 'DESC'
                : 'ASC';
            String path = namePathFor(fp);
            if (path != null) {
                keys.add(path + ' ' + direction + ' NULLS LAST');
            }
            keys.add(fp.soql + ' ' + direction + ' NULLS LAST');
            used.add(fp.local.toLowerCase());
        }
        if (String.isNotBlank(request.sortField)) {
            GridPaths.FieldPath fp = sortableField(objectType, request.sortField, 'sort');
            if (!used.contains(fp.local.toLowerCase())) {
                String direction = 'desc'.equalsIgnoreCase(request.sortDirection) ? 'DESC' : 'ASC';
                // A lookup sorts by the name the user sees, not by the record Id.
                String path = namePathFor(fp);
                keys.add((path != null ? path : fp.soql) + ' ' + direction + ' NULLS LAST');
            }
        }
        keys.add('Id ASC');
        return ' ORDER BY ' + String.join(keys, ', ');
    }

    /**
     * A field, or a parent record's field, the user can read and SOQL can
     * order by; otherwise the grid cannot sort (or group) by it.
     */
    private static GridPaths.FieldPath sortableField(Schema.SObjectType objectType, String name, String verb) {
        GridPaths.FieldPath fp = GridPaths.resolve(objectType, name);
        Schema.DescribeFieldResult d = fp.field.getDescribe();
        if (!GridSecurity.canReadPath(fp) || !d.isSortable() || GridDescribe.isEncrypted(d)) {
            throw new GridException('Cannot ' + verb + ' by ' + GridDescribe.localName(objectType) + '.' + name + '.');
        }
        return fp;
    }

    /** The name path a lookup shows and sorts by, or null. */
    private static String namePathFor(GridPaths.FieldPath fp) {
        return fp.field.getDescribe().getType() == Schema.DisplayType.REFERENCE && GridSecurity.canReadName(fp.field)
            ? namePathOf(fp)
            : null;
    }

    /** 'ns__Account__r' to 'Account__r'; a name without a namespace is unchanged. */
    private static String stripNamespace(String name) {
        List<String> parts = name.split('__');
        return parts.size() > 2 ? name.substringAfter('__') : name;
    }

    /**
     * Validate a locator against this query: [next index, row count], or
     * [0, null] for a first page. A locator for another query is refused.
     */
    private static List<Integer> readLocator(String locator, String fingerprint) {
        if (String.isBlank(locator)) {
            return new List<Integer>{ 0, null };
        }
        List<String> parts = locator.split(':');
        if (parts.size() != 3 || parts[0] != fingerprint || !isIndex(parts[1]) || !isIndex(parts[2])) {
            throw new GridException(FOREIGN_LOCATOR);
        }
        return new List<Integer>{ Integer.valueOf(parts[1]), Integer.valueOf(parts[2]) };
    }

    /** Digits that fit an Integer: a cursor holds at most 100,000 rows. */
    private static Boolean isIndex(String s) {
        return s.isNumeric() && s.length() <= 9;
    }

    /** Escape LIKE wildcards so a search for "%" finds a percent sign (TC-021). */
    public static String escapeLike(String term) {
        return term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_');
    }
}
