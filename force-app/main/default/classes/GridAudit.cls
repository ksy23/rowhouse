/**
 * GridAudit — the optional audit trail. Off unless the grid's
 * configuration sets Log Changes; then every change the grid makes is written
 * to Grid Edit Log:
 *   Update  one entry per field that changed: the value before, read just
 *           before the write, and the value the grid wrote. A field whose
 *           value did not change is not logged. Text compares exactly: Apex's
 *           == ignores case, so "smith" to "Smith" would look unchanged.
 *   Create  one per record an import creates, with its name.
 *   Delete  one per record deleted, with its name as it was.
 *   Restore one per deleted record the grid's Undo put back.
 *   Action  one per record a grid action ran on, naming the action. No values:
 *           the grid cannot see what a flow or Apex changed.
 *   Cleanup one per night the log retention removed entries, written
 *           by GridLogCleanup: how many, and what was older than what.
 * Only what happened is logged: a record that failed to save, delete or run
 * has no entry. Entries written together share a Save Id; a save's is the
 * save's own.
 *
 * WRITTEN AS THE USER, WITH THE CHANGE, ALL OR NOTHING
 * Entries are inserted in user mode (GridSecurity), in the same transaction as
 * the change, as one statement that either writes every entry or throws. A
 * thrown insert undoes the change with it. And before anything is changed,
 * start() checks that this user can write the log, so a user who cannot is
 * refused up front rather than partway. Rowhouse Grid User lets users create
 * entries and read their own; it grants no edit or delete, so an entry cannot
 * be changed or removed by its author. Who and when are the platform's own
 * Created By and Created Date.
 *
 * VALUES, AS TEXT (measured in a Developer Edition org)
 * Dates as 2026-09-30, date/times in UTC ISO 8601, numbers in full (a Double
 * would print as 1.0E20), checkboxes as true or false, lookups as record Ids.
 * Order matters: a Date held as an Object is also an instanceof Datetime,
 * and every number type is an instanceof Decimal. A Shield-encrypted field's
 * values are not copied into the log; its entry says Values Not Recorded.
 *
 * LIMITS
 * A transaction may write 10,000 rows. MAX_ENTRIES caps the entries one
 * transaction writes, leaving room for the change itself and the org's own
 * automation: a save is chunked by it (GridSaveService.chunksOf), and an
 * import batch that would exceed it is refused (the browser sizes batches to
 * fit).
 */
public with sharing class GridAudit {

    /** Entries one transaction may write. */
    public static final Integer MAX_ENTRIES = 5000;
    /** The largest value a Long Text Area holds. */
    private static final Integer MAX_VALUE = 131072;

    public static final String OP_UPDATE = 'Update';
    public static final String OP_CREATE = 'Create';
    public static final String OP_DELETE = 'Delete';
    public static final String OP_ACTION = 'Action';
    public static final String OP_RESTORE = 'Restore';
    /** The nightly clean-up's note of what it removed. */
    public static final String OP_CLEANUP = 'Cleanup';

    /** Every field an entry is written with: the user must be able to set each one. */
    private static final List<Schema.SObjectField> LOG_FIELDS = new List<Schema.SObjectField>{
        Grid_Edit_Log__c.Grid_Configuration__c, Grid_Edit_Log__c.Object__c, Grid_Edit_Log__c.Record_Id__c,
        Grid_Edit_Log__c.Record_Name__c, Grid_Edit_Log__c.Operation__c, Grid_Edit_Log__c.Field__c,
        Grid_Edit_Log__c.Field_Label__c, Grid_Edit_Log__c.Old_Value__c, Grid_Edit_Log__c.New_Value__c,
        Grid_Edit_Log__c.Values_Hidden__c, Grid_Edit_Log__c.Action__c, Grid_Edit_Log__c.Action_Label__c,
        Grid_Edit_Log__c.Save_Id__c
    };

    /** What the entries of one change share. Plain data: it travels with a save's Queueable. */
    public class Context {
        public String configName;
        public String objectName;
        public String saveId;
    }

    /**
     * A context for a grid that logs its changes, or null for one that does
     * not. Throws when the grid logs and this user cannot write the log, so a
     * caller that calls it before changing anything changes nothing.
     */
    public static Context start(GridConfig.Definition def) {
        if (def == null || def.logChanges != true) {
            return null;
        }
        requireLogAccess();
        Context ctx = new Context();
        ctx.configName = def.name;
        ctx.objectName = def.objectApiName;
        ctx.saveId = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        return ctx;
    }

    private static void requireLogAccess() {
        Boolean allowed = GridSecurity.canCreate(Grid_Edit_Log__c.SObjectType);
        for (Schema.SObjectField f : LOG_FIELDS) {
            allowed = allowed && GridSecurity.canSetOnCreate(f);
        }
        if (!allowed) {
            throw new GridException('This grid keeps a log of every change, and you do not have permission to write to it, '
                + 'so nothing was changed. Ask your Salesforce admin for the Rowhouse Grid User permission set.');
        }
    }

    // ---------------------------------------------------------------- reading before a change

    /**
     * The records as they are now, before a change: every field the records
     * about to be written carry, and the name. One query, in user mode; the
     * fields are ones the user may edit, so may read.
     */
    public static Map<Id, SObject> before(Schema.SObjectType objectType, List<SObject> records) {
        List<Id> ids = new List<Id>();
        Set<String> fields = new Set<String>();
        for (SObject r : records) {
            if (r.Id == null) {
                continue;
            }
            ids.add(r.Id);
            for (String key : r.getPopulatedFieldsAsMap().keySet()) {
                if (key != 'Id') {
                    fields.add(GridDescribe.apiName(GridDescribe.field(objectType, key)));
                }
            }
        }
        if (ids.isEmpty()) {
            return new Map<Id, SObject>();
        }
        Schema.SObjectField name = readableName(objectType);
        if (name != null) {
            fields.add(GridDescribe.apiName(name));
        }
        fields.remove('Id');
        String soql = 'SELECT Id' + (fields.isEmpty() ? '' : ', ' + String.join(new List<String>(fields), ', '))
            + ' FROM ' + GridDescribe.apiName(objectType) + ' WHERE Id IN :ids';
        return new Map<Id, SObject>(GridSecurity.query(soql, new Map<String, Object>{ 'ids' => ids }));
    }

    /** { recordId: name } for records about to be deleted or acted on. Empty when the name cannot be read. */
    public static Map<Id, String> namesOf(Schema.SObjectType objectType, List<Id> ids) {
        Map<Id, String> out = new Map<Id, String>();
        Schema.SObjectField name = readableName(objectType);
        if (name == null || ids == null || ids.isEmpty()) {
            return out;
        }
        for (SObject r : GridSecurity.query('SELECT Id, ' + GridDescribe.apiName(name) + ' FROM '
                + GridDescribe.apiName(objectType) + ' WHERE Id IN :ids', new Map<String, Object>{ 'ids' => ids })) {
            out.put(r.Id, r.get(name) == null ? null : String.valueOf(r.get(name)));
        }
        return out;
    }

    // ---------------------------------------------------------------- entries

    /** One Update entry per field that changed on each record that saved. */
    public static List<Grid_Edit_Log__c> updates(Context ctx, Schema.SObjectType objectType, List<SObject> written,
                                                 List<Database.SaveResult> results, Map<Id, SObject> before) {
        List<Grid_Edit_Log__c> out = new List<Grid_Edit_Log__c>();
        if (ctx == null) {
            return out;
        }
        Schema.SObjectField name = readableName(objectType);
        for (Integer i = 0; i < written.size() && i < results.size(); i++) {
            if (!results[i].isSuccess()) {
                continue;
            }
            SObject now = written[i];
            SObject was = before == null ? null : before.get(now.Id);
            String recordName = was == null || name == null || was.get(name) == null ? null : String.valueOf(was.get(name));
            for (String key : now.getPopulatedFieldsAsMap().keySet()) {
                if (key == 'Id') {
                    continue;
                }
                Schema.SObjectField field = GridDescribe.field(objectType, key);
                Object oldValue = was == null ? null : was.get(field);
                Object newValue = now.get(field);
                if (!same(oldValue, newValue)) {
                    out.add(change(ctx, now.Id, recordName, field, oldValue, newValue));
                }
            }
        }
        return out;
    }

    /**
     * One Create entry per record that was created, with its name. The name
     * is read back from the new records when the written ones do not carry it:
     * a Contact's Name is built from First and Last Name, and an auto-number
     * name is given on insert, so neither is on the record the grid wrote.
     */
    public static List<Grid_Edit_Log__c> creates(Context ctx, Schema.SObjectType objectType, List<SObject> written,
                                                 List<Database.SaveResult> results) {
        List<Grid_Edit_Log__c> out = new List<Grid_Edit_Log__c>();
        if (ctx == null) {
            return out;
        }
        Schema.SObjectField name = readableName(objectType);
        List<Id> unnamed = new List<Id>();
        for (Integer i = 0; i < written.size() && i < results.size(); i++) {
            if (results[i].isSuccess() && name != null && written[i].get(name) == null) {
                unnamed.add(results[i].getId());
            }
        }
        Map<Id, String> readBack = namesOf(objectType, unnamed);
        for (Integer i = 0; i < written.size() && i < results.size(); i++) {
            if (results[i].isSuccess()) {
                Object recordName = name == null ? null : written[i].get(name);
                String shown = recordName != null ? String.valueOf(recordName) : readBack.get(results[i].getId());
                out.add(entry(ctx, OP_CREATE, results[i].getId(), shown));
            }
        }
        return out;
    }

    /** One Delete entry per record deleted, named as it was. */
    public static List<Grid_Edit_Log__c> deletes(Context ctx, List<Id> deletedIds, Map<Id, String> names) {
        List<Grid_Edit_Log__c> out = new List<Grid_Edit_Log__c>();
        if (ctx == null) {
            return out;
        }
        for (Id recordId : deletedIds) {
            out.add(entry(ctx, OP_DELETE, recordId, names == null ? null : names.get(recordId)));
        }
        return out;
    }

    /** One Restore entry per deleted record put back. */
    public static List<Grid_Edit_Log__c> restores(Context ctx, List<Id> restoredIds, Map<Id, String> names) {
        List<Grid_Edit_Log__c> out = new List<Grid_Edit_Log__c>();
        if (ctx == null) {
            return out;
        }
        for (Id recordId : restoredIds) {
            out.add(entry(ctx, OP_RESTORE, recordId, names == null ? null : names.get(recordId)));
        }
        return out;
    }

    /** One Action entry per record the action ran on. */
    public static List<Grid_Edit_Log__c> actions(Context ctx, GridConfig.Action action, List<Id> ranOn, Map<Id, String> names) {
        List<Grid_Edit_Log__c> out = new List<Grid_Edit_Log__c>();
        if (ctx == null) {
            return out;
        }
        for (Id recordId : ranOn) {
            Grid_Edit_Log__c e = entry(ctx, OP_ACTION, recordId, names == null ? null : names.get(recordId));
            e.Action__c = action.name;
            e.Action_Label__c = action.label == null ? null : action.label.left(80);
            out.add(e);
        }
        return out;
    }

    /**
     * Write the entries: one statement, all or nothing, in user mode. A
     * failure throws, and the caller's change is undone with it.
     */
    public static void write(List<Grid_Edit_Log__c> entries) {
        if (entries == null || entries.isEmpty()) {
            return;
        }
        if (entries.size() > MAX_ENTRIES) {
            throw new GridException('This change would write ' + entries.size() + ' log entries; at most ' + MAX_ENTRIES
                + ' can be written at once. Nothing was changed.');
        }
        try {
            GridSecurity.insertOwnRecords(entries);
        } catch (DmlException e) {
            throw new GridException('The change was not made because its log entry could not be written: ' + e.getDmlMessage(0));
        }
    }

    // ---------------------------------------------------------------- helpers

    /** The fields a record about to be written carries, the Id aside: the most entries it can log. */
    public static Integer cellsOf(SObject record) {
        Integer n = 0;
        for (String key : record.getPopulatedFieldsAsMap().keySet()) {
            if (key != 'Id') {
                n++;
            }
        }
        return n;
    }

    private static Grid_Edit_Log__c entry(Context ctx, String operation, Id recordId, String recordName) {
        return new Grid_Edit_Log__c(
            Grid_Configuration__c = ctx.configName,
            Object__c = ctx.objectName,
            Save_Id__c = ctx.saveId,
            Operation__c = operation,
            Record_Id__c = recordId == null ? null : String.valueOf(recordId),
            Record_Name__c = recordName == null ? null : recordName.left(255)
        );
    }

    private static Grid_Edit_Log__c change(Context ctx, Id recordId, String recordName, Schema.SObjectField field,
                                           Object oldValue, Object newValue) {
        Grid_Edit_Log__c e = entry(ctx, OP_UPDATE, recordId, recordName);
        Schema.DescribeFieldResult d = field.getDescribe();
        e.Field__c = d.getLocalName();
        e.Field_Label__c = d.getLabel().left(80);
        if (d.isEncrypted()) {
            e.Values_Hidden__c = true; // Shield-encrypted: never copied into the log in clear
        } else {
            e.Old_Value__c = text(oldValue);
            e.New_Value__c = text(newValue);
        }
        return e;
    }

    /** The record's name field, when this user may read it; null otherwise. */
    private static Schema.SObjectField readableName(Schema.SObjectType objectType) {
        Schema.SObjectField name = GridDescribe.nameField(objectType);
        return name != null && GridSecurity.canRead(name) ? name : null;
    }

    /** A field's value as the log writes it. See VALUES, AS TEXT, above, for why the order matters. */
    @TestVisible
    private static String text(Object value) {
        if (value == null) {
            return null;
        }
        String out;
        if (value instanceof Datetime && !(value instanceof Date)) {
            out = ((Datetime) value).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        } else if (value instanceof Date) {
            out = dateText((Date) value);
        } else if (value instanceof Decimal) {
            out = Decimal.valueOf(String.valueOf(value)).toPlainString();
        } else {
            out = String.valueOf(value);
        }
        return out.length() > MAX_VALUE ? out.left(MAX_VALUE) : out;
    }

    private static String dateText(Date d) {
        return String.valueOf(d.year()) + '-' + String.valueOf(d.month()).leftPad(2, '0') + '-' + String.valueOf(d.day()).leftPad(2, '0');
    }

    /** Did the value stay the same? Text exactly (Apex's == ignores case); an empty string is blank. */
    @TestVisible
    private static Boolean same(Object a, Object b) {
        Object x = a instanceof String && ((String) a).length() == 0 ? null : a;
        Object y = b instanceof String && ((String) b).length() == 0 ? null : b;
        if (x == null || y == null) {
            return x == null && y == null;
        }
        if (x instanceof String && y instanceof String) {
            return ((String) x).equals((String) y);
        }
        return x == y;
    }
}
