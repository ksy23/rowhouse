/**
 * DEVELOPMENT ONLY. Never packaged.
 * The audit trail: one Grid Edit Log entry per field a grid changes,
 * and one per record it creates, deletes or runs an action on, when its
 * configuration sets Log Changes (Audit_Test, in test-data/config). Written as
 * the user, in the change's own transaction, all or nothing; a user who cannot
 * write the log changes nothing.
 *
 * Entries are read as the user who wrote them: Rowhouse Grid User lets a user
 * read their own, and the admin running the suite may have no field access to
 * the log at all in a fresh build org.
 */
@IsTest
private class GridAuditTest {
    private static List<Rowhouse_Test_Record__c> newRecords(List<String> names) {
        List<Rowhouse_Test_Record__c> out = new List<Rowhouse_Test_Record__c>();
        for (String name : names) {
            out.add(
                new Rowhouse_Test_Record__c(
                    Name = name,
                    Text_Field__c = 'old',
                    Number_Field__c = 1,
                    Checkbox_Field__c = false
                )
            );
        }
        insert out;
        return out;
    }

    private static List<Grid_Edit_Log__c> entriesFor(Set<Id> recordIds) {
        List<String> ids = new List<String>();
        for (Id i : recordIds) {
            ids.add(String.valueOf(i));
        }
        return [
            SELECT
                Id,
                Grid_Configuration__c,
                Object__c,
                Record_Id__c,
                Record_Name__c,
                Operation__c,
                Field__c,
                Field_Label__c,
                Old_Value__c,
                New_Value__c,
                Values_Hidden__c,
                Action__c,
                Action_Label__c,
                Save_Id__c,
                CreatedById
            FROM Grid_Edit_Log__c
            WHERE Record_Id__c IN :ids
            ORDER BY Record_Name__c, Operation__c, Field__c
        ];
    }

    private static Set<Id> idsOf(List<SObject> records) {
        return new Map<Id, SObject>(records).keySet();
    }

    private static String refusal(System.Callable attempt) {
        try {
            attempt.call(null, null);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    // ------------------------------------------------------------ saves

    @IsTest
    static void aSaveLogsEachFieldThatChangedWithItsOldAndNewValue() {
        User user = GridTestUsers.fullUser();
        System.runAs(user) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Audit A', 'Audit B' });
            recs[1].Text_Field__c = 'smith';
            update recs[1];
            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                // Name and Number sent unchanged, Text and Active changed.
                new Map<String, Object>{
                    'Id' => recs[0].Id,
                    'Name' => 'Audit A',
                    'Text_Field__c' => 'new',
                    'Number_Field__c' => '1',
                    'Checkbox_Field__c' => true
                },
                // Only the case of the text changes: still a change.
                new Map<String, Object>{ 'Id' => recs[1].Id, 'Text_Field__c' => 'Smith' }
            };
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save('Audit_Test', rows);
            Test.stopTest();
            System.assert(GridSaveService.status(ticket.saveId).done, 'The save reported.');

            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(
                3,
                entries.size(),
                'Two fields on A, one on B; unchanged fields are not logged: ' + entries
            );
            Grid_Edit_Log__c active = entries[0];
            System.assertEquals('Checkbox_Field__c', active.Field__c);
            System.assertEquals(
                Rowhouse_Test_Record__c.Checkbox_Field__c.getDescribe().getLabel(),
                active.Field_Label__c
            );
            System.assertEquals('false', active.Old_Value__c);
            System.assertEquals('true', active.New_Value__c);
            Grid_Edit_Log__c text = entries[1];
            System.assertEquals('Text_Field__c', text.Field__c);
            System.assertEquals('old', text.Old_Value__c);
            System.assertEquals('new', text.New_Value__c);
            for (Grid_Edit_Log__c e : entries) {
                System.assertEquals('Update', e.Operation__c);
                System.assertEquals('Audit_Test', e.Grid_Configuration__c);
                System.assertEquals('Rowhouse_Test_Record__c', e.Object__c);
                System.assertEquals(ticket.saveId, e.Save_Id__c, 'A save\'s entries carry the save\'s own Id.');
                System.assertEquals(user.Id, e.CreatedById, 'Who: the platform\'s Created By, the user who saved.');
                System.assertEquals(false, e.Values_Hidden__c);
            }
            System.assertEquals('Audit A', active.Record_Name__c);
            System.assertEquals(String.valueOf(recs[0].Id), active.Record_Id__c);
            Grid_Edit_Log__c caseOnly = entries[2];
            System.assertEquals('Audit B', caseOnly.Record_Name__c);
            System.assertEquals('smith', caseOnly.Old_Value__c, 'Compared exactly: Apex\'s == ignores case.');
            System.assertEquals('Smith', caseOnly.New_Value__c);
        }
    }

    @IsTest
    static void aRecordThatFailsToSaveIsNotLogged() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Saved', 'Gone' });
            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => recs[0].Id, 'Text_Field__c' => 'changed' },
                new Map<String, Object>{ 'Id' => recs[1].Id, 'Text_Field__c' => 'changed' }
            };
            Id goneId = recs[1].Id;
            delete recs[1]; // its update fails when the chunk runs
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save('Audit_Test', rows);
            Test.stopTest();
            GridSaveResult done = GridSaveService.status(ticket.saveId);
            System.assertEquals(1, done.successCount, String.valueOf(done.errors));
            List<Grid_Edit_Log__c> entries = entriesFor(new Set<Id>{ recs[0].Id, goneId });
            System.assertEquals(1, entries.size(), 'Only what happened is logged: ' + entries);
            System.assertEquals(String.valueOf(recs[0].Id), entries[0].Record_Id__c);
        }
    }

    @IsTest
    static void aGridThatDoesNotLogWritesNoEntries() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Quiet' });
            Test.startTest();
            GridSaveService.save(
                'Save_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => recs[0].Id, 'Number_Field__c' => '42' }
                }
            );
            Test.stopTest();
            System.assertEquals(
                42,
                [SELECT Number_Field__c FROM Rowhouse_Test_Record__c WHERE Id = :recs[0].Id].Number_Field__c
            );
            System.assert(entriesFor(idsOf(recs)).isEmpty(), 'Save_Test does not set Log Changes.');
        }
    }

    // ------------------------------------------------------------ imports, deletes, actions

    @IsTest
    static void anImportLogsTheFieldsItUpdatesAndEachRecordItCreates() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Imported over' });
            GridImportService.Result result = GridImportService.importRows(
                'Audit_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => recs[0].Id, 'Text_Field__c' => 'from the file' },
                    new Map<String, Object>{ 'Name' => 'Imported new', 'Text_Field__c' => 'x' }
                }
            );
            System.assert(result.rows[0].success && result.rows[1].success, String.valueOf(result.rows));
            Id createdId = result.rows[1].recordId;
            List<Grid_Edit_Log__c> entries = entriesFor(new Set<Id>{ recs[0].Id, createdId });
            System.assertEquals(2, entries.size(), String.valueOf(entries));
            Grid_Edit_Log__c created = entries[0];
            System.assertEquals('Create', created.Operation__c);
            System.assertEquals('Imported new', created.Record_Name__c);
            System.assertEquals(String.valueOf(createdId), created.Record_Id__c);
            System.assertEquals(null, created.Field__c, 'A new record is one entry, not one per field.');
            Grid_Edit_Log__c updated = entries[1];
            System.assertEquals('Update', updated.Operation__c);
            System.assertEquals('Text_Field__c', updated.Field__c);
            System.assertEquals('old', updated.Old_Value__c);
            System.assertEquals('from the file', updated.New_Value__c);
            System.assertEquals(created.Save_Id__c, updated.Save_Id__c, 'One batch, one Save Id.');
        }
    }

    @IsTest
    static void aCreateEntryReadsTheNameBackWhenTheWrittenRecordHasNone() {
        // A Contact's Name is built from First and Last Name, and an auto-number
        // name is given on insert: the record the grid wrote carries no Name.
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Named on insert' });
            List<Database.SaveResult> results = Database.update(
                new List<Rowhouse_Test_Record__c>{ new Rowhouse_Test_Record__c(Id = recs[0].Id) }
            );
            GridAudit.Context ctx = new GridAudit.Context();
            ctx.configName = 'Audit_Test';
            ctx.objectName = 'Rowhouse_Test_Record__c';
            ctx.saveId = 'test-save';
            List<Grid_Edit_Log__c> entries = GridAudit.creates(
                ctx,
                Rowhouse_Test_Record__c.SObjectType,
                new List<SObject>{ new Rowhouse_Test_Record__c(Text_Field__c = 'x') },
                results
            );
            System.assertEquals(1, entries.size(), String.valueOf(entries));
            System.assertEquals('Create', entries[0].Operation__c);
            System.assertEquals('Named on insert', entries[0].Record_Name__c, 'The name is read back from the record.');
        }
    }

    @IsTest
    static void aDeleteLogsEachRecordByTheNameItHad() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Deleted 1', 'Deleted 2' });
            GridDeleteService.Result result = GridDeleteService.deleteRows('Audit_Test', new List<Id>(idsOf(recs)));
            System.assertEquals(2, result.deletedIds.size(), String.valueOf(result.errors));
            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(2, entries.size(), String.valueOf(entries));
            System.assertEquals(
                'Deleted 1',
                entries[0].Record_Name__c,
                'The entry keeps the name of a record now in the Recycle Bin.'
            );
            System.assertEquals('Deleted 2', entries[1].Record_Name__c);
            for (Grid_Edit_Log__c e : entries) {
                System.assertEquals('Delete', e.Operation__c);
                System.assertEquals(null, e.Old_Value__c);
            }
        }
    }

    @IsTest
    static void undoingADeleteLogsEachRecordPutBack() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Back 1', 'Back 2' });
            GridDeleteService.deleteRows('Audit_Test', new List<Id>(idsOf(recs)));
            GridDeleteService.RestoreResult result = GridDeleteService.restoreRows(
                'Audit_Test',
                new List<Id>(idsOf(recs))
            );
            System.assertEquals(2, result.restoredIds.size(), String.valueOf(result.errors));
            List<Grid_Edit_Log__c> restores = new List<Grid_Edit_Log__c>();
            for (Grid_Edit_Log__c e : entriesFor(idsOf(recs))) {
                if (e.Operation__c == 'Restore') {
                    restores.add(e);
                }
            }
            System.assertEquals(2, restores.size(), 'One Restore entry per record put back, after its Delete entry.');
            System.assertEquals('Back 1', restores[0].Record_Name__c);
            System.assertEquals(restores[0].Save_Id__c, restores[1].Save_Id__c, 'One undo shares one Save Id.');
        }
    }

    @IsTest
    static void anActionLogsEachRecordItRanOnAndNotOneItFailedOn() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Acted on', 'Fail me' });
            GridActionService.Result result = GridActionService.run(
                'Audit_Test',
                'Audit_Test_Mark_Seen',
                new List<Id>(idsOf(recs))
            );
            System.assertEquals(new List<Id>{ recs[0].Id }, result.succeededIds, String.valueOf(result.errors));
            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(1, entries.size(), 'A record the action failed on is not logged: ' + entries);
            System.assertEquals('Action', entries[0].Operation__c);
            System.assertEquals('Audit_Test_Mark_Seen', entries[0].Action__c);
            System.assertEquals('Mark as seen', entries[0].Action_Label__c);
            System.assertEquals('Acted on', entries[0].Record_Name__c);
            System.assertEquals(null, entries[0].Field__c, 'The grid cannot see what the action changed.');
        }
    }

    // ------------------------------------------------------------ all or nothing, and who can do what

    @IsTest
    static void aUserWhoCannotWriteTheLogChangesNothing() {
        List<Rowhouse_Test_Record__c> recs;
        System.runAs(GridTestUsers.fullUser()) {
            recs = newRecords(new List<String>{ 'Untouched' });
        }
        Id recordId = recs[0].Id;
        User noLog = GridTestUsers.noLogUser();
        System.runAs(noLog) {
            String expected = 'you do not have permission to write to it, so nothing was changed';
            Test.startTest();
            Integer jobsBefore = Limits.getQueueableJobs();
            String saved = refusal(new Attempt('save', recordId));
            System.assertEquals(jobsBefore, Limits.getQueueableJobs(), 'Nothing was queued.');
            Test.stopTest();
            System.assert(saved != null && saved.contains(expected), 'A save: ' + saved);
            String imported = refusal(new Attempt('import', recordId));
            System.assert(imported != null && imported.contains(expected), 'An import: ' + imported);
            String deleted = refusal(new Attempt('delete', recordId));
            System.assert(deleted != null && deleted.contains(expected), 'A delete: ' + deleted);
            String acted = refusal(new Attempt('action', recordId));
            System.assert(acted != null && acted.contains(expected), 'An action: ' + acted);
        }
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c after = [
                SELECT Id, Text_Field__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :recordId
            ];
            System.assertEquals('old', after.Text_Field__c, 'Not saved, imported over, deleted or acted on.');
        }
    }

    /** One refused change, so each can be tried in turn. */
    private class Attempt implements System.Callable {
        private final String kind;
        private final Id recordId;
        Attempt(String kind, Id recordId) {
            this.kind = kind;
            this.recordId = recordId;
        }
        public Object call(String action, Map<String, Object> args) {
            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => recordId, 'Text_Field__c' => 'changed' }
            };
            switch on kind {
                when 'save' {
                    return GridSaveService.save('Audit_Test', rows);
                }
                when 'import' {
                    return GridImportService.importRows('Audit_Test', rows);
                }
                when 'delete' {
                    return GridDeleteService.deleteRows('Audit_Test', new List<Id>{ recordId });
                }
                when else {
                    return GridActionService.run('Audit_Test', 'Audit_Test_Mark_Seen', new List<Id>{ recordId });
                }
            }
        }
    }

    @IsTest
    static void anEntryCannotBeChangedOrDeletedByTheUserWhoWroteIt() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Kept' });
            GridDeleteService.deleteRows('Audit_Test', new List<Id>(idsOf(recs)));
            Grid_Edit_Log__c entry = entriesFor(idsOf(recs))[0];
            entry.Record_Name__c = 'Something else';
            List<Database.SaveResult> edit = GridSecurity.updateRecords(new List<SObject>{ entry });
            System.assert(!edit[0].isSuccess(), 'Rowhouse Grid User grants no edit on the log.');
            try {
                GridSecurity.deleteRecords(Grid_Edit_Log__c.SObjectType, new List<Id>{ entry.Id });
                System.assert(false, 'Rowhouse Grid User grants no delete on the log.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('permission to delete'), e.getMessage());
            }
            System.assertEquals('Kept', entriesFor(idsOf(recs))[0].Record_Name__c);
        }
    }

    // ------------------------------------------------------------ values and chunks

    @IsTest
    static void valuesAreWrittenAsText() {
        System.assertEquals(null, GridAudit.text(null));
        Object day = Date.newInstance(2026, 9, 30); // held as an Object, a Date is also an instanceof Datetime
        System.assertEquals('2026-09-30', GridAudit.text(day));
        System.assertEquals('2026-01-05', GridAudit.text(Date.newInstance(2026, 1, 5)));
        System.assertEquals(
            '2026-09-30T23:30:00.000Z',
            GridAudit.text(Datetime.newInstanceGmt(2026, 9, 30, 23, 30, 0))
        );
        System.assertEquals('1234.50', GridAudit.text(1234.50));
        System.assertEquals('100000000000000000000', GridAudit.text(Double.valueOf('1.0E20')), 'In full, not 1.0E20.');
        System.assertEquals('5', GridAudit.text(5));
        System.assertEquals('true', GridAudit.text(true));
        Id someId = UserInfo.getUserId();
        System.assertEquals(String.valueOf(someId), GridAudit.text(someId));
        System.assertEquals('Red;Blue', GridAudit.text('Red;Blue'));
    }

    @IsTest
    static void onlyARealChangeIsAChange() {
        System.assert(!GridAudit.same('abc', 'ABC'), 'Case is a change.');
        System.assert(GridAudit.same('abc', 'abc'));
        System.assert(GridAudit.same('', null), 'An empty string is blank.');
        System.assert(GridAudit.same(null, null));
        System.assert(!GridAudit.same(null, 'x'));
        System.assert(GridAudit.same(1.0, 1.00), 'The same number at another scale.');
        System.assert(!GridAudit.same(false, true));
        System.assert(GridAudit.same(Date.newInstance(2026, 9, 30), Date.newInstance(2026, 9, 30)));
    }

    @IsTest
    static void aSaveIsChunkedSoEachChunksLogFitsItsTransaction() {
        List<SObject> records = new List<SObject>();
        for (Integer i = 0; i < 7; i++) {
            records.add(new Rowhouse_Test_Record__c(Name = 'r' + i, Text_Field__c = 't', Number_Field__c = i));
        }
        List<Integer> sizes = new List<Integer>();
        for (List<SObject> chunk : GridSaveService.chunksOf(records, 10)) {
            sizes.add(chunk.size());
        }
        System.assertEquals(
            new List<Integer>{ 3, 3, 1 },
            sizes,
            'Three fields each: three records are 9 cells, four would be 12.'
        );
        System.assertEquals(
            1,
            GridSaveService.chunksOf(records, null).size(),
            'Without logging, only the 200-record chunk size applies.'
        );

        List<SObject> many = new List<SObject>();
        for (Integer i = 0; i < 450; i++) {
            many.add(new Rowhouse_Test_Record__c(Name = 'm' + i));
        }
        sizes.clear();
        for (List<SObject> chunk : GridSaveService.chunksOf(many, GridAudit.MAX_ENTRIES)) {
            sizes.add(chunk.size());
        }
        System.assertEquals(new List<Integer>{ 200, 200, 50 }, sizes, 'A narrow save chunks as it always has.');

        List<SObject> wide = new List<SObject>{
            records[0],
            new Rowhouse_Test_Record__c(
                Name = 'w',
                Text_Field__c = 'a',
                Number_Field__c = 1,
                Checkbox_Field__c = true,
                Percent_Field__c = 2
            ),
            records[1]
        };
        sizes.clear();
        for (List<SObject> chunk : GridSaveService.chunksOf(wide, 4)) {
            sizes.add(chunk.size());
        }
        System.assertEquals(
            new List<Integer>{ 1, 1, 1 },
            sizes,
            'A record wider than the budget is never split: it goes alone.'
        );
    }
}
