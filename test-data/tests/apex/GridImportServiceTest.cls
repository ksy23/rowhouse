/**
 * DEVELOPMENT ONLY. Never packaged.
 * Import: what one batch of a file updates and creates, what it
 * refuses, and how a row that fails comes back. The fixture configurations
 * decide whether a grid allows it: Consignments and Consignment_Charges do,
 * Consignment_Rates does not, and Consignment_Updates sets Allow Import without
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
            Consignment__c existing = new Consignment__c(Name = 'Penobscot Paper, half truck', Pieces__c = 1);
            insert existing;
            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Consignments',
                new List<Map<String, Object>>{
                    row(
                        new Map<String, Object>{
                            'Id' => existing.Id,
                            'Name' => 'Penobscot Paper, full truck',
                            'Pieces__c' => '12'
                        }
                    ),
                    row(
                        new Map<String, Object>{
                            'Name' => 'Merrimack Valley Foods, 18 pallets',
                            'Consignee__c' => 'Merrimack Valley Foods',
                            'Ship_Date__c' => '2026-12-31',
                            'Delivered__c' => true,
                            'Service_Level__c' => 'Express'
                        }
                    )
                }
            );
            Test.stopTest();
            System.assertEquals(2, result.rows.size());
            System.assert(result.rows[0].success && !result.rows[0].created, String.valueOf(result.rows[0]));
            System.assertEquals(existing.Id, result.rows[0].recordId);
            System.assert(result.rows[1].success && result.rows[1].created, String.valueOf(result.rows[1]));
            Consignment__c after = [
                SELECT Name, Pieces__c
                FROM Consignment__c
                WHERE Id = :existing.Id
            ];
            System.assertEquals('Penobscot Paper, full truck', after.Name);
            System.assertEquals(12, after.Pieces__c);
            Consignment__c made = [
                SELECT Name, Consignee__c, Ship_Date__c, Delivered__c, Service_Level__c
                FROM Consignment__c
                WHERE Id = :result.rows[1].recordId
            ];
            System.assertEquals('Merrimack Valley Foods, 18 pallets', made.Name);
            System.assertEquals('Merrimack Valley Foods', made.Consignee__c);
            System.assertEquals(Date.newInstance(2026, 12, 31), made.Ship_Date__c);
            System.assertEquals(true, made.Delivered__c);
            System.assertEquals('Express', made.Service_Level__c);
        }
    }

    @IsTest
    static void reportsEachRowThatFailsAndWritesTheRest() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c existing = new Consignment__c(Name = 'Wachusett Paper, 6 rolls');
            insert existing;
            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Consignments',
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Name' => 'Green Mountain Maple, 40 cases' }),
                    row(new Map<String, Object>{ 'Name' => 'Berkshire Mills, 9 bales', 'Pieces__c' => 'twelve' }),
                    row(new Map<String, Object>{ 'Name' => '' }),
                    row(new Map<String, Object>{ 'Id' => UserInfo.getUserId(), 'Name' => 'Cape Ann Seafood, 9 totes' }),
                    row(new Map<String, Object>{ 'Id' => 'not-an-id', 'Name' => 'Monadnock Granite, 1 slab' }),
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Consignee__c' => 'Wachusett Paper' }),
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Consignee__c' => 'Penobscot Paper' })
                }
            );
            Test.stopTest();
            List<GridImportService.RowResult> r = result.rows;
            System.assert(r[0].success, String.valueOf(r[0]));
            System.assertEquals(false, r[1].success);
            System.assertEquals('Pieces__c', r[1].fieldName);
            System.assert(r[1].message.startsWith('Pieces__c: Invalid value'), r[1].message);
            System.assertEquals(
                'Name: ' + GridSaveService.REQUIRED_MESSAGE,
                r[2].message,
                'A required field cannot be blank.'
            );
            System.assertEquals('Record ' + UserInfo.getUserId() + ' is not a Consignment__c.', r[3].message);
            System.assertEquals('Not a record Id: not-an-id', r[4].message);
            System.assert(r[5].success, String.valueOf(r[5]));
            System.assertEquals('Record ' + existing.Id + ' is in the file more than once.', r[6].message);
            System.assertEquals(
                'Wachusett Paper',
                [SELECT Consignee__c FROM Consignment__c WHERE Id = :existing.Id].Consignee__c
            );
            System.assertEquals(1, [SELECT COUNT() FROM Consignment__c WHERE Name = 'Green Mountain Maple, 40 cases']);
            System.assertEquals(
                0,
                [
                    SELECT COUNT()
                    FROM Consignment__c
                    WHERE Name IN ('Berkshire Mills, 9 bales', 'Cape Ann Seafood, 9 totes', 'Monadnock Granite, 1 slab')
                ]
            );
        }
    }

    @IsTest
    static void writesOnlyTheEditableColumnsOfTheGrid() {
        // HR-6 for import: Carrier_Code__c is a column, but not an editable
        // one; Delivery_Notes__c is not a column of Consignments at all. The user
        // can edit both, so only the allow-list can stop them.
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Consignments',
                new List<Map<String, Object>>{
                    row(
                        new Map<String, Object>{
                            'Name' => 'Blackstone Valley Textiles, 8 bales',
                            'Carrier_Code__c' => 'GCFR',
                            'Delivery_Notes__c' => 'Call the receiving desk on arrival.'
                        }
                    )
                }
            );
            Test.stopTest();
            System.assert(result.rows[0].success, String.valueOf(result.rows[0]));
            System.assert(result.rejectedFields.contains('Carrier_Code__c'), String.valueOf(result.rejectedFields));
            System.assert(result.rejectedFields.contains('Delivery_Notes__c'), String.valueOf(result.rejectedFields));
            Consignment__c made = [
                SELECT Carrier_Code__c, Delivery_Notes__c
                FROM Consignment__c
                WHERE Id = :result.rows[0].recordId
            ];
            System.assertEquals(null, made.Carrier_Code__c);
            System.assertEquals(null, made.Delivery_Notes__c);
        }
    }

    @IsTest
    static void refusesWhenTheConfigurationDoesNotAllowIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            String message = refusal(
                'Consignment_Rates',
                new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Pieces__c' => '1' }) }
            );
            Boolean offered = GridConfig.forUser('Consignment_Rates').allowImport;
            Test.stopTest();
            System.assertEquals('This grid does not allow importing records.', message);
            System.assertEquals(false, offered, 'The grid must not offer what the server refuses.');
            System.assertEquals(0, [SELECT COUNT() FROM Consignment__c]);
        }
    }

    @IsTest
    static void aGridWithoutNewRecordsOffersNoImportAndRefusesOneEvenToUpdate() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c existing = new Consignment__c(Name = 'Monadnock Granite, 2 slabs', Pieces__c = 1);
            insert existing;
            Test.startTest();
            String message = refusal(
                'Consignment_Updates',
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Id' => existing.Id, 'Pieces__c' => '2' }),
                    row(new Map<String, Object>{ 'Pieces__c' => '3' })
                }
            );
            GridConfig.Definition def = GridConfig.forUser('Consignment_Updates');
            Test.stopTest();
            System.assertEquals('This grid does not allow importing records.', message);
            System.assertEquals(false, def.allowImport, 'The grid must not offer what the server refuses.');
            System.assert(
                def.warnings.contains('Allow Import: the grid offers no import, because Allow New Records is off.'),
                String.valueOf(def.warnings)
            );
            System.assertEquals(1, [SELECT COUNT() FROM Consignment__c], 'Nothing was created.');
            System.assertEquals(1, [SELECT Pieces__c FROM Consignment__c].Pieces__c);
        }
    }

    @IsTest
    static void refusesMoreThanTwoHundredRows() {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Integer i = 0; i <= GridImportService.MAX_ROWS; i++) {
            rows.add(row(new Map<String, Object>{ 'Name' => 'Pioneer Valley Orchards, load ' + i }));
        }
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            String message = refusal('Consignments', rows);
            Test.stopTest();
            System.assertEquals('Import at most 200 rows at a time; this request has 201.', message);
            System.assertEquals(0, [SELECT COUNT() FROM Consignment__c]);
        }
    }

    @IsTest
    static void tellsTheGridWhoMayImportAndCreate() {
        GridConfig.Definition def;
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            def = GridConfig.forUser('Consignments');
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
                'Consignment_Rates',
                new List<Map<String, Object>>(),
                null,
                null,
                null,
                null
            );
            try {
                GridController.importRows(
                    'Consignment_Rates',
                    new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Pieces__c' => '1' }) },
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
        return GridImportService.importRows('Consignment_Import', rows, null, null, null, 'Bill_Of_Lading__c');
    }

    @IsTest
    static void matchesRecordsByAnExternalIdUpdatingOrCreating() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c known = new Consignment__c(
                Name = 'Androscoggin Pulp, 20 bales',
                Bill_Of_Lading__c = 'BOL-40217',
                Pieces__c = 1
            );
            insert known;
            Test.startTest();
            GridImportService.Result result = matched(
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Bill_Of_Lading__c' => 'bol-40217', 'Pieces__c' => '5' }),
                    row(
                        new Map<String, Object>{
                            'Bill_Of_Lading__c' => 'BOL-40218',
                            'Name' => 'Narragansett Shellfish, 12 totes'
                        }
                    ),
                    row(new Map<String, Object>{ 'Name' => 'Kennebec Lumber, 12 bundles' })
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
                String.valueOf(Decimal.valueOf(String.valueOf(result.rows[0].previous.get('Pieces__c'))).intValue()),
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
            System.assertEquals(5, [SELECT Pieces__c FROM Consignment__c WHERE Id = :known.Id].Pieces__c);
            System.assertEquals(
                'BOL-40218',
                [SELECT Bill_Of_Lading__c FROM Consignment__c WHERE Id = :result.rows[1].recordId].Bill_Of_Lading__c
            );
        }
    }

    @IsTest
    static void refusesAMatchThatIsNotOneRecord() {
        System.runAs(GridTestUsers.fullUser()) {
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Bangor Brick & Tile, 1 of 2', Bill_Of_Lading__c = 'BOL-40311'),
                new Consignment__c(Name = 'Bangor Brick & Tile, 2 of 2', Bill_Of_Lading__c = 'BOL-40311')
            };
            GridImportService.Result result = matched(
                new List<Map<String, Object>>{
                    row(new Map<String, Object>{ 'Bill_Of_Lading__c' => 'bol-40311', 'Pieces__c' => '1' }),
                    row(new Map<String, Object>{ 'Bill_Of_Lading__c' => 'BOL-40312', 'Pieces__c' => '2' }),
                    row(new Map<String, Object>{ 'Bill_Of_Lading__c' => 'bol-40312', 'Pieces__c' => '3' })
                }
            );
            System.assertEquals('More than one record has bol-40311 as its Bill of Lading.', result.rows[0].message);
            System.assert(result.rows[1].success, String.valueOf(result.rows[1]));
            System.assertEquals('bol-40312 is in the file more than once.', result.rows[2].message);
            String refused;
            try {
                GridImportService.importRows(
                    'Consignment_Import',
                    new List<Map<String, Object>>{
                        row(new Map<String, Object>{ 'Name' => 'Mill River Energy, 2 drums' })
                    },
                    null,
                    null,
                    null,
                    'Consignee__c'
                );
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals(
                'Records cannot be matched by Consignee__c in this grid.',
                refused,
                'Only an External Id column matches.'
            );
        }
    }

    @IsTest
    static void undoDeletesOnlyTheRecordsThisUserJustCreated() {
        Consignment__c someoneElses;
        System.runAs(GridTestUsers.adminUser()) {
            someoneElses = new Consignment__c(Name = 'Saco River Outfitters, 3 crates');
            insert someoneElses;
        }
        System.runAs(GridTestUsers.fullUser()) {
            GridImportService.Result made = GridImportService.importRows(
                'Consignment_Import',
                new List<Map<String, Object>>{ row(new Map<String, Object>{ 'Name' => 'Quabbin Supply, 6 crates' }) }
            );
            Id mine = made.rows[0].recordId;
            Test.startTest();
            GridDeleteService.Result undone = GridController.undoImport(
                'Consignment_Import',
                new List<Id>{ mine, someoneElses.Id }
            );
            Test.stopTest();
            System.assertEquals(new List<Id>{ mine }, undone.deletedIds);
            System.assertEquals(1, undone.errors.size());
            System.assertEquals(someoneElses.Id, undone.errors[0].recordId);
            System.assertEquals(0, [SELECT COUNT() FROM Consignment__c WHERE Id = :mine]);
            System.assertEquals(1, [SELECT COUNT() FROM Consignment__c WHERE Id = :someoneElses.Id ALL ROWS]);
            String refused;
            try {
                GridImportService.undoCreates('Consignment_Rates', new List<Id>{ mine });
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals('This grid does not allow importing records.', refused);
        }
    }

    @IsTest
    static void tellsTheGridWhichColumnsAreExternalIds() {
        System.runAs(GridTestUsers.fullUser()) {
            for (GridConfig.Column c : GridConfig.forUser('Consignment_Import').columns) {
                System.assertEquals(c.field == 'Bill_Of_Lading__c', c.externalId, c.field);
            }
        }
    }
}
