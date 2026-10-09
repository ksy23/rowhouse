/**
 * DEVELOPMENT ONLY. Never packaged.
 * Nesting: the tabs a grid lists under its rows, and a child grid's
 * parent filter. The fixture: Test_Records opens Test_Children (by Parent__c);
 * Nest_Accounts opens Test_Records (by Lookup_Field__c) and Nest_Contacts (by
 * AccountId); Group_Test lists three tabs that cannot work, on purpose.
 */
@IsTest
private class GridNestingTest {
    private static Rowhouse_Test_Record__c parentA;
    private static Rowhouse_Test_Record__c parentB;

    /** A with three children (10, 20, 30), B with one (5). */
    private static void seed() {
        parentA = new Rowhouse_Test_Record__c(Name = 'Parent A');
        parentB = new Rowhouse_Test_Record__c(Name = 'Parent B');
        insert new List<Rowhouse_Test_Record__c>{ parentA, parentB };
        insert new List<Rowhouse_Test_Child__c>{
            new Rowhouse_Test_Child__c(Name = 'A one', Amount__c = 10, Parent__c = parentA.Id),
            new Rowhouse_Test_Child__c(Name = 'A two', Amount__c = 20, Parent__c = parentA.Id),
            new Rowhouse_Test_Child__c(Name = 'A three', Amount__c = 30, Parent__c = parentA.Id),
            new Rowhouse_Test_Child__c(Name = 'B one', Amount__c = 5, Parent__c = parentB.Id)
        };
    }

    private static List<String> names(Map<String, Object> page) {
        List<String> out = new List<String>();
        for (Map<String, Object> row : (List<Map<String, Object>>) page.get('rows')) {
            out.add((String) row.get('Name'));
        }
        return out;
    }

    private static String refusal(String configName, String link, String parentId) {
        try {
            GridNesting.scopeFor(GridConfig.forUser(configName), link, parentId);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void listsTheTabsInOrderWithTheirLabels() {
        System.runAs(GridTestUsers.fullUser()) {
            List<GridConfig.Child> tabs = GridConfig.forUser('Nest_Accounts').children;
            System.assertEquals(2, tabs.size(), String.valueOf(tabs));
            System.assertEquals('Nest_Accounts_Records', tabs[0].name);
            System.assertEquals('Test Records', tabs[0].label, 'The Tab Label.');
            System.assertEquals('Test_Records', tabs[0].configName);
            System.assertEquals('Rowhouse_Test_Record__c', tabs[0].objectApiName);
            System.assertEquals('Lookup_Field__c', tabs[0].relationshipField);
            System.assertEquals('Nest_Accounts_Contacts', tabs[1].name);
            System.assertEquals('Contacts', tabs[1].label, 'No Tab Label: the child configuration\'s label.');
            System.assertEquals('AccountId', tabs[1].relationshipField);

            List<GridConfig.Child> children = GridConfig.forUser('Test_Records').children;
            System.assertEquals(1, children.size());
            System.assertEquals('Children', children[0].label);
            System.assertEquals('Parent__c', children[0].relationshipField);
            System.assertEquals(
                0,
                GridConfig.forUser('Test_Children').children.size(),
                'A grid with no tabs lists none.'
            );
        }
    }

    @IsTest
    static void skipsATabThatCannotWorkWithAWarning() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.load('Group_Test');
            System.assertEquals(0, def.children.size(), 'None of Group_Test\'s tabs can work.');
            String all = String.join(def.warnings, '\n');
            System.assert(
                all.contains(
                    'Grid Child Table Group_Test_Bad_Field was skipped: ' +
                    'Rowhouse_Test_Child__c.Amount__c does not point to Rowhouse_Test_Record__c records.'
                ),
                all
            );
            System.assert(
                all.contains(
                    'Grid Child Table Group_Test_Wrong_Parent was skipped: ' +
                    'Contact.AccountId does not point to Rowhouse_Test_Record__c records.'
                ),
                all
            );
            System.assert(
                all.contains('Grid Child Table Group_Test_No_Child was skipped: it has no Child Configuration.'),
                all
            );
        }
    }

    @IsTest
    static void aTabTheUserCannotReadIsNotOffered() {
        // Rowhouse_Test_Limited reads Test Records but not their children.
        System.runAs(GridTestUsers.limitedUser()) {
            System.assertEquals(0, GridConfig.forUser('Test_Records').children.size());
        }
    }

    @IsTest
    static void aChildGridReadsOnlyItsParentsRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            Map<String, Object> a = GridController.fetchRows(
                'Test_Children',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                'Test_Records_Children',
                parentA.Id,
                null,
                null
            );
            Map<String, Object> b = GridController.fetchRows(
                'Test_Children',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                'Test_Records_Children',
                parentB.Id,
                null,
                null
            );
            Map<String, Object> searched = GridController.fetchRows(
                'Test_Children',
                'one',
                null,
                null,
                null,
                null,
                null,
                null,
                'Test_Records_Children',
                parentA.Id,
                null,
                null
            );
            Test.stopTest();
            System.assertEquals(
                new List<String>{ 'A one', 'A three', 'A two' },
                names(a),
                'Sorted by Name, A\'s only.'
            );
            System.assertEquals(3, a.get('totalRows'));
            System.assertEquals(new List<String>{ 'B one' }, names(b));
            System.assertEquals(new List<String>{ 'A one' }, names(searched), 'Search stays within the parent.');
        }
    }

    @IsTest
    static void aChildGridsTotalsCoverOnlyItsParentsRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result result = GridController.summarizeGroups(
                'Test_Children',
                null,
                new List<String>(),
                null,
                null,
                'Test_Records_Children',
                parentA.Id,
                null,
                null
            );
            Test.stopTest();
            System.assertEquals(1, result.groups.size(), String.valueOf(result.groups));
            Map<String, Object> total = result.groups[0];
            System.assertEquals(3, total.get('n'));
            Map<String, Object> values = (Map<String, Object>) total.get('v');
            Map<String, Object> amount = (Map<String, Object>) values.get('Amount__c');
            System.assertEquals(60, Decimal.valueOf((String) amount.get('s')), 'A\'s 10 + 20 + 30, not B\'s 5.');
        }
    }

    @IsTest
    static void importIntoAChildGridCreatesRecordsUnderTheParent() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridImportService.Result result = GridController.importRows(
                'Test_Children',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Name' => 'Imported child', 'Amount__c' => '7' }
                },
                'Test_Records_Children',
                parentB.Id,
                null,
                null
            );
            Test.stopTest();
            System.assert(result.rows[0].success && result.rows[0].created, String.valueOf(result.rows[0]));
            Rowhouse_Test_Child__c made = [
                SELECT Parent__c, Amount__c
                FROM Rowhouse_Test_Child__c
                WHERE Id = :result.rows[0].recordId
            ];
            System.assertEquals(parentB.Id, made.Parent__c, 'The parent is filled in from the tab.');
            System.assertEquals(7, made.Amount__c);
        }
    }

    @IsTest
    static void refusesAParentThatDoesNotFit() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            System.assertEquals(
                null,
                GridNesting.scopeFor(GridConfig.forUser('Test_Children'), null, null),
                'No tab and no parent: a top-level grid.'
            );
            System.assertEquals('No Grid Child Table named "Nope".', refusal('Test_Children', 'Nope', parentA.Id));
            System.assertEquals(
                'Grid Child Table Nest_Accounts_Contacts does not show the grid Test_Children.',
                refusal('Test_Children', 'Nest_Accounts_Contacts', parentA.Id)
            );
            System.assertEquals(
                'Record ' + UserInfo.getUserId() + ' is not a Rowhouse_Test_Record__c.',
                refusal('Test_Children', 'Test_Records_Children', UserInfo.getUserId())
            );
            System.assertEquals(
                'Not a record Id: not-an-id',
                refusal('Test_Children', 'Test_Records_Children', 'not-an-id')
            );
            System.assertEquals(
                'A child table needs both its tab and its parent record.',
                refusal('Test_Children', 'Test_Records_Children', null)
            );
            System.assertEquals(
                'A child table needs both its tab and its parent record.',
                refusal('Test_Children', null, parentA.Id)
            );
            // Through the controller, the message reaches the browser as it is.
            try {
                GridController.fetchRows(
                    'Test_Children',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    'Nope',
                    parentA.Id,
                    null,
                    null
                );
                System.assert(false, 'Expected a refusal.');
            } catch (AuraHandledException e) {
                System.assertEquals('No Grid Child Table named "Nope".', e.getMessage());
            }
        }
    }

    @IsTest
    static void theParentFilterIsBoundNotConcatenated() {
        // HR-6 and TC-021's rule for the parent: the Id is a bind variable, and
        // the field comes from describe. A request cannot name another field.
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridNesting.Scope s = GridNesting.scopeFor(
                GridConfig.forUser('Test_Children'),
                'Test_Records_Children',
                parentA.Id
            );
            System.assertEquals('Parent__c', GridDescribe.localName(s.field));
            System.assertEquals(parentA.Id, s.parentId);
            Map<String, Object> binds = new Map<String, Object>();
            String condition = GridDataService.parentCondition(s.fieldApiName, s.parentId, binds);
            System.assertEquals(s.fieldApiName + ' = :parentId', condition);
            System.assertEquals(parentA.Id, binds.get('parentId'));
            System.assertEquals(null, GridDataService.parentCondition(null, null, binds), 'No parent, no condition.');
        }
    }

    // ---------------------------------------------------------- child totals and heights

    /** A Grid Column in memory, from its fields: Custom Metadata fields cannot be assigned in Apex. */
    private static Grid_Column__mdt column(String name, Map<String, Object> fields) {
        Map<String, Object> m = new Map<String, Object>{ 'DeveloperName' => name, 'MasterLabel' => name };
        for (String field : fields.keySet()) {
            m.put(GridTestUsers.qualified(field), fields.get(field));
        }
        return (Grid_Column__mdt) JSON.deserialize(JSON.serialize(m), Grid_Column__mdt.class);
    }

    private static GridConfig.Column totalColumn(String name, String kind, String field) {
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance('Test_Records');
        return GridConfig.childTotalColumn(
            column(
                name,
                new Map<String, Object>{
                    'Child_Table__c' => 'Test_Records_Children',
                    'Child_Total__c' => kind,
                    'Child_Field__c' => field
                }
            ),
            Rowhouse_Test_Record__c.SObjectType,
            GridNesting.linksOf(cfg)
        );
    }

    private static String totalRefusal(String table, String kind, String field) {
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance('Test_Records');
        try {
            GridNesting.childTotalOf(table, kind, field, Rowhouse_Test_Record__c.SObjectType, GridNesting.linksOf(cfg));
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void aChildTotalColumnTotalsEachRowsChildRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Rowhouse_Test_Record__c none = new Rowhouse_Test_Record__c(Name = 'No children');
            insert none;
            GridConfig.Definition def = GridConfig.forUser('Test_Records');
            GridConfig.Column sum = totalColumn('Sum_Amount', 'sum', 'Amount__c');
            GridConfig.Column count = totalColumn('Count_Children', 'count', null);
            GridConfig.Column top = totalColumn('Top_Amount', 'max', 'Amount__c');
            def.columns.addAll(new List<GridConfig.Column>{ sum, count, top });
            System.assertEquals('_ct_Sum_Amount', sum.field);
            System.assertEquals('Children: Sum of Amount', sum.label, 'Named after the tab, the total and the field.');
            System.assertEquals('Children', count.label, 'A count of records is named after the tab.');
            System.assertEquals('number', count.type);
            System.assert(sum.isChildTotal && !sum.editable && !sum.sortable && !sum.groupable && !sum.filterable);
            System.assert(!def.fieldNames().contains(sum.field), 'A total is not a field to read.');

            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => parentA.Id },
                new Map<String, Object>{ 'Id' => parentB.Id },
                new Map<String, Object>{ 'Id' => none.Id }
            };
            Test.startTest();
            GridNesting.addChildTotals(rows, def);
            Test.stopTest();
            System.assertEquals(60, Decimal.valueOf(String.valueOf(rows[0].get(sum.field))));
            System.assertEquals(3, Integer.valueOf(String.valueOf(rows[0].get(count.field))));
            System.assertEquals(30, Decimal.valueOf(String.valueOf(rows[0].get(top.field))));
            System.assertEquals(5, Decimal.valueOf(String.valueOf(rows[1].get(sum.field))));
            System.assertEquals(null, rows[2].get(sum.field), 'A sum of nothing is blank.');
            System.assertEquals(
                0,
                Integer.valueOf(String.valueOf(rows[2].get(count.field))),
                'A count of nothing is 0.'
            );
        }
    }

    @IsTest
    static void aChildTotalThatCannotWorkSaysWhy() {
        System.assertEquals('this grid has no child table named "Nope".', totalRefusal('Nope', 'count', null));
        System.assertEquals(
            'a sum needs the Child Field to work out.',
            totalRefusal('Test_Records_Children', 'sum', null)
        );
        System.assertEquals(
            'unknown Child Total "median".',
            totalRefusal('Test_Records_Children', 'median', 'Amount__c')
        );
        System.assertEquals(
            'Rowhouse_Test_Child__c has no field "Nope__c".',
            totalRefusal('Test_Records_Children', 'sum', 'Nope__c')
        );
        System.assert(
            totalRefusal('Test_Records_Children', 'sum', 'Name').startsWith('a sum does not apply to'),
            totalRefusal('Test_Records_Children', 'sum', 'Name')
        );
        System.assertEquals(
            null,
            totalRefusal('Test_Records_Children', 'count', 'Name'),
            'A count of a field counts its values.'
        );
    }

    @IsTest
    static void aGridShowsItsChildTotalColumnsWithItsRows() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = new Account(Name = 'Acme Totals');
            insert acme;
            insert new List<Contact>{
                new Contact(LastName = 'One', AccountId = acme.Id),
                new Contact(LastName = 'Two', AccountId = acme.Id)
            };
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(Name = 'R1', Lookup_Field__c = acme.Id, Currency_Field__c = 100),
                new Rowhouse_Test_Record__c(Name = 'R2', Lookup_Field__c = acme.Id, Currency_Field__c = 25.5)
            };
            GridConfig.Definition def = GridConfig.forUser('Nest_Accounts');
            Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
            for (GridConfig.Column c : def.columns) {
                byField.put(c.field, c);
            }
            System.assertEquals('Contacts', byField.get('_ct_Nest_Accounts_Contact_Count').label, 'The Column Label.');
            System.assertEquals(
                'currency',
                byField.get('_ct_Nest_Accounts_Records_Amount').type,
                'A sum of currency is currency.'
            );
            Map<String, Object> page = GridController.fetchRows(
                'Nest_Accounts',
                'Acme Totals',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            Map<String, Object> row = ((List<Map<String, Object>>) page.get('rows'))[0];
            System.assertEquals(
                2,
                Integer.valueOf(String.valueOf(row.get('_ct_Nest_Accounts_Contact_Count'))),
                String.valueOf(row)
            );
            System.assertEquals(
                125.5,
                Decimal.valueOf(String.valueOf(row.get('_ct_Nest_Accounts_Records_Amount'))),
                String.valueOf(row)
            );
        }
    }

    @IsTest
    static void aTabCarriesTheHeightTheAdminGaveIt() {
        System.runAs(GridTestUsers.fullUser()) {
            List<GridConfig.Child> tabs = GridConfig.forUser('Nest_Accounts').children;
            System.assertEquals(null, tabs[0].height, 'No Height: the standard.');
            System.assertEquals(250, tabs[1].height, 'Nest_Accounts_Contacts: 250 px.');
        }
    }
}
