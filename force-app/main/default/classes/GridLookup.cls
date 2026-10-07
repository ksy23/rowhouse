/**
 * GridLookup — the typeahead behind lookup and owner cells.
 *
 * Every search runs in user mode through GridSecurity, so it returns only
 * records the user can see (sharing) on objects and name fields the user can
 * read (CRUD and FLS). The field must be an editable lookup or owner column of
 * the named configuration (HR-6): the client names a column, never an object.
 *
 * The term is a bind variable with LIKE wildcards escaped (TC-021), matched
 * anywhere in the name. A contains-match cannot use the name index, so on an
 * object with millions of rows it is slower than Salesforce's own search
 * (SOSL); SOSL was not used because it misses records created in the last few
 * seconds and returns nothing for custom objects that do not allow search.
 */
public with sharing class GridLookup {

    public static final Integer MAX_RESULTS = 20;
    public static final Integer MAX_TERM = 255;

    public static List<Map<String, String>> search(String configName, String fieldName, String term) {
        GridConfig.Definition def = GridConfig.forUser(configName);
        GridConfig.Column column = editableLookup(def, fieldName);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        Schema.SObjectField field = GridDescribe.field(objectType, column.field);
        // No name is longer than 255 characters, so neither is a useful term.
        String contains = '%' + GridDataService.escapeLike(term == null ? '' : term.trim().left(MAX_TERM)) + '%';
        if (column.type == 'owner') {
            return owners(objectType, contains);
        }
        List<Map<String, String>> out = new List<Map<String, String>>();
        for (Schema.SObjectType target : field.getDescribe().getReferenceTo()) {
            Schema.SObjectField name = GridDescribe.nameField(target);
            if (name == null || !GridSecurity.canRead(target) || !GridSecurity.canRead(name) || out.size() >= MAX_RESULTS) {
                continue;
            }
            String nameApi = GridDescribe.apiName(name);
            List<SObject> rows = GridSecurity.query(
                'SELECT Id, ' + nameApi + ' FROM ' + GridDescribe.apiName(target)
                + ' WHERE ' + nameApi + ' LIKE :term ORDER BY ' + nameApi + ' ASC NULLS LAST, Id ASC LIMIT ' + (MAX_RESULTS - out.size()),
                new Map<String, Object>{ 'term' => contains }
            );
            String kind = target.getDescribe(SObjectDescribeOptions.DEFERRED).getLabel();
            String objectName = GridDescribe.localName(target);
            for (SObject r : rows) {
                out.add(result(r.Id, (String) r.get(nameApi), kind, objectName));
            }
        }
        return out;
    }

    /**
     * Owners: active users, then queues that accept this object. Portal and
     * system users (guest, automated process, Chatter-only) cannot own
     * records, so only standard and partner users are offered.
     */
    private static List<Map<String, String>> owners(Schema.SObjectType objectType, String contains) {
        List<Map<String, String>> out = new List<Map<String, String>>();
        for (SObject u : GridSecurity.query(
                'SELECT Id, Name FROM User WHERE IsActive = true AND UserType IN (\'Standard\', \'PowerPartner\')'
                + ' AND Name LIKE :term ORDER BY Name ASC, Id ASC LIMIT ' + MAX_RESULTS,
                new Map<String, Object>{ 'term' => contains })) {
            out.add(result(u.Id, (String) u.get('Name'), 'User', 'User'));
        }
        if (out.size() < MAX_RESULTS) {
            for (SObject q : GridSecurity.query(
                    'SELECT Id, Name FROM Group WHERE Type = \'Queue\' AND Name LIKE :term'
                    + ' AND Id IN (SELECT QueueId FROM QueueSobject WHERE SobjectType = :objectName)'
                    + ' ORDER BY Name ASC, Id ASC LIMIT ' + (MAX_RESULTS - out.size()),
                    new Map<String, Object>{ 'term' => contains, 'objectName' => GridDescribe.apiName(objectType) })) {
                out.add(result(q.Id, (String) q.get('Name'), 'Queue', 'Group'));
            }
        }
        return out;
    }

    /**
     * A record's name, for a lookup cell that has its value but not its name:
     * one chosen in Salesforce's own lookup, or created from the New
     * item. The record must be one of the column's targets, read in user mode;
     * null when it cannot be read.
     */
    public static String nameOf(String configName, String fieldName, Id recordId) {
        GridConfig.Definition def = GridConfig.forUser(configName);
        GridConfig.Column column = editableLookup(def, fieldName);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        Schema.SObjectField field = GridDescribe.field(objectType, column.field);
        if (recordId == null || !field.getDescribe().getReferenceTo().contains(recordId.getSObjectType())) {
            throw new GridException('Record ' + recordId + ' cannot be the value of ' + column.label + '.');
        }
        Schema.SObjectType target = recordId.getSObjectType();
        Schema.SObjectField name = GridDescribe.nameField(target);
        if (name == null || !GridSecurity.canRead(target) || !GridSecurity.canRead(name)) {
            return null;
        }
        String nameApi = GridDescribe.apiName(name);
        List<SObject> rows = GridSecurity.query('SELECT Id, ' + nameApi + ' FROM ' + GridDescribe.apiName(target)
            + ' WHERE Id = :recordId', new Map<String, Object>{ 'recordId' => recordId });
        return rows.isEmpty() ? null : (String) rows[0].get(nameApi);
    }

    /** HR-6: only a lookup or owner column this user may edit, in this grid. */
    private static GridConfig.Column editableLookup(GridConfig.Definition def, String fieldName) {
        for (GridConfig.Column c : def.columns) {
            if (fieldName != null && c.field.equalsIgnoreCase(fieldName.trim())) {
                if (c.editable == true && (c.type == 'reference' || c.type == 'owner')) {
                    return c;
                }
                break;
            }
        }
        throw new GridException('This grid has no editable lookup column "' + fieldName + '".');
    }

    /**
     * One match. `kind` is what the user reads ("Account", "Queue"); `object`
     * is the local API name, which the column's referenceIcons are keyed by.
     */
    private static Map<String, String> result(Id recordId, String name, String kind, String objectName) {
        return new Map<String, String>{ 'id' => recordId, 'name' => name, 'kind' => kind, 'object' => objectName };
    }
}
