/**
 * DEVELOPMENT ONLY. Never packaged.
 * The edit log fails closed: in a grid that logs its changes (Consignment_Audit), a
 * change that cannot be logged is not made.
 *
 * Two ways a log can fail, each tested for the kinds of change not already
 * covered:
 *   Up front. A user who may not write the log (noLogUser(), without Rowhouse
 *   Grid User) is refused before anything is written, so new rows, an Undo of a
 *   delete and an Undo of an import change nothing. GridEditLogTest proves the
 *   same for a save, an import, a delete and an action.
 *   After the change. The log write fails once the change is made
 *   (GridEditLog.failWriteForTest stands in for a full log or a validation rule
 *   on it). A save chunk, new rows, a delete, an import and an action must
 *   then end in the log's failure, never report success, so that the platform
 *   undoes what they did, and the records are as they were.
 *
 * A change made before its log write failed is undone because the call ends
 * in an exception: the platform rolls back a call to the server that throws,
 * and keeps one that returns. A test that called the change and caught the
 * exception would keep the change whatever Rowhouse did, so the call boundary
 * is reproduced (asOneCall): a savepoint, rolled back only when the call
 * throws. A change that returned as if all were well would stay made, and the
 * test would fail. A save chunk is a Queueable already, a transaction of its
 * own: it runs at Test.stopTest(), and its finalizer reports the outcome.
 */
@IsTest
private class GridEditLogFailClosedTest {
    private static final String NO_LOG = 'you do not have permission to write to it, so nothing was changed';
    private static final String LOG_FAILED = 'The change was not made because its log entry could not be written';
    private static final String NEVER = 'Housatonic Hardware, 5 crates';

    @TestSetup
    static void setup() {
        GridTestUsers.noLogUser();
        System.runAs(GridTestUsers.fullUser()) {
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Casco Bay Marine, 4 crates', Consignee__c = 'Quabbin Supply', Pieces__c = 1),
                new Consignment__c(Name = 'Casco Bay Marine, 6 crates', Consignee__c = 'Quabbin Supply', Pieces__c = 2)
            };
        }
    }

    // ---------------------------------------------------------------- helpers

    private static User full() {
        return GridTestUsers.built(GridTestUsers.FULL);
    }

    private static User noLog() {
        return GridTestUsers.built(GridTestUsers.NO_LOG);
    }

    /** The two records the setup made, by Id, read by a user who sees them. */
    private static List<Id> loggedIds() {
        List<Id> out = new List<Id>();
        System.runAs(full()) {
            for (Consignment__c r : [
                SELECT Id
                FROM Consignment__c
                WHERE Name IN ('Casco Bay Marine, 4 crates', 'Casco Bay Marine, 6 crates')
                ORDER BY Name
            ]) {
                out.add(r.Id);
            }
        }
        return out;
    }

    /** Consignee__c of each record still there (not in the Recycle Bin), by Id. */
    private static Map<Id, String> textsOf(List<Id> ids) {
        Map<Id, String> out = new Map<Id, String>();
        System.runAs(full()) {
            for (Consignment__c r : [SELECT Id, Consignee__c FROM Consignment__c WHERE Id IN :ids]) {
                out.put(r.Id, r.Consignee__c);
            }
        }
        return out;
    }

    /** Log entries about these records, read by the user who would have written them. */
    private static Integer entriesFor(List<Id> ids) {
        List<String> keys = new List<String>();
        for (Id i : ids) {
            keys.add(String.valueOf(i));
        }
        Integer n;
        System.runAs(full()) {
            n = [SELECT COUNT() FROM Grid_Edit_Log__c WHERE Record_Id__c IN :keys];
        }
        return n;
    }

    private static Integer neverCreated() {
        Integer n;
        System.runAs(full()) {
            n = [SELECT COUNT() FROM Consignment__c WHERE Name = :NEVER];
        }
        return n;
    }

    private static List<Map<String, Object>> newRow() {
        return new List<Map<String, Object>>{
            new Map<String, Object>{ 'key' => 'rh-new-1', 'Name' => NEVER, 'Consignee__c' => 'Housatonic Hardware' }
        };
    }

    private static List<Map<String, Object>> rowsSetting(List<Id> ids, String text) {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Id i : ids) {
            rows.add(new Map<String, Object>{ 'Id' => i, 'Consignee__c' => text });
        }
        return rows;
    }

    /** What the change was refused with, or null when it was not refused. */
    private static String refusal(System.Callable change) {
        try {
            change.call(null, null);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    /**
     * The change as one call to the server whose log write fails: rolled back
     * when it throws, as the platform rolls back a call that ends in an
     * exception, and kept when it returns. What it was refused with, or null.
     */
    private static String asOneCall(System.Callable change) {
        String refused = null;
        GridEditLog.failWriteForTest = true;
        Savepoint beforeTheCall = Database.setSavepoint();
        try {
            change.call(null, null);
        } catch (GridException e) {
            Database.rollback(beforeTheCall);
            refused = e.getMessage();
        } finally {
            GridEditLog.failWriteForTest = false;
        }
        return refused;
    }

    /** One change the grid could ask for in Consignment_Audit, so each can be tried in turn. */
    private class Change implements System.Callable {
        private final String kind;
        private final List<Id> ids;
        Change(String kind, List<Id> ids) {
            this.kind = kind;
            this.ids = ids;
        }
        public Object call(String action, Map<String, Object> args) {
            switch on kind {
                when 'create' {
                    return GridCreateService.create('Consignment_Audit', newRow(), null, null, null);
                }
                when 'delete' {
                    return GridDeleteService.deleteRows('Consignment_Audit', ids);
                }
                when 'restore' {
                    return GridDeleteService.restoreRows('Consignment_Audit', ids);
                }
                when 'import' {
                    return GridImportService.importRows('Consignment_Audit', rowsSetting(ids, 'Berkshire Mills'));
                }
                when 'undoImport' {
                    return GridImportService.undoCreates('Consignment_Audit', ids);
                }
                when else {
                    return GridActionService.run('Consignment_Audit', 'Consignment_Audit_Mark_Seen', ids);
                }
            }
        }
    }

    // ------------------------------------------------- a user who cannot write the log

    @IsTest
    static void newRowsAreNotCreatedByAUserWhoCannotWriteTheLog() {
        System.runAs(noLog()) {
            Integer dml = Limits.getDmlStatements();
            String message = refusal(new Change('create', null));
            System.assert(message != null && message.contains(NO_LOG), 'New rows: ' + message);
            System.assertEquals(dml, Limits.getDmlStatements(), 'Refused before anything was written.');
        }
        System.assertEquals(0, neverCreated(), 'No record was created.');
    }

    @IsTest
    static void anUndoOfADeleteIsRefusedToAUserWhoCannotWriteTheLog() {
        List<Id> ids = new List<Id>();
        System.runAs(noLog()) {
            List<Consignment__c> recs = new List<Consignment__c>{
                new Consignment__c(Name = 'Green Mountain Maple, 20 cases', Consignee__c = 'Green Mountain Maple'),
                new Consignment__c(Name = 'Green Mountain Maple, 30 cases', Consignee__c = 'Green Mountain Maple')
            };
            insert recs;
            ids.addAll(new Map<Id, Consignment__c>(recs).keySet());
            // Deleted through a grid that does not log, so the user could put them back.
            System.assertEquals(2, GridDeleteService.deleteRows('Consignments', ids).deletedIds.size());
            Integer dml = Limits.getDmlStatements();
            String message = refusal(new Change('restore', ids));
            System.assert(message != null && message.contains(NO_LOG), 'Undo of a delete: ' + message);
            System.assertEquals(dml, Limits.getDmlStatements(), 'Refused before anything was restored.');
            System.assertEquals(0, [SELECT COUNT() FROM Consignment__c WHERE Id IN :ids], 'Still deleted.');
            System.assertEquals(
                2,
                GridDeleteService.restoreRows('Consignments', ids).restoredIds.size(),
                'In a grid that does not log, the same user puts them back: the log is what refused it.'
            );
        }
    }

    @IsTest
    static void anUndoOfAnImportIsRefusedToAUserWhoCannotWriteTheLog() {
        List<Id> ids = new List<Id>();
        System.runAs(noLog()) {
            List<Consignment__c> recs = new List<Consignment__c>{
                new Consignment__c(Name = 'Cape Ann Seafood, 10 totes', Consignee__c = 'Cape Ann Seafood'),
                new Consignment__c(Name = 'Cape Ann Seafood, 12 totes', Consignee__c = 'Cape Ann Seafood')
            };
            insert recs; // created by this user just now, as an import's new records are
            ids.addAll(new Map<Id, Consignment__c>(recs).keySet());
            Integer dml = Limits.getDmlStatements();
            String message = refusal(new Change('undoImport', ids));
            System.assert(message != null && message.contains(NO_LOG), 'Undo of an import: ' + message);
            System.assertEquals(dml, Limits.getDmlStatements(), 'Refused before anything was deleted.');
            System.assertEquals(2, [SELECT COUNT() FROM Consignment__c WHERE Id IN :ids], 'Still there.');
            System.assertEquals(
                2,
                GridImportService.undoCreates('Consignments', ids).deletedIds.size(),
                'In a grid that does not log, the same user undoes them: the log is what refused it.'
            );
        }
    }

    // ------------------------------------------------- a log write that fails after the change

    @IsTest
    static void aSaveChunkWhoseLogCannotBeWrittenLeavesTheRecordsAsTheyWere() {
        List<Id> ids = loggedIds();
        GridSaveResult ticket;
        System.runAs(full()) {
            Test.startTest();
            GridEditLog.failWriteForTest = true; // read by the chunk, which runs at stopTest()
            ticket = GridSaveService.save('Consignment_Audit', rowsSetting(ids, 'Wachusett Paper'));
            System.assertEquals(1, ticket.chunkCount, 'One chunk, which writes and then logs.');
            try {
                Test.stopTest();
            } catch (Exception e) {
                // The chunk's own exception, which ends its transaction; its
                // finalizer reports the records as not saved.
            }
            GridEditLog.failWriteForTest = false;
        }
        System.assertEquals(
            new Map<Id, String>{ ids[0] => 'Quabbin Supply', ids[1] => 'Quabbin Supply' },
            textsOf(ids),
            'The chunk\'s update must be undone with its failed log write.'
        );
        System.assertEquals(0, entriesFor(ids), 'No entry was written.');
        GridSaveResult status;
        System.runAs(full()) {
            status = GridSaveService.status(ticket.saveId);
        }
        System.assertEquals(0, status.successCount, 'The save never reports these records as saved: ' + status);
    }

    @IsTest
    static void newRowsWhoseLogCannotBeWrittenAreNotCreated() {
        String refused;
        System.runAs(full()) {
            refused = asOneCall(new Change('create', null));
        }
        System.assert(refused != null && refused.startsWith(LOG_FAILED), 'Ended by the log write: ' + refused);
        System.assertEquals(0, neverCreated(), 'The insert is undone with the call.');
    }

    @IsTest
    static void aDeleteWhoseLogCannotBeWrittenLeavesTheRecords() {
        List<Id> ids = loggedIds();
        String refused;
        System.runAs(full()) {
            refused = asOneCall(new Change('delete', ids));
        }
        System.assert(refused != null && refused.startsWith(LOG_FAILED), 'Ended by the log write: ' + refused);
        System.assertEquals(2, textsOf(ids).size(), 'The delete is undone with the call.');
        System.assertEquals(0, entriesFor(ids), 'No entry was written.');
    }

    @IsTest
    static void anImportWhoseLogCannotBeWrittenLeavesTheRecordsAsTheyWere() {
        List<Id> ids = loggedIds();
        String refused;
        System.runAs(full()) {
            refused = asOneCall(new Change('import', ids));
        }
        System.assert(refused != null && refused.startsWith(LOG_FAILED), 'Ended by the log write: ' + refused);
        System.assertEquals(
            new Map<Id, String>{ ids[0] => 'Quabbin Supply', ids[1] => 'Quabbin Supply' },
            textsOf(ids),
            'The import\'s update is undone with the call.'
        );
        System.assertEquals(0, entriesFor(ids), 'No entry was written.');
    }

    @IsTest
    static void anActionWhoseLogCannotBeWrittenLeavesTheRecordsAsTheyWere() {
        List<Id> ids = loggedIds();
        String refused;
        System.runAs(full()) {
            refused = asOneCall(new Change('action', ids));
        }
        System.assert(refused != null && refused.startsWith(LOG_FAILED), 'Ended by the log write: ' + refused);
        System.assertEquals(
            new Map<Id, String>{ ids[0] => 'Quabbin Supply', ids[1] => 'Quabbin Supply' },
            textsOf(ids),
            'What the flow wrote ("Reviewed by dispatch") is undone with the call.'
        );
        System.assertEquals(0, entriesFor(ids), 'No entry was written.');
    }
}
