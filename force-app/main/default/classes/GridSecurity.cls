/**
 * GridSecurity — the single choke point for every access decision (HR-5).
 *
 * Rowhouse builds SOQL dynamically from admin configuration, which is the
 * highest-scrutiny shape in an AppExchange security review. The defence is that
 * a reviewer can read ONE class and see every FLS check, every CRUD check,
 * every permission check and every access-mode choice in the package, and
 * every query and every save. scripts/checks/run-all.js fails the build if
 * isAccessible / isUpdateable / stripInaccessible / AccessLevel /
 * WITH USER_MODE, a static query, a Database query or DML method, a DML
 * statement or FeatureManagement appears in any other class.
 *
 * Everything here runs in USER mode (HR-8: API 67+, where user mode is also the
 * default). There is no system-mode path at all: a single SYSTEM_MODE call would
 * silently void every assertion in GridSecurityTest, because System.runAs only
 * enforces field permissions while the code under test runs in user mode.
 */
public with sharing class GridSecurity {
    /** A real cursor token is about 30 characters: {"queryId":"0r8..."}. */
    private static final Integer MAX_CURSOR_TOKEN = 200;

    // ------------------------------------------------------------ object level

    public static Boolean canRead(Schema.SObjectType objectType) {
        return objectType.getDescribe(SObjectDescribeOptions.DEFERRED).isAccessible();
    }

    public static Boolean canUpdate(Schema.SObjectType objectType) {
        return objectType.getDescribe(SObjectDescribeOptions.DEFERRED).isUpdateable();
    }

    public static Boolean canDelete(Schema.SObjectType objectType) {
        return objectType.getDescribe(SObjectDescribeOptions.DEFERRED).isDeletable();
    }

    public static Boolean canCreate(Schema.SObjectType objectType) {
        return objectType.getDescribe(SObjectDescribeOptions.DEFERRED).isCreateable();
    }

    public static void requireRead(Schema.SObjectType objectType) {
        if (!canRead(objectType)) {
            throw new GridException('You do not have access to ' + GridDescribe.localName(objectType) + '.');
        }
    }

    public static void requireUpdate(Schema.SObjectType objectType) {
        if (!canUpdate(objectType)) {
            throw new GridException(
                'You do not have permission to edit ' + GridDescribe.localName(objectType) + ' records.'
            );
        }
    }

    public static void requireCreate(Schema.SObjectType objectType) {
        if (!canCreate(objectType)) {
            throw new GridException(
                'You do not have permission to create ' + GridDescribe.localName(objectType) + ' records.'
            );
        }
    }

    public static void requireDelete(Schema.SObjectType objectType) {
        if (!canDelete(objectType)) {
            throw new GridException(
                'You do not have permission to delete ' + GridDescribe.localName(objectType) + ' records.'
            );
        }
    }

    // ------------------------------------------------------------- field level

    public static Boolean canRead(Schema.SObjectField field) {
        return field.getDescribe().isAccessible();
    }

    /**
     * Can this user read a lookup's display name? The target object and
     * its name field must both be readable. The platform's polymorphic Name,
     * which an Owner reads, is readable to anyone who can read the record.
     */
    public static Boolean canReadName(Schema.SObjectField reference) {
        List<Schema.SObjectType> targets = reference.getDescribe().getReferenceTo();
        if (targets.size() != 1) {
            return true;
        }
        Schema.SObjectField name = GridDescribe.nameField(targets[0]);
        return name != null && canRead(targets[0]) && canRead(name);
    }

    /** Editable for this user: FLS allows it AND the field type is writable. */
    public static Boolean canEdit(Schema.SObjectField field) {
        return field.getDescribe().isUpdateable();
    }

    /**
     * Can this user set the field on a new record? Import into a child grid
     * fills in the parent; if it could not, the records would be
     * created without one.
     */
    public static Boolean canSetOnCreate(Schema.SObjectField field) {
        return field.getDescribe().isCreateable();
    }

    // ------------------------------------------------------- parent records

    /**
     * Can this user read a column's field on a parent record
     * (GridPaths)? Each lookup on the way, each record it points to, and the
     * field at the end: in user mode a query naming any one the user cannot
     * read fails. A field of the grid's own object is its own check.
     */
    public static Boolean canReadPath(GridPaths.FieldPath p) {
        for (Schema.SObjectField hop : p.hops) {
            if (!canRead(hop) || !canRead(hop.getDescribe().getReferenceTo()[0])) {
                return false;
            }
        }
        return canRead(p.field);
    }

    /**
     * Can this user change a column's field on a parent record? They must
     * read the way there, edit the record that holds it, and edit the field.
     */
    public static Boolean canEditPath(GridPaths.FieldPath p) {
        return canReadPath(p) && canUpdate(p.holder) && canEdit(p.field);
    }

    // ---------------------------------------------------------------- actions

    /** Rowhouse's own custom permissions, which FeatureManagement always answers for. */
    private static final Set<String> OWN_PERMISSIONS = new Set<String>{
        GridAdmin.PERMISSION.toLowerCase(),
        GridException.DIAGNOSTICS.toLowerCase()
    };
    /** A custom permission's API name: Name, or ns__Name for another package's. */
    private static final Pattern PERMISSION_NAME = Pattern.compile(
        '^(?:([A-Za-z][A-Za-z0-9]*)__)?([A-Za-z][A-Za-z0-9_]{0,79})$'
    );
    /** What hasCustomPermission answered this transaction, by user and name. */
    private static Map<String, Boolean> heldPermissions = new Map<String, Boolean>();
    /** Tests: skip FeatureManagement, so that reading the user's assignments answers alone. */
    @TestVisible
    private static Boolean readAssignmentsOnly = false;

    /**
     * Does the running user hold this custom permission? A blank name asks
     * for nothing; an unknown name is false. Every custom permission check in
     * Rowhouse comes here: Rowhouse Grid Admin and Rowhouse Grid Diagnostics,
     * and an action's own Required Permission.
     *
     * FeatureManagement answers for Rowhouse's own permissions and for another
     * package's, named with its prefix. From the installed package it does not
     * see the org's own custom permissions: it said false for one the user held
     * (measured in an installed org). So for a name it does not find, other than
     * Rowhouse's own, the user's active permission set assignments are read in
     * user mode (grantedByAssignment).
     */
    public static Boolean hasCustomPermission(String apiName) {
        if (String.isBlank(apiName)) {
            return true;
        }
        String name = apiName.trim();
        String key = UserInfo.getUserId() + ':' + name.toLowerCase();
        Boolean held = heldPermissions.get(key);
        if (held == null) {
            held = !readAssignmentsOnly && FeatureManagement.checkPermission(name);
            if (!held && !OWN_PERMISSIONS.contains(GridDescribe.withoutNamespace(name).toLowerCase())) {
                held = grantedByAssignment(name);
            }
            heldPermissions.put(key, held);
        }
        return held;
    }

    /**
     * Does a permission set, permission set group or profile the running user
     * holds grant this custom permission? Read in user mode, which lets a user
     * read their own: the custom permission of that name (the org's own, or
     * with a prefix, that package's), and whether one of their active
     * assignments grants it. An assignment of a session-based permission set
     * that is not switched on does not count, nor does a permission muted in a
     * group: measured, these gave the same answers as FeatureManagement for a
     * user who held the permission, one who did not, and one whose group muted
     * it. False on any failure.
     */
    private static Boolean grantedByAssignment(String name) {
        Matcher m = PERMISSION_NAME.matcher(name);
        if (!m.matches()) {
            return false;
        }
        String prefix = m.group(1);
        String own = String.isBlank(GridDescribe.NAMESPACE) ? null : GridDescribe.NAMESPACE;
        try {
            // A name without a prefix is the org's own, or Rowhouse's in its own build.
            List<SObject> permissions = query(
                'SELECT Id FROM CustomPermission WHERE DeveloperName = :name AND ' +
                (prefix == null ? '(NamespacePrefix = null OR NamespacePrefix = :ns)' : 'NamespacePrefix = :ns'),
                new Map<String, Object>{ 'name' => m.group(2), 'ns' => prefix == null ? own : prefix }
            );
            if (permissions.isEmpty()) {
                return false;
            }
            Set<Id> ids = new Map<Id, SObject>(permissions).keySet();
            return !query(
                    'SELECT Id FROM SetupEntityAccess WHERE SetupEntityId IN :ids AND ParentId IN ' +
                    '(SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = :me AND IsActive = true) LIMIT 1',
                    new Map<String, Object>{ 'ids' => ids, 'me' => UserInfo.getUserId() }
                )
                .isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Does the running user hold Customize Application? Saving a grid
     * configuration deploys Custom Metadata, which needs it, and a packaged
     * permission set cannot grant it. Read from UserPermissionAccess, the
     * running user's effective permissions as Salesforce works them out from
     * their profile, permission sets and permission set groups, rather than by
     * counting permission set assignments, which would also count a permission
     * muted in a group or a session-based permission set not switched on. In
     * user mode; when it cannot be read, the user does not hold it.
     */
    public static Boolean canCustomizeApplication() {
        return holdsUserPermission(
            'SELECT PermissionsCustomizeApplication FROM UserPermissionAccess LIMIT 1',
            'PermissionsCustomizeApplication'
        );
    }

    /**
     * Does the running user hold View Setup and Configuration? The Grid Admin
     * tab then lists fields the admin cannot read, as Setup does, so a grid can
     * be built for people who can. Read as canCustomizeApplication is.
     */
    public static Boolean canViewSetup() {
        return holdsUserPermission(
            'SELECT PermissionsViewSetup FROM UserPermissionAccess LIMIT 1',
            'PermissionsViewSetup'
        );
    }

    /**
     * Does the running user hold Export Reports? A grid that requires it
     * (Require Export Reports Permission) offers Export only then, as
     * Salesforce does for a report. Read as canCustomizeApplication is.
     */
    public static Boolean canExportReports() {
        return holdsUserPermission(
            'SELECT PermissionsExportReport FROM UserPermissionAccess LIMIT 1',
            'PermissionsExportReport'
        );
    }

    /** The running user's UserPermissionAccess row says true for this permission; false on any failure. */
    private static Boolean holdsUserPermission(String soql, String permission) {
        try {
            List<SObject> rows = query(soql, new Map<String, Object>());
            return !rows.isEmpty() && (Boolean) rows[0].get(permission) == true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * The records of these Ids the user can see, in user mode. A grid
     * action runs only on these: one the user cannot see, or that was deleted,
     * is not run. Sharing decides, as for any query here.
     */
    public static Set<Id> visibleIds(Schema.SObjectType objectType, List<Id> ids) {
        Set<Id> out = new Set<Id>();
        if (ids == null || ids.isEmpty()) {
            return out;
        }
        for (
            SObject r : query(
                'SELECT Id FROM ' + GridDescribe.apiName(objectType) + ' WHERE Id IN :ids',
                new Map<String, Object>{ 'ids' => ids }
            )
        ) {
            out.add(r.Id);
        }
        return out;
    }

    // ------------------------------------------------------------- operations

    /** Query in user mode. Callers must already have removed unreadable fields. */
    public static List<SObject> query(String soql, Map<String, Object> binds) {
        return Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE);
    }

    public static Integer countQuery(String soql, Map<String, Object> binds) {
        return Database.countQueryWithBinds(soql, binds, AccessLevel.USER_MODE);
    }

    /** A pagination cursor in user mode: snapshot-stable within the transaction. */
    public static Database.PaginationCursor openCursor(String soql, Map<String, Object> binds) {
        return Database.getPaginationCursorWithBinds(soql, binds, AccessLevel.USER_MODE);
    }

    /**
     * An Apex cursor in user mode, over record Ids only: it finds where each
     * slice of a large subtotal starts. Opening it costs no query rows;
     * each record fetched from it costs one.
     */
    public static Database.Cursor openIdCursor(String soql, Map<String, Object> binds) {
        return Database.getCursorWithBinds(soql, binds, AccessLevel.USER_MODE);
    }

    /**
     * A cursor the browser handed back, or null when the token is blank or is
     * not a cursor. Nothing about it is trusted (HR-6): the platform refuses a
     * cursor another user opened ("Only the user who executed the original
     * query can access additional results", measured), and
     * GridDataService checks that the rows it returns belong to the query
     * being asked for.
     */
    public static Database.PaginationCursor resumeCursor(String token) {
        if (String.isBlank(token) || token.length() > MAX_CURSOR_TOKEN) {
            return null;
        }
        try {
            return (Database.PaginationCursor) JSON.deserialize(token, Database.PaginationCursor.class);
        } catch (Exception e) {
            // Not a cursor at all. The caller opens a fresh one, so a bad token
            // costs a new cursor, never a wrong page.
            return null;
        }
    }

    /**
     * Remove every field the user cannot update from EVERY populated field on
     * the records (HR-6: not just the fields the grid rendered). Returns the
     * decision so the caller can report what was removed.
     */
    public static SObjectAccessDecision stripForUpdate(List<SObject> records) {
        return Security.stripInaccessible(AccessType.UPDATABLE, records);
    }

    /** As stripForUpdate, for new records: every field the user cannot set on create goes. */
    public static SObjectAccessDecision stripForCreate(List<SObject> records) {
        return Security.stripInaccessible(AccessType.CREATABLE, records);
    }

    /** Partial-success insert in user mode. One DML statement. */
    public static List<Database.SaveResult> insertRecords(List<SObject> records) {
        return Database.insert(records, false, AccessLevel.USER_MODE);
    }

    /** Partial-success update in user mode. One DML statement. */
    public static List<Database.SaveResult> updateRecords(List<SObject> records) {
        return Database.update(records, false, AccessLevel.USER_MODE);
    }

    /**
     * Partial-success delete in user mode, after an explicit object check.
     * One DML statement. A record the user may not delete (sharing, a
     * trigger, a child record that blocks it) fails alone and is reported in
     * its DeleteResult. Deleted records go to the Recycle Bin.
     */
    public static List<Database.DeleteResult> deleteRecords(Schema.SObjectType objectType, List<Id> ids) {
        requireDelete(objectType);
        return Database.delete(ids, false, AccessLevel.USER_MODE);
    }

    /**
     * Restore deleted records from the Recycle Bin, in user mode: the
     * platform restores only records this user may restore, and refuses the
     * rest one by one.
     */
    public static List<Database.UndeleteResult> undeleteRecords(Schema.SObjectType objectType, List<Id> ids) {
        requireDelete(objectType);
        return Database.undelete(ids, false, AccessLevel.USER_MODE);
    }

    /**
     * Records that belong to the running user: save-result bookkeeping, and
     * audit-trail entries. All or nothing, in user mode: a failure
     * throws, and the caller's transaction is undone with it.
     */
    public static void insertOwnRecords(List<SObject> records) {
        Database.insert(records, true, AccessLevel.USER_MODE);
    }

    /**
     * Insert or update a record of the running user's own by an external Id,
     * in user mode, all or nothing: a user's layout of a grid, by its Key.
     * Grid User Layout is private, so the user reaches only their own.
     */
    public static void upsertOwnRecord(SObject record, Schema.SObjectField externalId) {
        Database.upsert(record, externalId, true, AccessLevel.USER_MODE);
    }

    /**
     * Empty records this user has just deleted from the Recycle Bin, for good:
     * the edit log's nightly clean-up, so old entries do not crowd
     * out what people deleted on purpose. The platform empties only records
     * the user may delete; there is no access mode to pass.
     */
    public static List<Database.EmptyRecycleBinResult> purgeDeleted(List<Id> ids) {
        return ids == null || ids.isEmpty()
            ? new List<Database.EmptyRecycleBinResult>()
            : Database.emptyRecycleBin(ids);
    }

    public static void deleteOwnRecords(List<SObject> records) {
        if (!records.isEmpty()) {
            Database.delete(records, false, AccessLevel.USER_MODE);
        }
    }
}
