/**
 * DEVELOPMENT ONLY. Never packaged.
 * The New button: how a grid offers new rows (newRowFor) and what saving
 * them creates (create). The fixture configurations decide: Test_Records
 * allows new records and has every required field as an editable column;
 * Security_Test leaves Name out, so New opens Salesforce's form; Save_Test
 * has no New button; Account_Contacts is on an Account's page and
 * Nest_Contacts is a child table under an Account.
 */
@IsTest
private class GridCreateServiceTest {
    private static Map<String, Object> row(String key, Map<String, Object> values) {
        Map<String, Object> out = new Map<String, Object>(values);
        out.put('key', key);
        return out;
    }

    private static String refusal(String configName, List<Map<String, Object>> rows) {
        try {
            GridCreateService.create(configName, rows, null, null, null);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    private static Map<String, GridCreateService.RowResult> byKey(GridCreateService.Result result) {
        Map<String, GridCreateService.RowResult> out = new Map<String, GridCreateService.RowResult>();
        for (GridCreateService.RowResult r : result.rows) {
            out.put(r.key, r);
        }
        return out;
    }

    // ------------------------------------------------------------ creating

    @IsTest
    static void createsTheRecordsOfNewRowsAndAnswersEachByItsKey() {
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridCreateService.Result result = GridCreateService.create(
                'Test_Records',
                new List<Map<String, Object>>{
                    row(
                        'rh-new-1',
                        new Map<String, Object>{
                            'Name' => 'Made in the grid',
                            'Number_Field__c' => '5',
                            'Date_Field__c' => '2026-12-31',
                            'Picklist_Field__c' => 'Beta',
                            'Checkbox_Field__c' => true
                        }
                    ),
                    row('rh-new-2', new Map<String, Object>{ 'Name' => 'Second' })
                },
                null,
                null,
                null
            );
            Test.stopTest();
            Map<String, GridCreateService.RowResult> rows = byKey(result);
            System.assertEquals(2, rows.size());
            System.assert(rows.get('rh-new-1').success, String.valueOf(rows.get('rh-new-1').errors));
            System.assert(rows.get('rh-new-2').success, String.valueOf(rows.get('rh-new-2').errors));
            Rowhouse_Test_Record__c made = [
                SELECT Name, Number_Field__c, Date_Field__c, Picklist_Field__c, Checkbox_Field__c, OwnerId
                FROM Rowhouse_Test_Record__c
                WHERE Id = :rows.get('rh-new-1').recordId
            ];
            System.assertEquals('Made in the grid', made.Name);
            System.assertEquals(5, made.Number_Field__c);
            System.assertEquals(Date.newInstance(2026, 12, 31), made.Date_Field__c);
            System.assertEquals('Beta', made.Picklist_Field__c);
            System.assertEquals(true, made.Checkbox_Field__c);
            System.assertEquals(UserInfo.getUserId(), made.OwnerId, 'The platform makes the creator the owner.');
            System.assertEquals(0, result.rejectedFields.size());
        }
    }

    @IsTest
    static void aRowThatFailsFailsAloneAndSaysWhy() {
        System.runAs(GridTestUsers.fullUser()) {
            GridCreateService.Result result = GridCreateService.create(
                'Test_Records',
                new List<Map<String, Object>>{
                    row('good', new Map<String, Object>{ 'Name' => 'Good' }),
                    row('bad', new Map<String, Object>{ 'Name' => 'Bad', 'Number_Field__c' => 'twelve' }),
                    row('blank', new Map<String, Object>{ 'Text_Field__c' => 'no name' })
                },
                null,
                null,
                null
            );
            Map<String, GridCreateService.RowResult> rows = byKey(result);
            System.assert(rows.get('good').success);
            System.assert(!rows.get('bad').success);
            System.assertEquals('Number_Field__c', rows.get('bad').errors[0].fieldName);
            System.assert(
                rows.get('bad').errors[0].message.startsWith('Invalid value'),
                rows.get('bad').errors[0].message
            );
            System.assert(!rows.get('blank').success, 'A text Name left blank is refused, not filled with the Id.');
            System.assertEquals('Name', rows.get('blank').errors[0].fieldName);
            System.assertEquals(GridSaveService.REQUIRED_MESSAGE, rows.get('blank').errors[0].message);
            System.assertEquals(1, [SELECT COUNT() FROM Rowhouse_Test_Record__c], 'Only the good row became a record.');
        }
    }

    @IsTest
    static void onlyTheGridsEditableColumnsAreWritten() {
        System.runAs(GridTestUsers.fullUser()) {
            GridCreateService.Result result = GridCreateService.create(
                'Test_Records',
                new List<Map<String, Object>>{
                    row(
                        'k',
                        new Map<String, Object>{
                            'Name' => 'Allowed',
                            'Read_Only_Text__c' => 'not a column you may edit',
                            'Id' => '001000000000000AAA'
                        }
                    )
                },
                null,
                null,
                null
            );
            GridCreateService.RowResult r = result.rows[0];
            System.assert(r.success, String.valueOf(r.errors));
            System.assert(result.rejectedFields.contains('Read_Only_Text__c'), String.valueOf(result.rejectedFields));
            Rowhouse_Test_Record__c made = [
                SELECT Read_Only_Text__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :r.recordId
            ];
            System.assertEquals(null, made.Read_Only_Text__c);
        }
    }

    @IsTest
    static void fieldsTheUserMayNotSetOnCreateAreStripped() {
        System.runAs(GridTestUsers.limitedUser()) {
            GridCreateService.Result result = GridCreateService.create(
                'Security_Test',
                new List<Map<String, Object>>{
                    row(
                        'k',
                        new Map<String, Object>{ 'Text_Field__c' => 'set', 'Read_Only_Text__c' => 'not on create' }
                    )
                },
                null,
                null,
                null
            );
            System.assert(result.rows[0].success, String.valueOf(result.rows[0].errors));
            System.assert(result.strippedFields.contains('Read_Only_Text__c'), String.valueOf(result.strippedFields));
            Rowhouse_Test_Record__c made = [
                SELECT Text_Field__c, Read_Only_Text__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :result.rows[0].recordId
            ];
            System.assertEquals('set', made.Text_Field__c);
            System.assertEquals(null, made.Read_Only_Text__c);
        }
    }

    @IsTest
    static void aGridWithoutTheNewButtonCreatesNothing() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                'This grid does not allow new records.',
                refusal(
                    'Save_Test',
                    new List<Map<String, Object>>{ row('k', new Map<String, Object>{ 'Name' => 'x' }) }
                )
            );
            System.assertEquals(0, [SELECT COUNT() FROM Rowhouse_Test_Record__c]);
            System.assertEquals(
                0,
                GridCreateService.create('Save_Test', new List<Map<String, Object>>(), null, null, null).rows.size(),
                'Nothing asked, nothing refused.'
            );
        }
    }

    @IsTest
    static void onARecordPageTheNewRecordPointsToThePagesRecord() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = new Account(Name = 'Acme Harbor');
            insert acme;
            GridCreateService.Result result = GridCreateService.create(
                'Account_Contacts',
                new List<Map<String, Object>>{
                    row('k', new Map<String, Object>{ 'FirstName' => 'Ada', 'LastName' => 'Whitcomb' })
                },
                null,
                null,
                acme.Id
            );
            System.assert(result.rows[0].success, String.valueOf(result.rows[0].errors));
            Contact made = [SELECT AccountId, LastName FROM Contact WHERE Id = :result.rows[0].recordId];
            System.assertEquals(acme.Id, made.AccountId);
            System.assertEquals('Whitcomb', made.LastName);
        }
    }

    @IsTest
    static void inAChildTableTheNewRecordIsUnderItsParent() {
        System.runAs(GridTestUsers.fullUser()) {
            Account parent = new Account(Name = 'Parent Mills');
            insert parent;
            GridCreateService.Result result = GridCreateService.create(
                'Nest_Contacts',
                new List<Map<String, Object>>{ row('k', new Map<String, Object>{ 'LastName' => 'Prescott' }) },
                'Nest_Accounts_Contacts',
                parent.Id,
                null
            );
            System.assert(result.rows[0].success, String.valueOf(result.rows[0].errors));
            System.assertEquals(
                parent.Id,
                [SELECT AccountId FROM Contact WHERE Id = :result.rows[0].recordId].AccountId
            );
        }
    }

    @IsTest
    static void aRequiredColumnLeftBlankFailsTheRowBeforeAnythingIsWritten() {
        System.runAs(GridTestUsers.fullUser()) {
            GridCreateService.Result result = GridCreateService.create(
                'Account_Contacts',
                new List<Map<String, Object>>{ row('k', new Map<String, Object>{ 'FirstName' => 'NoLast' }) },
                null,
                null,
                null
            );
            System.assert(!result.rows[0].success);
            System.assertEquals('LastName', result.rows[0].errors[0].fieldName, String.valueOf(result.rows[0].errors));
            System.assertEquals(GridSaveService.REQUIRED_MESSAGE, result.rows[0].errors[0].message);
            System.assertEquals(0, [SELECT COUNT() FROM Contact WHERE FirstName = 'NoLast']);
        }
    }

    @IsTest
    static void eachNewRecordIsLoggedInAGridThatLogsItsChanges() {
        System.runAs(GridTestUsers.fullUser()) {
            GridCreateService.Result result = GridCreateService.create(
                'Audit_Test',
                new List<Map<String, Object>>{ row('k', new Map<String, Object>{ 'Name' => 'Logged new row' }) },
                null,
                null,
                null
            );
            System.assert(result.rows[0].success, String.valueOf(result.rows[0].errors));
            List<Grid_Edit_Log__c> entries = [
                SELECT Operation__c, Record_Name__c, Grid_Configuration__c
                FROM Grid_Edit_Log__c
                WHERE Record_Id__c = :String.valueOf(result.rows[0].recordId)
            ];
            System.assertEquals(1, entries.size());
            System.assertEquals('Create', entries[0].Operation__c);
            System.assertEquals('Logged new row', entries[0].Record_Name__c);
            System.assertEquals('Audit_Test', entries[0].Grid_Configuration__c);
        }
    }

    // ------------------------------------------------------------ the new row

    @IsTest
    static void aGridWithEveryRequiredFieldAsAColumnAddsRowsInPlaceWithSalesforcesDefaults() {
        Map<String, Object> newRow;
        User full = GridTestUsers.fullUser();
        System.runAs(full) {
            newRow = GridCreateService.newRowFor(GridConfig.forUser('Test_Records'), null, null, null);
        }
        System.assertNotEquals(null, newRow);
        System.assertEquals(true, newRow.get('inline'), String.valueOf(newRow.get('missing')));
        System.assertEquals(0, ((List<String>) newRow.get('missing')).size());
        Map<String, Object> defaults = (Map<String, Object>) newRow.get('defaults');
        System.assertEquals(false, defaults.get('Checkbox_Field__c'), 'A checkbox starts as Salesforce says.');
        System.assertEquals(
            full.Id,
            defaults.get('OwnerId'),
            'The owner starts as the user, as on Salesforce\'s form.'
        );
        System.assertEquals(
            'Rowhouse Full',
            ((Map<String, String>) newRow.get('names')).get(String.valueOf(full.Id)),
            'The owner\'s name, to show in the cell.'
        );
        System.assert(!defaults.containsKey('Formula_Number__c'), 'Only the cells a new row fills in.');
        System.assertEquals(0, ((Map<String, Object>) newRow.get('presets')).size());
    }

    @IsTest
    static void aRequiredFieldThatIsNotAColumnSendsNewToSalesforcesForm() {
        Map<String, Object> newRow;
        System.runAs(GridTestUsers.fullUser()) {
            newRow = GridCreateService.newRowFor(GridConfig.forUser('Security_Test'), null, null, null);
        }
        System.assertEquals(false, newRow.get('inline'));
        System.assertEquals(
            new List<String>{ Rowhouse_Test_Record__c.Name.getDescribe().getLabel() },
            newRow.get('missing')
        );
    }

    @IsTest
    static void noNewButtonNoNewRow() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(null, GridCreateService.newRowFor(GridConfig.forUser('Save_Test'), null, null, null));
            System.assertEquals(null, GridCreateService.newRowFor(null, null, null, null));
        }
    }

    @IsTest
    static void onARecordPageTheNewRowCarriesThePagesRecordWithItsName() {
        Map<String, Object> newRow;
        Account acme;
        System.runAs(GridTestUsers.fullUser()) {
            acme = new Account(Name = 'Acme Harbor');
            insert acme;
            newRow = GridCreateService.newRowFor(GridConfig.forUser('Account_Contacts'), null, null, acme.Id);
        }
        System.assertEquals(true, newRow.get('inline'), 'Last Name is a column; Account is filled in by the page.');
        System.assertEquals(acme.Id, ((Map<String, Object>) newRow.get('presets')).get('AccountId'));
        System.assertEquals('Acme Harbor', ((Map<String, String>) newRow.get('names')).get(String.valueOf(acme.Id)));
    }

    @IsTest
    static void aFieldIsNeededOnCreateAsSalesforcesNewFormAsksForIt() {
        System.runAs(GridTestUsers.fullUser()) {
            neededOnCreateAsTheFormAsks();
        }
    }

    private static void neededOnCreateAsTheFormAsks() {
        System.assertEquals(true, GridCreateService.neededOnCreate(Contact.LastName));
        System.assertEquals(false, GridCreateService.neededOnCreate(Contact.FirstName));
        System.assertEquals(true, GridCreateService.neededOnCreate(Account.Name));
        System.assertEquals(
            true,
            GridCreateService.neededOnCreate(Rowhouse_Test_Record__c.Name),
            'A text Name, though the schema calls it optional.'
        );
        System.assertEquals(
            false,
            GridCreateService.neededOnCreate(Rowhouse_Test_Record__c.OwnerId),
            'The platform fills in the owner.'
        );
        System.assertEquals(false, GridCreateService.neededOnCreate(Rowhouse_Test_Record__c.Checkbox_Field__c));
        System.assertEquals(0, GridCreateService.recordTypesFor(Rowhouse_Test_Record__c.SObjectType));
    }
}
