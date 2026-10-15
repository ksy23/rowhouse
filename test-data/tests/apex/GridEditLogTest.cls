/**
 * DEVELOPMENT ONLY. Never packaged.
 * The audit trail: one Grid Edit Log entry per field a grid changes,
 * and one per record it creates, deletes or runs an action on, when its
 * configuration sets Log Changes (Consignment_Audit, in test-data/config). Written as
 * the user, in the change's own transaction, all or nothing; a user who cannot
 * write the log changes nothing.
 *
 * Entries are read as the user who wrote them: Rowhouse Grid User lets a user
 * read their own, and the admin running the suite may have no field access to
 * the log at all in a fresh build org.
 */
@IsTest
private class GridEditLogTest {
    private static List<Consignment__c> newRecords(List<String> names) {
        List<Consignment__c> out = new List<Consignment__c>();
        for (String name : names) {
            out.add(
                new Consignment__c(Name = name, Consignee__c = 'Wachusett Paper', Pieces__c = 1, Delivered__c = false)
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
                Values_Not_Recorded__c,
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
            List<Consignment__c> recs = newRecords(new List<String>{ 'Boat parts, Rockland', 'Paper rolls, Augusta' });
            recs[1].Consignee__c = 'quabbin supply';
            update recs[1];
            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                // Name and Pieces sent unchanged, Consignee and Delivered changed.
                new Map<String, Object>{
                    'Id' => recs[0].Id,
                    'Name' => 'Boat parts, Rockland',
                    'Consignee__c' => 'Penobscot Paper',
                    'Pieces__c' => '1',
                    'Delivered__c' => true
                },
                // Only the case of the text changes: still a change.
                new Map<String, Object>{ 'Id' => recs[1].Id, 'Consignee__c' => 'Quabbin Supply' }
            };
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save('Consignment_Audit', rows);
            Test.stopTest();
            System.assert(GridSaveService.status(ticket.saveId).done, 'The save reported.');

            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(
                3,
                entries.size(),
                'Two fields on A, one on B; unchanged fields are not logged: ' + entries
            );
            // In Field order: Consignee__c before Delivered__c.
            Grid_Edit_Log__c active = entries[1];
            System.assertEquals('Delivered__c', active.Field__c);
            System.assertEquals(Consignment__c.Delivered__c.getDescribe().getLabel(), active.Field_Label__c);
            System.assertEquals('false', active.Old_Value__c);
            System.assertEquals('true', active.New_Value__c);
            Grid_Edit_Log__c text = entries[0];
            System.assertEquals('Consignee__c', text.Field__c);
            System.assertEquals('Wachusett Paper', text.Old_Value__c);
            System.assertEquals('Penobscot Paper', text.New_Value__c);
            for (Grid_Edit_Log__c e : entries) {
                System.assertEquals('update', e.Operation__c);
                System.assertEquals('Consignment_Audit', e.Grid_Configuration__c);
                System.assertEquals('Consignment__c', e.Object__c);
                System.assertEquals(ticket.saveId, e.Save_Id__c, 'A save\'s entries carry the save\'s own Id.');
                System.assertEquals(user.Id, e.CreatedById, 'Who: the platform\'s Created By, the user who saved.');
                System.assertEquals(false, e.Values_Not_Recorded__c);
            }
            System.assertEquals('Boat parts, Rockland', active.Record_Name__c);
            System.assertEquals(String.valueOf(recs[0].Id), active.Record_Id__c);
            Grid_Edit_Log__c caseOnly = entries[2];
            System.assertEquals('Paper rolls, Augusta', caseOnly.Record_Name__c);
            System.assertEquals('quabbin supply', caseOnly.Old_Value__c, 'Compared exactly: Apex\'s == ignores case.');
            System.assertEquals('Quabbin Supply', caseOnly.New_Value__c);
        }
    }

    @IsTest
    static void anEncryptedFieldsChangeIsLoggedWithoutItsValues() {
        // Shield Platform Encryption cannot be turned on in the test orgs; a
        // Classic encrypted text field is read the same way (GridDescribe.isEncrypted).
        GridDescribe.encryptedForTest.add('consignee__c');
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Bonded cargo, Calais' });
            Test.startTest();
            GridSaveService.save(
                'Consignment_Audit',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => recs[0].Id, 'Consignee__c' => 'Narragansett Shellfish' }
                }
            );
            Test.stopTest();
            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(1, entries.size(), String.valueOf(entries));
            System.assertEquals('Consignee__c', entries[0].Field__c, 'The change itself is logged.');
            System.assertEquals(true, entries[0].Values_Not_Recorded__c);
            System.assertEquals(null, entries[0].Old_Value__c, 'The old value is not copied into the log.');
            System.assertEquals(null, entries[0].New_Value__c, 'Nor the new one.');
        }
    }

    @IsTest
    static void aRecordThatFailsToSaveIsNotLogged() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(
                new List<String>{ 'Granite curbing, Concord', 'Granite curbing, Nashua' }
            );
            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => recs[0].Id, 'Consignee__c' => 'Monadnock Granite' },
                new Map<String, Object>{ 'Id' => recs[1].Id, 'Consignee__c' => 'Monadnock Granite' }
            };
            Id goneId = recs[1].Id;
            delete recs[1]; // its update fails when the chunk runs
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save('Consignment_Audit', rows);
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
            List<Consignment__c> recs = newRecords(new List<String>{ 'Cranberries, Worcester' });
            Test.startTest();
            GridSaveService.save(
                'Consignment_Rates',
                new List<Map<String, Object>>{ new Map<String, Object>{ 'Id' => recs[0].Id, 'Pieces__c' => '42' } }
            );
            Test.stopTest();
            System.assertEquals(42, [SELECT Pieces__c FROM Consignment__c WHERE Id = :recs[0].Id].Pieces__c);
            System.assert(entriesFor(idsOf(recs)).isEmpty(), 'Consignment_Rates does not set Log Changes.');
        }
    }

    // ------------------------------------------------------------ imports, deletes, actions

    @IsTest
    static void anImportLogsTheFieldsItUpdatesAndEachRecordItCreates() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Kennebec Lumber, 12 bundles' });
            GridImportService.Result result = GridImportService.importRows(
                'Consignment_Audit',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => recs[0].Id, 'Consignee__c' => 'Merrimack Valley Foods' },
                    new Map<String, Object>{
                        'Name' => 'Granite curbing, Concord',
                        'Consignee__c' => 'Monadnock Granite'
                    }
                }
            );
            System.assert(result.rows[0].success && result.rows[1].success, String.valueOf(result.rows));
            Id createdId = result.rows[1].recordId;
            List<Grid_Edit_Log__c> entries = entriesFor(new Set<Id>{ recs[0].Id, createdId });
            System.assertEquals(2, entries.size(), String.valueOf(entries));
            Grid_Edit_Log__c created = entries[0];
            System.assertEquals('create', created.Operation__c);
            System.assertEquals('Granite curbing, Concord', created.Record_Name__c);
            System.assertEquals(String.valueOf(createdId), created.Record_Id__c);
            System.assertEquals(null, created.Field__c, 'A new record is one entry, not one per field.');
            Grid_Edit_Log__c updated = entries[1];
            System.assertEquals('update', updated.Operation__c);
            System.assertEquals('Consignee__c', updated.Field__c);
            System.assertEquals('Wachusett Paper', updated.Old_Value__c);
            System.assertEquals('Merrimack Valley Foods', updated.New_Value__c);
            System.assertEquals(created.Save_Id__c, updated.Save_Id__c, 'One batch, one Save Id.');
        }
    }

    @IsTest
    static void aCreateEntryReadsTheNameBackWhenTheWrittenRecordHasNone() {
        // A Contact's Name is built from First and Last Name, and an auto-number
        // name is given on insert: the record the grid wrote carries no Name.
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Canoe paddles, Bangor' });
            List<Database.SaveResult> results = Database.update(
                new List<Consignment__c>{ new Consignment__c(Id = recs[0].Id) }
            );
            GridEditLog.Context ctx = new GridEditLog.Context();
            ctx.configName = 'Consignment_Audit';
            ctx.objectName = 'Consignment__c';
            ctx.saveId = '3f9c2a7e5b1d4c8a9e6f0b2d7a4c1e58';
            List<Grid_Edit_Log__c> entries = GridEditLog.creates(
                ctx,
                Consignment__c.SObjectType,
                new List<SObject>{ new Consignment__c(Consignee__c = 'Saco River Outfitters') },
                results
            );
            System.assertEquals(1, entries.size(), String.valueOf(entries));
            System.assertEquals('create', entries[0].Operation__c);
            System.assertEquals(
                'Canoe paddles, Bangor',
                entries[0].Record_Name__c,
                'The name is read back from the record.'
            );
        }
    }

    @IsTest
    static void aDeleteLogsEachRecordByTheNameItHad() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Brick pallets, Bangor', 'Roof tile, Bangor' });
            GridDeleteService.Result result = GridDeleteService.deleteRows(
                'Consignment_Audit',
                new List<Id>(idsOf(recs))
            );
            System.assertEquals(2, result.deletedIds.size(), String.valueOf(result.errors));
            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(2, entries.size(), String.valueOf(entries));
            System.assertEquals(
                'Brick pallets, Bangor',
                entries[0].Record_Name__c,
                'The entry keeps the name of a record now in the Recycle Bin.'
            );
            System.assertEquals('Roof tile, Bangor', entries[1].Record_Name__c);
            for (Grid_Edit_Log__c e : entries) {
                System.assertEquals('delete', e.Operation__c);
                System.assertEquals(null, e.Old_Value__c);
            }
        }
    }

    @IsTest
    static void undoingADeleteLogsEachRecordPutBack() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(
                new List<String>{ 'Firewood, Ellsworth', 'Wool blankets, Ellsworth' }
            );
            GridDeleteService.deleteRows('Consignment_Audit', new List<Id>(idsOf(recs)));
            GridDeleteService.RestoreResult result = GridDeleteService.restoreRows(
                'Consignment_Audit',
                new List<Id>(idsOf(recs))
            );
            System.assertEquals(2, result.restoredIds.size(), String.valueOf(result.errors));
            List<Grid_Edit_Log__c> restores = new List<Grid_Edit_Log__c>();
            for (Grid_Edit_Log__c e : entriesFor(idsOf(recs))) {
                if (e.Operation__c == 'restore') {
                    restores.add(e);
                }
            }
            System.assertEquals(2, restores.size(), 'One Restore entry per record put back, after its Delete entry.');
            System.assertEquals('Firewood, Ellsworth', restores[0].Record_Name__c);
            System.assertEquals(restores[0].Save_Id__c, restores[1].Save_Id__c, 'One undo shares one Save Id.');
        }
    }

    @IsTest
    static void anActionLogsEachRecordItRanOnAndNotOneItFailedOn() {
        System.runAs(GridTestUsers.fullUser()) {
            // The flow fails on the consignment held at customs (Mark_Consignment_Reviewed).
            List<Consignment__c> recs = newRecords(
                new List<String>{ 'Lobster crates, Rockland', 'Held at customs, Calais' }
            );
            GridActionService.Result result = GridActionService.run(
                'Consignment_Audit',
                'Consignment_Audit_Mark_Seen',
                new List<Id>(idsOf(recs))
            );
            System.assertEquals(new List<Id>{ recs[0].Id }, result.succeededIds, String.valueOf(result.errors));
            List<Grid_Edit_Log__c> entries = entriesFor(idsOf(recs));
            System.assertEquals(1, entries.size(), 'A record the action failed on is not logged: ' + entries);
            System.assertEquals('action', entries[0].Operation__c);
            System.assertEquals('Consignment_Audit_Mark_Seen', entries[0].Action__c);
            System.assertEquals('Mark as seen', entries[0].Action_Label__c);
            System.assertEquals('Lobster crates, Rockland', entries[0].Record_Name__c);
            System.assertEquals(null, entries[0].Field__c, 'The grid cannot see what the action changed.');
        }
    }

    // ------------------------------------------------------------ all or nothing, and who can do what

    @IsTest
    static void aUserWhoCannotWriteTheLogChangesNothing() {
        List<Consignment__c> recs;
        System.runAs(GridTestUsers.fullUser()) {
            recs = newRecords(new List<String>{ 'Wool blankets, Bath' });
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
            Consignment__c after = [
                SELECT Id, Consignee__c
                FROM Consignment__c
                WHERE Id = :recordId
            ];
            System.assertEquals(
                'Wachusett Paper',
                after.Consignee__c,
                'Not saved, imported over, deleted or acted on.'
            );
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
                new Map<String, Object>{ 'Id' => recordId, 'Consignee__c' => 'Monadnock Granite' }
            };
            switch on kind {
                when 'save' {
                    return GridSaveService.save('Consignment_Audit', rows);
                }
                when 'import' {
                    return GridImportService.importRows('Consignment_Audit', rows);
                }
                when 'delete' {
                    return GridDeleteService.deleteRows('Consignment_Audit', new List<Id>{ recordId });
                }
                when else {
                    return GridActionService.run(
                        'Consignment_Audit',
                        'Consignment_Audit_Mark_Seen',
                        new List<Id>{ recordId }
                    );
                }
            }
        }
    }

    @IsTest
    static void anEntryCannotBeChangedOrDeletedByTheUserWhoWroteIt() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Pulp bales, Lewiston' });
            GridDeleteService.deleteRows('Consignment_Audit', new List<Id>(idsOf(recs)));
            Grid_Edit_Log__c entry = entriesFor(idsOf(recs))[0];
            entry.Record_Name__c = 'Pulp bales, Brunswick';
            List<Database.SaveResult> edit = GridSecurity.updateRecords(new List<SObject>{ entry });
            System.assert(!edit[0].isSuccess(), 'Rowhouse Grid User grants no edit on the log.');
            try {
                GridSecurity.deleteRecords(Grid_Edit_Log__c.SObjectType, new List<Id>{ entry.Id });
                System.assert(false, 'Rowhouse Grid User grants no delete on the log.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('permission to delete'), e.getMessage());
            }
            System.assertEquals('Pulp bales, Lewiston', entriesFor(idsOf(recs))[0].Record_Name__c);
        }
    }

    // ------------------------------------------------------------ values and chunks

    @IsTest
    static void valuesAreWrittenAsText() {
        System.assertEquals(null, GridEditLog.text(null));
        Object day = Date.newInstance(2026, 9, 30); // held as an Object, a Date is also an instanceof Datetime
        System.assertEquals('2026-09-30', GridEditLog.text(day));
        System.assertEquals('2026-01-05', GridEditLog.text(Date.newInstance(2026, 1, 5)));
        System.assertEquals(
            '2026-09-30T23:30:00.000Z',
            GridEditLog.text(Datetime.newInstanceGmt(2026, 9, 30, 23, 30, 0))
        );
        System.assertEquals('1234.50', GridEditLog.text(1234.50));
        System.assertEquals(
            '100000000000000000000',
            GridEditLog.text(Double.valueOf('1.0E20')),
            'In full, not 1.0E20.'
        );
        System.assertEquals('5', GridEditLog.text(5));
        System.assertEquals('true', GridEditLog.text(true));
        Id someId = UserInfo.getUserId();
        System.assertEquals(String.valueOf(someId), GridEditLog.text(someId));
        System.assertEquals('Fragile;Inside Delivery', GridEditLog.text('Fragile;Inside Delivery'));
    }

    @IsTest
    static void onlyARealChangeIsAChange() {
        System.assert(!GridEditLog.same('Quabbin Supply', 'QUABBIN SUPPLY'), 'Case is a change.');
        System.assert(GridEditLog.same('Quabbin Supply', 'Quabbin Supply'));
        System.assert(GridEditLog.same('', null), 'An empty string is blank.');
        System.assert(GridEditLog.same(null, null));
        System.assert(!GridEditLog.same(null, 'Quabbin Supply'));
        System.assert(GridEditLog.same(1.0, 1.00), 'The same number at another scale.');
        System.assert(!GridEditLog.same(false, true));
        System.assert(GridEditLog.same(Date.newInstance(2026, 9, 30), Date.newInstance(2026, 9, 30)));
    }

    @IsTest
    static void aSaveIsChunkedSoEachChunksLogFitsItsTransaction() {
        List<SObject> records = new List<SObject>();
        for (Integer i = 0; i < 7; i++) {
            records.add(
                new Consignment__c(Name = 'Penobscot Paper, load ' + i, Consignee__c = 'Penobscot Paper', Pieces__c = i)
            );
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
            many.add(new Consignment__c(Name = 'Kennebec Lumber, load ' + i));
        }
        sizes.clear();
        for (List<SObject> chunk : GridSaveService.chunksOf(many, GridEditLog.MAX_ENTRIES)) {
            sizes.add(chunk.size());
        }
        System.assertEquals(new List<Integer>{ 200, 200, 50 }, sizes, 'A narrow save chunks as it always has.');

        List<SObject> wide = new List<SObject>{
            records[0],
            new Consignment__c(
                Name = 'Casco Bay Marine, 1 crate',
                Consignee__c = 'Casco Bay Marine',
                Pieces__c = 1,
                Delivered__c = true,
                Fuel_Surcharge__c = 2
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
