/**
 * DEVELOPMENT ONLY. Never packaged.
 * Columns that show a field of a parent record, named by a path through
 * lookups (Lookup_Field__r.Industry: the record's Related Account's
 * Industry). The Path_Test configuration (test-data/config) has four: the
 * account's Name, Industry (users can group by it) and Annual Revenue
 * (summed), all editable, and its owner's Email, which is not.
 *
 * What is proved here: a path resolves the way SOQL names it and is refused
 * when it cannot work; the rows carry its value and the Id of the record that
 * holds it; the grid sorts, searches, filters and groups by it; and an edit
 * is written once to the parent record, however many rows share it, with
 * every problem reported on the row cell the user edited.
 */
@IsTest
private class GridPathsTest {
    private static final Schema.SObjectType TEST_RECORD = Rowhouse_Test_Record__c.SObjectType;
    private static final String INDUSTRY = 'Lookup_Field__r.Industry';

    private class Data {
        Account harbor;
        Account mill;
        Rowhouse_Test_Record__c first;
        Rowhouse_Test_Record__c second;
        Rowhouse_Test_Record__c third;
        Rowhouse_Test_Record__c alone;
    }

    /** Two accounts; two records on Harbor Bank, one on Mill River Energy, one with no account. */
    private static Data seed() {
        Data d = new Data();
        d.harbor = new Account(Name = 'Harbor Bank', Industry = 'Banking', AnnualRevenue = 100);
        d.mill = new Account(Name = 'Mill River Energy', Industry = 'Energy', AnnualRevenue = 250);
        insert new List<Account>{ d.harbor, d.mill };
        d.first = new Rowhouse_Test_Record__c(Name = 'Path A', Lookup_Field__c = d.harbor.Id);
        d.second = new Rowhouse_Test_Record__c(Name = 'Path B', Lookup_Field__c = d.harbor.Id);
        d.third = new Rowhouse_Test_Record__c(Name = 'Path C', Lookup_Field__c = d.mill.Id);
        d.alone = new Rowhouse_Test_Record__c(Name = 'Path D');
        insert new List<Rowhouse_Test_Record__c>{ d.first, d.second, d.third, d.alone };
        return d;
    }

    // ---------------------------------------------------------------- resolving

    @IsTest
    static void aPathResolvesAsSoqlNamesIt() {
        GridPaths.FieldPath own = GridPaths.resolve(TEST_RECORD, 'Name');
        System.assertEquals(false, own.isPath());
        System.assertEquals('Id', own.holderIdSoql);
        System.assertEquals(TEST_RECORD, own.holder);

        GridPaths.FieldPath one = GridPaths.resolve(TEST_RECORD, INDUSTRY);
        System.assert(one.isPath());
        System.assertEquals(INDUSTRY, one.local);
        System.assertEquals(Account.SObjectType, one.holder);
        System.assertEquals(Account.Industry, one.field);
        System.assertEquals('Lookup_Field__c', one.holderIdLocal);
        System.assertEquals('Related Account: Industry', GridPaths.defaultLabel(one));

        GridPaths.FieldPath two = GridPaths.resolve(TEST_RECORD, 'lookup_field__r.owner.email');
        System.assertEquals(User.SObjectType, two.holder);
        System.assertEquals('Lookup_Field__r.Owner.Email', two.local, 'Spelled as describe spells it.');
        System.assertEquals('Lookup_Field__r.OwnerId', two.holderIdLocal);
        System.assertEquals('Related Account: Owner: Email', GridPaths.defaultLabel(two));
    }

    @IsTest
    static void aPathThatCannotWorkIsRefusedInAnAdminsTerms() {
        assertRefused(TEST_RECORD, 'Nothing__r.Name', 'has no lookup called Nothing__r');
        assertRefused(TEST_RECORD, 'Lookup_Field__r.Nothing__c', 'Nothing__c');
        assertRefused(Case.SObjectType, 'Owner.Email', 'can point to more than one kind of record');
        assertRefused(Contact.SObjectType, 'Account.Parent.Parent.Parent.Parent.Parent.Name', 'at most 5');
        // Five lookups is the most, and allowed.
        GridPaths.FieldPath five = GridPaths.resolve(Contact.SObjectType, 'Account.Parent.Parent.Parent.Parent.Name');
        System.assertEquals(5, five.hops.size());
    }

    private static void assertRefused(Schema.SObjectType objectType, String path, String expected) {
        try {
            GridPaths.resolve(objectType, path);
            System.assert(false, path + ' should have been refused.');
        } catch (GridException e) {
            System.assert(e.getMessage().contains(expected), path + ': ' + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- configuration

    @IsTest
    static void pathColumnsAreReadAndEditedThroughTheirParent() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Path_Test');
            GridConfig.Column industry = column(def, INDUSTRY);
            System.assert(industry.isPath);
            System.assertEquals(true, industry.editable, 'A user who may edit accounts edits it.');
            System.assertEquals(false, industry.creatable, 'A new row sets its own fields only.');
            System.assertEquals(true, industry.groupable);
            System.assertEquals('sum', column(def, 'Lookup_Field__r.AnnualRevenue').subtotal);
            GridConfig.Column name = column(def, 'Lookup_Field__r.Name');
            System.assertEquals(false, name.isName, 'The account name does not link to the row.');
            System.assertEquals(false, column(def, 'Lookup_Field__r.Owner.Email').editable);
        }
    }

    @IsTest
    static void aBadPathColumnIsSkippedWithAWarningButABadFieldStillStopsTheGrid() {
        GridConfig.Definition def = GridConfig.build(
            new Grid_Configuration__mdt(
                DeveloperName = 'Paths',
                MasterLabel = 'Paths',
                Object_API_Name__c = 'Rowhouse_Test_Record__c',
                Allow_Inline_Edit__c = true
            ),
            new List<Grid_Column__mdt>{
                new Grid_Column__mdt(DeveloperName = 'Paths_Name', Field_API_Name__c = 'Name', Sort_Order__c = 10),
                new Grid_Column__mdt(
                    DeveloperName = 'Paths_Bad',
                    Field_API_Name__c = 'Lookup_Field__r.Nothing__c',
                    Sort_Order__c = 20
                )
            },
            new List<Grid_Format_Rule__mdt>(),
            new List<Grid_Child__mdt>(),
            new List<Grid_Action__mdt>()
        );
        System.assertEquals(1, def.columns.size());
        Boolean warned = false;
        for (String w : def.warnings) {
            warned = warned || w.startsWith('Grid Column Paths_Bad was skipped: ');
        }
        System.assert(warned, String.valueOf(def.warnings));
    }

    private static GridConfig.Column column(GridConfig.Definition def, String field) {
        for (GridConfig.Column c : def.columns) {
            if (c.field == field) {
                return c;
            }
        }
        System.assert(false, 'No column ' + field);
        return null;
    }

    // ---------------------------------------------------------------- reading

    @IsTest
    static void rowsCarryTheParentsValueAndWhichRecordHoldsIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            Map<Id, Map<String, Object>> rows = byId(fetch(null, INDUSTRY, 'asc', null));
            Map<String, Object> first = rows.get(d.first.Id);
            System.assertEquals('Banking', first.get(INDUSTRY));
            System.assertEquals('Harbor Bank', first.get('Lookup_Field__r.Name'));
            Map<String, Object> parents = (Map<String, Object>) first.get('_parents');
            System.assertEquals(String.valueOf(d.harbor.Id), parents.get(INDUSTRY));
            System.assertEquals(String.valueOf(UserInfo.getUserId()), parents.get('Lookup_Field__r.Owner.Email'));

            Map<String, Object> alone = rows.get(d.alone.Id);
            System.assertEquals(null, alone.get(INDUSTRY));
            System.assertEquals(null, alone.get('_parents'), 'No account: nothing to edit through.');
        }
    }

    @IsTest
    static void theGridSortsSearchesFiltersAndGroupsByAParentsField() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            List<Map<String, Object>> sorted = fetch(null, INDUSTRY, 'desc', null);
            System.assertEquals(d.third.Id, sorted[0].get('Id'), 'Energy before Banking, descending.');

            Set<Object> found = idsOf(fetch('Mill River', null, null, null));
            System.assertEquals(new Set<Object>{ d.third.Id }, found, 'Search reaches the account name.');

            Set<Object> filtered = idsOf(
                fetch(
                    null,
                    null,
                    null,
                    new List<Map<String, Object>>{
                        new Map<String, Object>{ 'field' => INDUSTRY, 'operator' => 'equals', 'value' => 'Banking' }
                    }
                )
            );
            System.assertEquals(new Set<Object>{ d.first.Id, d.second.Id }, filtered);

            GridGroupService.Result groups = GridController.summarizeGroups(
                'Path_Test',
                null,
                new List<String>{ INDUSTRY },
                null,
                null,
                null,
                null,
                null,
                null
            );
            String summary = JSON.serialize(groups);
            System.assert(summary.contains('Banking') && summary.contains('Energy'), summary);
        }
    }

    private static List<Map<String, Object>> fetch(
        String term,
        String sortField,
        String direction,
        List<Map<String, Object>> filters
    ) {
        Map<String, Object> page = GridController.fetchRows(
            'Path_Test',
            term,
            sortField,
            direction,
            null,
            200,
            null,
            null,
            null,
            null,
            filters,
            null
        );
        return (List<Map<String, Object>>) page.get('rows');
    }

    private static Map<Id, Map<String, Object>> byId(List<Map<String, Object>> rows) {
        Map<Id, Map<String, Object>> out = new Map<Id, Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            out.put((Id) r.get('Id'), r);
        }
        return out;
    }

    private static Set<Object> idsOf(List<Map<String, Object>> rows) {
        Set<Object> out = new Set<Object>();
        for (Map<String, Object> r : rows) {
            out.add(r.get('Id'));
        }
        return out;
    }

    // ---------------------------------------------------------------- saving

    @IsTest
    static void anEditIsWrittenOnceToTheParentHoweverManyRowsShareIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            Test.startTest();
            Integer jobsBefore = Limits.getQueueableJobs();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => d.first.Id, INDUSTRY => 'Energy' },
                    new Map<String, Object>{ 'Id' => d.second.Id, INDUSTRY => 'Energy' }
                }
            );
            Integer jobs = Limits.getQueueableJobs() - jobsBefore;
            Test.stopTest();
            System.assertEquals(1, jobs, 'One chunk for the account; the rows themselves are not written.');
            System.assertEquals(0, ticket.errors.size(), String.valueOf(ticket.errors));
            System.assertEquals('Energy', [SELECT Industry FROM Account WHERE Id = :d.harbor.Id].Industry);
            GridSaveResult done = GridSaveService.status(ticket.saveId);
            System.assert(done.done);
            System.assertEquals(1, done.successCount, 'One account record saved.');
        }
    }

    @IsTest
    static void aRowsOwnFieldsAndItsParentsAreSavedTogether() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => d.third.Id,
                        'Name' => 'Path C renamed',
                        'Lookup_Field__r.AnnualRevenue' => '300.50'
                    }
                }
            );
            Test.stopTest();
            System.assertEquals(2, ticket.chunkCount);
            System.assertEquals(
                'Path C renamed',
                [SELECT Name FROM Rowhouse_Test_Record__c WHERE Id = :d.third.Id].Name
            );
            // Annual Revenue holds no decimals: rounded half up, as on the row's own fields (TC-023).
            System.assertEquals(301, [SELECT AnnualRevenue FROM Account WHERE Id = :d.mill.Id].AnnualRevenue);
        }
    }

    @IsTest
    static void twoRowsThatDisagreeAboutTheSameParentAreBothRefused() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => d.first.Id, INDUSTRY => 'Energy' },
                    new Map<String, Object>{ 'Id' => d.second.Id, INDUSTRY => 'energy' }
                }
            );
            System.assertEquals(0, ticket.chunkCount, 'Nothing queued.');
            System.assertEquals(2, ticket.errors.size(), String.valueOf(ticket.errors));
            for (GridSaveError e : ticket.errors) {
                System.assertEquals(INDUSTRY, e.fieldName);
                System.assertEquals(GridSaveService.CONFLICT_MESSAGE, e.message);
            }
            System.assertEquals('Banking', [SELECT Industry FROM Account WHERE Id = :d.harbor.Id].Industry);
        }
    }

    @IsTest
    static void aRowWithNoParentSaysSoOnItsCell() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{ new Map<String, Object>{ 'Id' => d.alone.Id, INDUSTRY => 'Energy' } }
            );
            System.assertEquals(1, ticket.errors.size());
            System.assertEquals(d.alone.Id, ticket.errors[0].recordId);
            System.assertEquals(INDUSTRY, ticket.errors[0].fieldName);
            System.assertEquals(
                'This record has no Related Account, so Industry can\'t be changed.',
                ticket.errors[0].message
            );
        }
    }

    @IsTest
    static void aColumnTheAdminDidNotMakeEditableIsRefused() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => d.first.Id,
                        'Lookup_Field__r.Owner.Email' => 'someone@example.invalid',
                        'Lookup_Field__r.Phone' => '555-0100'
                    }
                }
            );
            System.assertEquals(0, ticket.chunkCount);
            System.assert(ticket.rejectedFields.contains('Lookup_Field__r.Owner.Email'), ticket.rejectedFields);
            System.assert(ticket.rejectedFields.contains('Lookup_Field__r.Phone'), 'Not a column at all.');
        }
    }

    @IsTest
    static void aParentsSaveErrorIsReportedOnEveryRowCellThatEditedIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            String tooLong = 'x'.repeat(300); // Account Name holds 255
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => d.first.Id, 'Lookup_Field__r.Name' => tooLong },
                    new Map<String, Object>{ 'Id' => d.second.Id, 'Lookup_Field__r.Name' => tooLong }
                }
            );
            Test.stopTest();
            GridSaveResult done = GridSaveService.status(ticket.saveId);
            System.assert(done.done);
            System.assertEquals(0, done.successCount);
            Set<Id> rows = new Set<Id>();
            for (GridSaveError e : done.errors) {
                System.assertEquals('Lookup_Field__r.Name', e.fieldName, String.valueOf(done.errors));
                rows.add(e.recordId);
            }
            System.assertEquals(new Set<Id>{ d.first.Id, d.second.Id }, rows);
            System.assertEquals('Harbor Bank', [SELECT Name FROM Account WHERE Id = :d.harbor.Id].Name);
        }
    }

    @IsTest
    static void aBlankRequiredParentFieldIsRefused() {
        System.runAs(GridTestUsers.fullUser()) {
            Data d = seed();
            GridSaveResult ticket = GridSaveService.save(
                'Path_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => d.first.Id, 'Lookup_Field__r.Name' => ' ' }
                }
            );
            System.assertEquals(1, ticket.errors.size());
            System.assertEquals(GridSaveService.REQUIRED_MESSAGE, ticket.errors[0].message);
            System.assertEquals('Lookup_Field__r.Name', ticket.errors[0].fieldName);
        }
    }
}
