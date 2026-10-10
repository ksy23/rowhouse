/**
 * DEVELOPMENT ONLY. Never packaged.
 * Filters and the record page: how a condition is checked and
 * normalised, the SOQL it becomes, which records it leaves, and what is
 * refused. Conditions are built in memory, so each case states its own;
 * the queries run as GridTestUsers.fullUser(), in user mode.
 */
@IsTest
private class GridFiltersTest {
    private static final Schema.SObjectType TEST_RECORD = Rowhouse_Test_Record__c.SObjectType;

    @TestSetup
    static void setup() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = new Account(Name = 'Acme Filters');
            insert acme;
            Datetime todayNoon = Datetime.newInstance(Date.today(), Time.newInstance(12, 0, 0, 0));
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(
                    Name = 'F1',
                    Number_Field__c = 5,
                    Picklist_Field__c = 'Alpha',
                    Text_Field__c = 'red apple',
                    Multi_Picklist__c = 'Red;Green',
                    Checkbox_Field__c = true,
                    DateTime_Field__c = todayNoon,
                    Lookup_Field__c = acme.Id
                ),
                new Rowhouse_Test_Record__c(
                    Name = 'F2',
                    Number_Field__c = 15,
                    Picklist_Field__c = 'Beta',
                    Text_Field__c = 'green pear',
                    Multi_Picklist__c = 'Blue',
                    Checkbox_Field__c = false,
                    DateTime_Field__c = todayNoon.addDays(-3)
                ),
                new Rowhouse_Test_Record__c(
                    Name = 'F3',
                    Number_Field__c = 25,
                    Picklist_Field__c = 'Gamma',
                    Text_Field__c = '50%_off'
                ),
                new Rowhouse_Test_Record__c(Name = 'F4')
            };
        }
    }

    private static GridFilters.Condition condition(String field, String operator, String value, String valueTo) {
        return GridFilters.condition(TEST_RECORD, field, operator, value, valueTo);
    }

    /** The names of the records that meet every condition, sorted. */
    private static List<String> namesMeeting(List<GridFilters.Condition> conditions) {
        GridRequest request = new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, null, 200);
        request.narrowedBy(conditions);
        request.orderBy('Name', 'asc');
        List<String> out = new List<String>();
        for (SObject r : GridDataService.fetchPage(request).rows) {
            out.add((String) r.get('Name'));
        }
        return out;
    }

    private static List<String> namesMeeting(GridFilters.Condition c) {
        return namesMeeting(new List<GridFilters.Condition>{ c });
    }

    @IsTest
    static void eachOperatorLeavesTheRightRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                new List<String>{ 'F2', 'F3' },
                namesMeeting(condition('Number_Field__c', 'greater_than', '10', null))
            );
            System.assertEquals(
                new List<String>{ 'F1', 'F2' },
                namesMeeting(condition('Number_Field__c', 'between', '5', '15')),
                'Between includes both ends.'
            );
            System.assertEquals(
                new List<String>{ 'F4' },
                namesMeeting(condition('Number_Field__c', 'is_blank', null, null))
            );
            // A picklist by its label, in any case, compares by API value.
            System.assertEquals(
                new List<String>{ 'F2' },
                namesMeeting(condition('Picklist_Field__c', 'equals', 'beta', null))
            );
            // Does not equal and does not contain include blanks, as a list view filter does.
            System.assertEquals(
                new List<String>{ 'F1', 'F3', 'F4' },
                namesMeeting(condition('Picklist_Field__c', 'not_equals', 'Beta', null))
            );
            System.assertEquals(
                new List<String>{ 'F2', 'F3', 'F4' },
                namesMeeting(condition('Text_Field__c', 'not_contains', 'apple', null))
            );
            // Part of a picklist value, as for text: Alpha has "ph"; blanks do not contain it.
            System.assertEquals(
                new List<String>{ 'F2', 'F3', 'F4' },
                namesMeeting(condition('Picklist_Field__c', 'not_contains', 'ph', null))
            );
            System.assertEquals(
                new List<String>{ 'F3' },
                namesMeeting(condition('Picklist_Field__c', 'contains', 'MM', null))
            );
            System.assertEquals(
                new List<String>{ 'F2' },
                namesMeeting(condition('Text_Field__c', 'starts_with', 'GREEN', null))
            );
            // A wildcard in the value is a character, not a wildcard (TC-021).
            System.assertEquals(
                new List<String>{ 'F3' },
                namesMeeting(condition('Text_Field__c', 'contains', '%_', null))
            );
            System.assertEquals(
                new List<String>{ 'F1' },
                namesMeeting(condition('Multi_Picklist__c', 'contains', 'green', null)),
                'A multi-select contains a value: INCLUDES.'
            );
            System.assertEquals(
                new List<String>{ 'F2', 'F3', 'F4' },
                namesMeeting(condition('Multi_Picklist__c', 'not_contains', 'Red', null))
            );
            System.assertEquals(
                new List<String>{ 'F1' },
                namesMeeting(condition('Checkbox_Field__c', 'equals', 'true', null))
            );
        }
    }

    @IsTest
    static void aDateTimeIsFilteredByTheUsersCalendarDay() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                new List<String>{ 'F1' },
                namesMeeting(condition('DateTime_Field__c', 'equals', 'TODAY', null))
            );
            System.assertEquals(
                new List<String>{ 'F2' },
                namesMeeting(condition('DateTime_Field__c', 'less_than', 'TODAY-1', null))
            );
            System.assertEquals(
                new List<String>{ 'F1', 'F2' },
                namesMeeting(condition('DateTime_Field__c', 'between', 'TODAY-3', 'TODAY')),
                'Both days included.'
            );
            System.assertEquals(
                new List<String>{ 'F2', 'F3', 'F4' },
                namesMeeting(condition('DateTime_Field__c', 'not_equals', 'TODAY', null)),
                'Does not equal includes blanks.'
            );
        }
    }

    @IsTest
    static void everyConditionMustHold() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                new List<String>{ 'F2' },
                namesMeeting(
                    new List<GridFilters.Condition>{
                        condition('Number_Field__c', 'greater_than', '10', null),
                        condition('Text_Field__c', 'contains', 'pear', null)
                    }
                )
            );
        }
    }

    @IsTest
    static void aConditionSaysWhatItMeans() {
        System.assertEquals(
            'Number Field is greater than 10',
            condition('Number_Field__c', 'greater_than', '10', null).text
        );
        System.assertEquals(
            'Picklist Field is not Beta',
            condition('Picklist_Field__c', 'not_equals', 'beta', null).text
        );
        System.assertEquals(
            'Checkbox Field is not checked',
            condition('Checkbox_Field__c', 'equals', 'false', null).text
        );
        System.assertEquals(
            'Date Field is at least 30 days ago',
            condition('Date_Field__c', 'greater_or_equal', 'today - 30', null).text
        );
        System.assertEquals('Number Field is between 1 and 9', condition('Number_Field__c', 'between', '1', '9').text);
        System.assertEquals(
            'Owner is me',
            condition('OwnerId', 'equals', '$User', null).text,
            'A lookup heading drops " ID".'
        );
        // TODAY and $User mean something only for a date and a lookup: in a text
        // filter they are just text, and must not stop the grid.
        System.assert(condition('Text_Field__c', 'starts_with', 'TODAYS', null).text.endsWith('TODAYS'));
        System.assert(condition('Text_Field__c', 'equals', 'TODAY1', null).text.endsWith('TODAY1'));
        System.assert(condition('Text_Field__c', 'equals', '$User', null).text.endsWith('$User'));
    }

    @IsTest
    static void anAdminFilterThatCannotWorkStopsTheGridAndSaysWhich() {
        List<Grid_Filter__mdt> records = new List<Grid_Filter__mdt>{
            new Grid_Filter__mdt(
                DeveloperName = 'Bad_Value',
                Field_API_Name__c = 'Number_Field__c',
                Operator__c = 'greater_than',
                Value__c = 'lots'
            )
        };
        try {
            GridFilters.fromRecords(records, TEST_RECORD);
            System.assert(false, 'A filter that cannot work must not be skipped: it would widen the grid.');
        } catch (GridException e) {
            System.assert(e.getMessage().startsWith('Grid Filter Bad_Value: '), e.getMessage());
            System.assert(e.getMessage().contains('is not a number'), e.getMessage());
        }
        List<String> refusals = new List<String>();
        for (
            List<String> bad : new List<List<String>>{
                new List<String>{ 'Long_Text__c', 'equals', 'x', null },
                new List<String>{ 'Text_Field__c', 'greater_than', 'x', null },
                new List<String>{ 'Number_Field__c', 'between', '1', null },
                new List<String>{ 'No_Such__c', 'equals', 'x', null }
            }
        ) {
            try {
                condition(bad[0], bad[1], bad[2], bad[3]);
                refusals.add('accepted');
            } catch (GridException e) {
                refusals.add(e.getMessage());
            }
        }
        System.assert(refusals[0].contains('cannot be filtered on'), refusals[0]);
        System.assert(refusals[1].contains('does not apply'), refusals[1]);
        System.assert(refusals[2].contains('Value To'), refusals[2]);
        System.assert(refusals[3].contains('Unknown field'), refusals[3]);
    }

    @IsTest
    static void anAdminFilterTurnedOffIsLeftOutAndTheRestAreInOrder() {
        List<GridFilters.Condition> got = GridFilters.fromRecords(
            new List<Grid_Filter__mdt>{
                new Grid_Filter__mdt(
                    DeveloperName = 'Second',
                    Field_API_Name__c = 'Number_Field__c',
                    Operator__c = 'is_not_blank',
                    Sort_Order__c = 20
                ),
                new Grid_Filter__mdt(
                    DeveloperName = 'Off',
                    Field_API_Name__c = 'No_Such__c',
                    Operator__c = 'equals',
                    Inactive__c = true
                ),
                new Grid_Filter__mdt(
                    DeveloperName = 'First',
                    Field_API_Name__c = 'Text_Field__c',
                    Operator__c = 'is_blank',
                    Sort_Order__c = 10
                )
            },
            TEST_RECORD
        );
        System.assertEquals(2, got.size(), 'An inactive filter is not there, even a broken one.');
        System.assertEquals('First', got[0].name);
        System.assertEquals('Second', got[1].name);
    }

    @IsTest
    static void aUserFiltersOnlyByTheGridsOwnFilterableColumns() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Test_Records');
            List<GridFilters.Condition> ok = GridFilters.userConditions(
                def,
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'field' => 'Number_Field__c',
                        'operator' => 'between',
                        'value' => '1',
                        'valueTo' => 9
                    }
                }
            );
            System.assertEquals('9', ok[0].valueTo, 'Values arrive as anything; they are read as text.');

            List<String> refusals = new List<String>();
            for (
                Map<String, Object> bad : new List<Map<String, Object>>{
                    new Map<String, Object>{ 'field' => 'Read_Only_Text__c', 'operator' => 'equals', 'value' => 'x' },
                    new Map<String, Object>{ 'field' => 'Id', 'operator' => 'equals', 'value' => 'x' },
                    new Map<String, Object>{ 'operator' => 'equals', 'value' => 'x' }
                }
            ) {
                Boolean isColumn = false;
                for (GridConfig.Column c : def.columns) {
                    isColumn = isColumn || c.field == bad.get('field');
                }
                try {
                    GridFilters.userConditions(def, new List<Map<String, Object>>{ bad });
                    refusals.add(isColumn ? 'column' : 'accepted');
                } catch (GridException e) {
                    refusals.add(e.getMessage());
                }
            }
            for (String r : refusals) {
                System.assert(
                    r == 'column' || r.startsWith('Cannot filter by'),
                    'HR-6: only the grid\'s own columns: ' + r
                );
            }
            List<Map<String, Object>> tooMany = new List<Map<String, Object>>();
            for (Integer i = 0; i <= GridFilters.MAX_USER_FILTERS; i++) {
                tooMany.add(new Map<String, Object>{ 'field' => 'Number_Field__c', 'operator' => 'is_not_blank' });
            }
            try {
                GridFilters.userConditions(def, tooMany);
                System.assert(false, 'More than the most filters is refused.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains(String.valueOf(GridFilters.MAX_USER_FILTERS)), e.getMessage());
            }
        }
    }

    @IsTest
    static void aUserFilterNarrowsTheRowsAndTheCounts() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> filters = new List<Map<String, Object>>{
                new Map<String, Object>{ 'field' => 'Number_Field__c', 'operator' => 'greater_than', 'value' => '10' }
            };
            Map<String, Object> page = GridController.fetchRows(
                'Test_Records',
                null,
                'Name',
                'asc',
                null,
                null,
                null,
                null,
                null,
                null,
                filters,
                null
            );
            List<String> names = new List<String>();
            for (Map<String, Object> r : (List<Map<String, Object>>) page.get('rows')) {
                Object n = r.get('Number_Field__c');
                System.assert(
                    n != null && Decimal.valueOf(String.valueOf(n)) > 10,
                    'Only rows that meet the filter: ' + r
                );
                names.add((String) r.get('Name'));
            }
            System.assert(names.contains('F2') && names.contains('F3') && !names.contains('F1'), String.valueOf(names));
        }
    }

    @IsTest
    static void aLookupIsFilteredByTheNameTheUserSees() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Test_Records');
            Boolean hasLookup = false;
            for (GridConfig.Column c : def.columns) {
                hasLookup = hasLookup || (c.field == 'Lookup_Field__c' && c.filterable == true);
            }
            if (!hasLookup) {
                return; // the fixture grid has no lookup column to filter by
            }
            List<GridFilters.Condition> c = GridFilters.userConditions(
                def,
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'field' => 'Lookup_Field__c', 'operator' => 'contains', 'value' => 'acme' }
                }
            );
            System.assertEquals(new List<String>{ 'F1' }, namesMeeting(c));
        }
    }

    @IsTest
    static void theRecordPageNarrowsToThatRecordsRows() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = [SELECT Id FROM Account WHERE Name = 'Acme Filters' LIMIT 1];
            GridConfig.Definition def = GridConfig.forUser('Test_Records');
            System.assertEquals(null, GridFilters.recordCondition(def, acme.Id), 'No Record Page Field: as before.');

            def.recordPageField = 'Lookup_Field__c';
            System.assertEquals(null, GridFilters.recordCondition(def, null), 'No record (an App page): as before.');
            GridFilters.Condition c = GridFilters.recordCondition(def, acme.Id);
            System.assertEquals('Lookup_Field__c', c.field);
            System.assertEquals(new List<String>{ 'F1' }, namesMeeting(c));
            System.assertEquals(acme.Id, GridFilters.recordScope(def, acme.Id).parentId, 'Import fills the field in.');

            Id wrongKind = [SELECT Id FROM Rowhouse_Test_Record__c LIMIT 1].Id;
            try {
                GridFilters.recordCondition(def, wrongKind);
                System.assert(false, 'A page of another object must not show unrelated records.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('related to Account records'), e.getMessage());
            }
            def.recordPageField = 'Text_Field__c';
            try {
                GridFilters.recordCondition(def, acme.Id);
                System.assert(false, 'A Record Page Field must be a lookup.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('is not a lookup'), e.getMessage());
            }
            System.assertEquals(
                new List<GridFilters.Condition>(def.filters).size(),
                GridFilters.forRequest(def, null, acme.Id, true).size(),
                'A child table ignores the page.'
            );
        }
    }

    @IsTest
    static void filtersAreInTheGroupCountsToo() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> filters = new List<Map<String, Object>>{
                new Map<String, Object>{ 'field' => 'Number_Field__c', 'operator' => 'greater_than', 'value' => '10' }
            };
            List<String> byPicklist = new List<String>{ 'Picklist_Field__c' };
            GridGroupService.Result unfiltered = GridGroupService.summarize(
                'Test_Records',
                null,
                byPicklist,
                null,
                null,
                null,
                null,
                null,
                null
            );
            GridGroupService.Result filtered = GridGroupService.summarize(
                'Test_Records',
                null,
                byPicklist,
                null,
                null,
                null,
                null,
                filters,
                null
            );
            System.assertEquals(4, unfiltered.groups.size(), 'Alpha, Beta, Gamma and blank.');
            System.assertEquals(2, filtered.groups.size(), 'Only the groups of the filtered records: Beta and Gamma.');
            Integer counted = 0;
            for (Map<String, Object> g : filtered.groups) {
                counted += (Integer) g.get('n');
            }
            System.assertEquals(2, counted, 'A filtered grid counts only the filtered records.');
        }
    }
}
