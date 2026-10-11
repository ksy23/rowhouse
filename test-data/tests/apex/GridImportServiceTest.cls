/**
 * DEVELOPMENT ONLY. Never packaged.
 * Import: what one batch of a file updates and creates, what it
 * refuses, and how a row that fails comes back. The fixture configurations
 * decide whether a grid allows it: Test_Records and Security_Test do,
 * Save_Test does not, and Import_Without_New_Test sets Allow Import without
 * Allow New Records, so it does not either. The field-level security case is in GridSecurityTest.
 */
@IsTest
private class GridImportServiceTest {
    private static Map<String, Object> row(Map<String, Object> values) {
        return values;
    }

    private static String refusal(String configName, List<Map<String, Object>> rows) {
        try {
            GridImportService.importRows(configName, rows);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void updatesRowsWithAnIdAndCreatesRowsWithout() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c existing = new Rowhouse_Test_Record__c(Name = 'Before', Number_Field__c = 1);
            insert existing;
            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Test_Records',
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Name' => 'After', 'Number_Field__c' => '12' }),
                    row(
                        new Map<String, Object>{
                            'Name' => 'Imported',
                            'Text_Field__c' => 'new',
                            'Date_Field__c' => '2026-12-31',
                            'Checkbox_Field__c' => true,
                            'Picklist_Field__c' => 'Gamma'
                        }
                    )
                }
            );
            Test.stopTest();
            System.assertEquals(2, result.rows.size());
            System.assert(result.rows[0].success && !result.rows[0].created, String.valueOf(result.rows[0]));
            System.assertEquals(existing.Id, result.rows[0].recordId);
            System.assert(result.rows[1].success && result.rows[1].created, String.valueOf(result.rows[1]));
            Rowhouse_Test_Record__c after = [
                SELECT Name, Number_Field__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :existing.Id
            ];
            System.assertEquals('After', after.Name);
            System.assertEquals(12, after.Number_Field__c);
            Rowhouse_Test_Record__c made = [
                SELECT Name, Text_Field__c, Date_Field__c, Checkbox_Field__c, Picklist_Field__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :result.rows[1].recordId
            ];
            System.assertEquals('Imported', made.Name);
            System.assertEquals('new', made.Text_Field__c);
            System.assertEquals(Date.newInstance(2026, 12, 31), made.Date_Field__c);
            System.assertEquals(true, made.Checkbox_Field__c);
            System.assertEquals('Gamma', made.Picklist_Field__c);
        }
    }

    @IsTest
    static void reportsEachRowThatFailsAndWritesTheRest() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c existing = new Rowhouse_Test_Record__c(Name = 'Keep');
            insert existing;
            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Test_Records',
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Name' => 'Good new row' }),
                    row(new Map<String, Object>{ 'Name' => 'Bad number', 'Number_Field__c' => 'twelve' }),
                    row(new Map<String, Object>{ 'Name' => '' }),
                    row(new Map<String, Object>{ 'Id' => UserInfo.getUserId(), 'Name' => 'Wrong object' }),
                    row(new Map<String, Object>{ 'Id' => 'not-an-id', 'Name' => 'Garbage' }),
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Text_Field__c' => 'first' }),
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Text_Field__c' => 'second' })
                }
            );
            Test.stopTest();
            List<GridImportService.RowResult> r = result.rows;
            System.assert(r[0].success, String.valueOf(r[0]));
            System.assertEquals(false, r[1].success);
            System.assertEquals('Number_Field__c', r[1].fieldName);
            System.assert(r[1].message.startsWith('Number_Field__c: Invalid value'), r[1].message);
            System.assertEquals(
                'Name: ' + GridSaveService.REQUIRED_MESSAGE,
                r[2].message,
                'A required field cannot be blank.'
            );
            System.assertEquals('Record ' + UserInfo.getUserId() + ' is not a Rowhouse_Test_Record__c.', r[3].message);
            System.assertEquals('Not a record Id: not-an-id', r[4].message);
            System.assert(r[5].success, String.valueOf(r[5]));
            System.assertEquals('Record ' + existing.Id + ' is in the file more than once.', r[6].message);
            System.assertEquals(
                'first',
                [SELECT Text_Field__c FROM Rowhouse_Test_Record__c WHERE Id = :existing.Id].Text_Field__c
            );
            System.assertEquals(1, [SELECT COUNT() FROM Rowhouse_Test_Record__c WHERE Name = 'Good new row']);
            System.assertEquals(
                0,
                [SELECT COUNT() FROM Rowhouse_Test_Record__c WHERE Name IN ('Bad number', 'Wrong object', 'Garbage')]
            );
        }
    }

    @IsTest
    static void writesOnlyTheEditableColumnsOfTheGrid() {
        // HR-6 for import: Read_Only_Text__c is a column, but not an editable
        // one; Long_Text__c is not a column of Test_Records at all. The user
        // can edit both, so only the allow-list can stop them.
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Test_Records',
                new List<Map<String, Object>>{
                    row(
                        new Map<String, Object>{
                            'Name' => 'Allow-list',
                            'Read_Only_Text__c' => 'no',
                            'Long_Text__c' => 'no'
                        }
                    )
                }
            );
            Test.stopTest();
            System.assert(result.rows[0].success, String.valueOf(result.rows[0]));
            System.assert(result.rejectedFields.contains('Read_Only_Text__c'), String.valueOf(result.rejectedFields));
            System.assert(result.rejectedFields.contains('Long_Text__c'), String.valueOf(result.rejectedFields));
            Rowhouse_Test_Record__c made = [
                SELECT Read_Only_Text__c, Long_Text__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :result.rows[0].recordId
            ];
            System.assertEquals(null, made.Read_Only_Text__c);
            System.assertEquals(null, made.Long_Text__c);
        }
    }

    @IsTest
    static void refusesWhenTheConfigurationDoesNotAllowIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            String message = refusal(
                'Save_Test',
                new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Number_Field__c' => '1' }) }
            );
            Boolean offered = GridConfig.forUser('Save_Test').allowImport;
            Test.stopTest();
            System.assertEquals('This grid does not allow importing records.', message);
            System.assertEquals(false, offered, 'The grid must not offer what the server refuses.');
            System.assertEquals(0, [SELECT COUNT() FROM Rowhouse_Test_Record__c]);
        }
    }

    @IsTest
    static void aGridWithoutNewRecordsOffersNoImportAndRefusesOneEvenToUpdate() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c existing = new Rowhouse_Test_Record__c(Name = 'Kept', Number_Field__c = 1);
            insert existing;
            Test.startTest();
            String message = refusal(
                'Import_Without_New_Test',
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Number_Field__c' => '2' }),
                    row(new Map<String, Object>{ 'Number_Field__c' => '3' })
                }
            );
            GridConfig.Definition def = GridConfig.forUser('Import_Without_New_Test');
            Test.stopTest();
            System.assertEquals('This grid does not allow importing records.', message);
            System.assertEquals(false, def.allowImport, 'The grid must not offer what the server refuses.');
            System.assert(
                def.warnings.contains('Allow Import: the grid offers no import, because Allow New Records is off.'),
                String.valueOf(def.warnings)
            );
            System.assertEquals(1, [SELECT COUNT() FROM Rowhouse_Test_Record__c], 'Nothing was created.');
            System.assertEquals(1, [SELECT Number_Field__c FROM Rowhouse_Test_Record__c].Number_Field__c);
        }
    }

    @IsTest
    static void refusesMoreThanTwoHundredRows() {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Integer i = 0; i <= GridImportService.MAX_ROWS; i++) {
            rows.add(row(new Map<String, Object>{ 'Name' => 'Row ' + i }));
        }
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            String message = refusal('Test_Records', rows);
            Test.stopTest();
            System.assertEquals('Import at most 200 rows at a time; this request has 201.', message);
            System.assertEquals(0, [SELECT COUNT() FROM Rowhouse_Test_Record__c]);
        }
    }

    @IsTest
    static void tellsTheGridWhoMayImportAndCreate() {
        GridConfig.Definition def;
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            def = GridConfig.forUser('Test_Records');
            Test.stopTest();
        }
        System.assertEquals(true, def.allowImport);
        System.assertEquals(true, def.canCreate);
    }

    @IsTest
    static void theControllerPassesOnARefusalAndAnEmptyRequest() {
        System.runAs(GridTestUsers.fullUser()) {
            String message;
            Test.startTest();
            GridImportService.Result empty = GridController.importRows(
                'Save_Test',
                new List<Map<String, Object>>(),
                null,
                null,
                null,
                null
            );
            try {
                GridController.importRows(
                    'Save_Test',
                    new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Number_Field__c' => '1' }) },
                    null,
                    null,
                    null,
                    null
                );
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Test.stopTest();
            System.assert(empty.rows.isEmpty(), 'Nothing asked, nothing done.');
            System.assertEquals('This grid does not allow importing records.', message);
        }
    }

    // ---------------------------------------------------------- matching and undoing

    private static GridImportService.Result matched(List<Map<String, Object>> rows) {
        return GridImportService.importRows('Import_Test', rows, null, null, null, 'External_Key__c');
    }

    @IsTest
    static void matchesRecordsByAnExternalIdUpdatingOrCreating() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c known = new Rowhouse_Test_Record__c(
                Name = 'Known',
                External_Key__c = 'K-1',
                Number_Field__c = 1
            );
            insert known;
            Test.startTest();
            GridImportService.Result result = matched(
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'External_Key__c' => 'k-1', 'Number_Field__c' => '5' }),
                    row(new Map<String, Object>{ 'External_Key__c' => 'K-2', 'Name' => 'New by key' }),
                    row(new Map<String, Object>{ 'Name' => 'No key at all' })
                }
            );
            Test.stopTest();
            System.assert(
                result.rows[0].success && !result.rows[0].created,
                'A value that matches updates, in any case: ' + result.rows[0]
            );
            System.assertEquals(known.Id, result.rows[0].recordId);
            System.assertEquals(
                '1',
                String.valueOf(
                    Decimal.valueOf(String.valueOf(result.rows[0].previous.get('Number_Field__c'))).intValue()
                ),
                'An update says what the field held, for Undo import.'
            );
            System.assert(
                result.rows[1].success && result.rows[1].created,
                'A value that matches nothing creates: ' + result.rows[1]
            );
            System.assert(
                result.rows[2].success && result.rows[2].created,
                'A row without a value creates: ' + result.rows[2]
            );
            System.assertEquals(null, result.rows[1].previous);
            System.assertEquals(
                5,
                [SELECT Number_Field__c FROM Rowhouse_Test_Record__c WHERE Id = :known.Id].Number_Field__c
            );
            System.assertEquals(
                'K-2',
                [SELECT External_Key__c FROM Rowhouse_Test_Record__c WHERE Id = :result.rows[1].recordId]
                .External_Key__c
            );
        }
    }

    @IsTest
    static void refusesAMatchThatIsNotOneRecord() {
        System.runAs(GridTestUsers.fullUser()) {
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(Name = 'Twin 1', External_Key__c = 'TWIN'),
                new Rowhouse_Test_Record__c(Name = 'Twin 2', External_Key__c = 'TWIN')
            };
            GridImportService.Result result = matched(
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'External_Key__c' => 'twin', 'Number_Field__c' => '1' }),
                    row(new Map<String, Object>{ 'External_Key__c' => 'ONCE', 'Number_Field__c' => '2' }),
                    row(new Map<String, Object>{ 'External_Key__c' => 'once', 'Number_Field__c' => '3' })
                }
            );
            System.assertEquals('More than one record has twin as its External Key.', result.rows[0].message);
            System.assert(result.rows[1].success, String.valueOf(result.rows[1]));
            System.assertEquals('once is in the file more than once.', result.rows[2].message);
            String refused;
            try {
                GridImportService.importRows(
                    'Import_Test',
                    new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Name' => 'x' }) },
                    null,
                    null,
                    null,
                    'Text_Field__c'
                );
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals(
                'Records cannot be matched by Text_Field__c in this grid.',
                refused,
                'Only an External Id column matches.'
            );
        }
    }

    @IsTest
    static void undoDeletesOnlyTheRecordsThisUserJustCreated() {
        Rowhouse_Test_Record__c someoneElses;
        System.runAs(GridTestUsers.adminUser()) {
            someoneElses = new Rowhouse_Test_Record__c(Name = 'Not yours');
            insert someoneElses;
        }
        System.runAs(GridTestUsers.fullUser()) {
            GridImportService.Result made = GridImportService.importRows(
                'Import_Test',
                new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Name' => 'Undo me' }) }
            );
            Id mine = made.rows[0].recordId;
            Test.startTest();
            GridDeleteService.Result undone = GridController.undoImport(
                'Import_Test',
                new List<Id>{ mine, someoneElses.Id }
            );
            Test.stopTest();
            System.assertEquals(new List<Id>{ mine }, undone.deletedIds);
            System.assertEquals(1, undone.errors.size());
            System.assertEquals(someoneElses.Id, undone.errors[0].recordId);
            System.assertEquals(0, [SELECT COUNT() FROM Rowhouse_Test_Record__c WHERE Id = :mine]);
            System.assertEquals(1, [SELECT COUNT() FROM Rowhouse_Test_Record__c WHERE Id = :someoneElses.Id ALL ROWS]);
            String refused;
            try {
                GridImportService.undoCreates('Save_Test', new List<Id>{ mine });
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals('This grid does not allow importing records.', refused);
        }
    }

    @IsTest
    static void tellsTheGridWhichColumnsAreExternalIds() {
        System.runAs(GridTestUsers.fullUser()) {
            for (GridConfig.Column c : GridConfig.forUser('Import_Test').columns) {
                System.assertEquals(c.field == 'External_Key__c', c.externalId, c.field);
            }
        }
    }
}
