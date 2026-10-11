/**
 * DEVELOPMENT ONLY. Never packaged.
 * GridController — the @AuraEnabled surface the LWC calls. Runs as
 * GridTestUsers.fullUser(), as a subscriber's user would call it.
 */
@IsTest
private class GridControllerTest {
    @TestSetup
    static void setup() {
        // At API 67 plain DML runs in user mode, so the seed rows are written by
        // a user with field access, not by whoever runs the suite.
        System.runAs(GridTestUsers.fullUser()) {
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(
                    Name = 'TC-024 large number',
                    Number_Field__c = Decimal.valueOf('999999999999999999')
                ),
                new Rowhouse_Test_Record__c(
                    Name = 'TC-055 long text',
                    Text_Field__c = 'x',
                    Long_Text__c = 'Paragraph of filler text for the long text area boundary test. '
                        .repeat(600)
                        .left(32000)
                )
            };
        }
    }

    @IsTest
    static void configCarriesTheDefinitionAndTheDiagnosticsFlag() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> result = GridController.openGrid('Test_Records', null, null, null, null);
            GridConfig.Definition def = (GridConfig.Definition) result.get('definition');
            System.assertEquals('Rowhouse_Test_Record__c', def.objectApiName);
            System.assertEquals(false, result.get('diagnostics'), 'Diagnostics are off without the custom permission.');
        }
    }

    @IsTest
    static void configCarriesIconsAndTheNameColumn() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = (GridConfig.Definition) GridController.openGrid(
                    'Test_Records',
                    null,
                    null,
                    null,
                    null
                )
                .get('definition');
            // The object's tab icon, or the record icon for an object with no tab.
            System.assert(Pattern.matches('(standard|custom):[a-z0-9_]+', def.objectIcon), def.objectIcon);
            Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
            for (GridConfig.Column c : def.columns) {
                byField.put(c.field, c);
            }
            System.assert(byField.get('Name').isName, 'Name cells link to the record.');
            System.assert(!byField.get('Text_Field__c').isName);
            GridConfig.Column lookup = byField.get('Lookup_Field__c');
            System.assert(lookup.referenceIcons.containsKey('Account'), String.valueOf(lookup.referenceIcons));
            GridConfig.Column owner = byField.get('OwnerId');
            if (owner != null) {
                System.assertEquals(
                    GridIcons.QUEUE,
                    owner.referenceIcons.get('Group'),
                    'An owner\'s queues show the queue icon.'
                );
            }
            System.assertEquals(null, byField.get('Text_Field__c').referenceIcons, 'Only lookups have target icons.');
        }
    }

    @IsTest
    static void iconsAreNotWorkedOutOnTheRowCalls() {
        System.runAs(GridTestUsers.fullUser()) {
            // forUser is what every other call uses: no icons, so no describeTabs per call.
            System.assertEquals(null, GridConfig.forUser('Test_Records').objectIcon);
        }
    }

    @IsTest
    static void countsRelatedRecordsPerRowAndPerTab() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> parents = [SELECT Id FROM Rowhouse_Test_Record__c ORDER BY Name LIMIT 2];
            insert new List<Rowhouse_Test_Child__c>{
                new Rowhouse_Test_Child__c(Name = 'c1', Parent__c = parents[0].Id),
                new Rowhouse_Test_Child__c(Name = 'c2', Parent__c = parents[0].Id)
            };
            Map<String, Object> counts = GridController.countChildren(
                'Test_Records',
                new List<String>{ parents[0].Id, parents[1].Id, UserInfo.getUserId(), 'not an id', null }
            );
            System.assertEquals(2, counts.size(), 'Only records of the grid\'s object are counted: ' + counts);
            Map<String, Object> first = (Map<String, Object>) counts.get(String.valueOf(parents[0].Id));
            System.assertEquals(2, first.get('total'));
            System.assertEquals(2, ((Map<String, Integer>) first.get('byTab')).get('Test_Records_Children'));
            Map<String, Object> second = (Map<String, Object>) counts.get(String.valueOf(parents[1].Id));
            System.assertEquals(0, second.get('total'), 'A row with nothing related says 0, so it offers no toggle.');
            System.assertEquals(0, ((Map<String, Integer>) second.get('byTab')).get('Test_Records_Children'));
        }
    }

    @IsTest
    static void countsAreRefusedForTooManyRowsAtOnce() {
        System.runAs(GridTestUsers.fullUser()) {
            Id first = [SELECT Id FROM Rowhouse_Test_Record__c LIMIT 1].Id;
            String prefix = String.valueOf(first).left(3);
            List<String> ids = new List<String>();
            for (Integer i = 0; i <= GridNesting.MAX_COUNT_PARENTS; i++) {
                ids.add(prefix + '0'.repeat(12 - String.valueOf(i).length()) + String.valueOf(i)); // 15 characters
            }
            try {
                GridController.countChildren('Test_Records', ids);
                System.assert(false, 'More than the limit must be refused.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('at most ' + GridNesting.MAX_COUNT_PARENTS), e.getMessage());
            }
        }
    }

    @IsTest
    static void rowsTravelWithDecimalsAsExactStrings() {
        System.runAs(GridTestUsers.fullUser()) {
            // TC-024: through REST this value comes back as 1.0E18. It must reach the
            // browser as the exact digits.
            Map<String, Object> result = GridController.fetchRows(
                'Test_Records',
                'TC-024',
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
            List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get('rows');
            System.assertEquals(1, rows.size());
            System.assertEquals('999999999999999999', rows[0].get('Number_Field__c'));
            System.assert(rows[0].containsKey('Name'), 'Rows are keyed by local field name (HR-4).');
        }
    }

    @IsTest
    static void longTextIsTruncatedForTheGrid() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> result = GridController.fetchRows(
                'Security_Test',
                null,
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
            Integer marked = 0;
            for (Map<String, Object> row : (List<Map<String, Object>>) result.get('rows')) {
                String text = (String) row.get('Long_Text__c');
                if (text != null) {
                    System.assert(
                        text.length() <= 1001,
                        'TC-055: ' + text.length() + ' characters shipped to a grid cell.'
                    );
                }
                if (row.containsKey('_cut')) {
                    // A shortened value says so, for its editor.
                    System.assertEquals(new List<String>{ 'Long_Text__c' }, row.get('_cut'));
                    marked++;
                }
            }
            System.assertEquals(1, marked, 'Only the shortened value is marked.');
        }
    }

    @IsTest
    static void theEditorReadsTheWholeLongText() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c rec = [
                SELECT Id, Long_Text__c
                FROM Rowhouse_Test_Record__c
                WHERE Name = 'TC-055 long text'
            ];
            String whole = GridController.fetchFullText('Security_Test', rec.Id, 'long_text__c');
            System.assertEquals(rec.Long_Text__c, whole, 'The whole text, not the shortened copy.');
            List<String> refusals = new List<String>();
            for (
                List<String> bad : new List<List<String>>{
                    new List<String>{ 'Security_Test', rec.Id, 'Text_Field__c' },
                    new List<String>{ 'Security_Test', rec.Id, 'Currency_Field__c' },
                    new List<String>{ 'Security_Test', UserInfo.getUserId(), 'Long_Text__c' }
                }
            ) {
                try {
                    GridController.fetchFullText(bad[0], bad[1], bad[2]);
                    refusals.add('read');
                } catch (AuraHandledException e) {
                    refusals.add(e.getMessage());
                }
            }
            System.assert(refusals[0].contains('Not a long text column'), refusals[0]);
            System.assert(
                refusals[1].contains('Not a long text column'),
                'HR-6: only the grid\'s own columns. ' + refusals[1]
            );
            System.assert(refusals[2].contains('is not a'), refusals[2]);
        }
    }

    @IsTest
    static void aTimeReachesTheBrowserAsSalesforceWritesIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c rec = [SELECT Id FROM Rowhouse_Test_Record__c WHERE Name = 'TC-055 long text'];
            rec.Time_Field__c = Time.newInstance(17, 30, 5, 7);
            update rec;
            GridRequest request = new GridRequest(
                'Rowhouse_Test_Record__c',
                new List<String>{ 'Name', 'Time_Field__c' },
                null,
                10
            );
            request.onlyIds(new List<Id>{ rec.Id });
            List<Map<String, Object>> rows = GridController.toClientRows(
                GridDataService.fetchPage(request),
                'Rowhouse_Test_Record__c'
            );
            // Not milliseconds after midnight, which is how Apex hands a Time to the browser.
            System.assertEquals('17:30:05.007Z', rows[0].get('Time_Field__c'));
            System.assertEquals('00:00:00.000Z', GridController.timeText(Time.newInstance(0, 0, 0, 0)));
        }
    }

    @IsTest
    static void saveAndPollRoundTrip() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c rec = [SELECT Id FROM Rowhouse_Test_Record__c WHERE Name = 'TC-055 long text'];
            Test.startTest();
            GridSaveResult ticket = GridController.save(
                'Security_Test',
                new List<Map<String, Object>>{ new Map<String, Object>{ 'Id' => rec.Id, 'Text_Field__c' => 'saved' } }
            );
            System.assertEquals(false, ticket.done, 'A queued save is not done yet.');
            Test.stopTest();
            GridSaveResult done = GridController.saveStatus(ticket.saveId);
            System.assert(done.done);
            System.assertEquals(1, done.successCount);
            List<Map<String, Object>> reread = GridController.fetchRowsById('Security_Test', new List<Id>{ rec.Id });
            System.assertEquals('saved', reread[0].get('Text_Field__c'));
        }
    }

    @IsTest
    static void groupSubtotalsComeThroughAndTheirErrorsReadPlainly() {
        System.runAs(GridTestUsers.fullUser()) {
            GridGroupService.Result result = GridController.summarizeGroups(
                'Group_Test',
                null,
                new List<String>{ 'Picklist_Field__c' },
                null,
                null,
                null,
                null,
                null,
                null
            );
            Integer records = 0;
            for (Map<String, Object> g : result.groups) {
                records += (Integer) g.get('n');
            }
            System.assertEquals(2, records, 'Both seed rows, in the blank Stage group.');
            try {
                GridController.summarizeGroups(
                    'Group_Test',
                    null,
                    new List<String>{ 'Number_Field__c' },
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
                System.assert(false, 'Expected a refusal.');
            } catch (AuraHandledException e) {
                System.assertEquals('Cannot group by Number_Field__c.', e.getMessage());
            }
        }
    }

    // ------------------------------------------------------------ openGrid

    @IsTest
    static void openGridAnswersTheConfigurationTheLayoutAndTheFirstPage() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> result = GridController.openGrid('Test_Records', null, null, null, null);
            GridConfig.Definition def = (GridConfig.Definition) result.get('definition');
            System.assertEquals('Rowhouse_Test_Record__c', def.objectApiName);
            System.assert(
                Pattern.matches('(standard|custom):[a-z0-9_]+', def.objectIcon),
                'Icons, once per grid opened.'
            );
            System.assertEquals(false, result.get('diagnostics'));
            System.assert(result.containsKey('canConfigure'));
            System.assertEquals(null, result.get('layout'), 'No layout kept yet.');
            System.assertEquals(null, result.get('pageError'));
            Map<String, Object> start = (Map<String, Object>) result.get('start');
            System.assertEquals('Name', start.get('sortField'), 'The admin\'s sort.');
            System.assertEquals('asc', start.get('sortDirection'));
            System.assertEquals(new List<String>(), start.get('groupBy'));
            Map<String, Object> page = (Map<String, Object>) result.get('page');
            List<Map<String, Object>> rows = (List<Map<String, Object>>) page.get('rows');
            System.assertEquals(2, rows.size());
            System.assertEquals('TC-024 large number', rows[0].get('Name'));
            System.assertEquals('999999999999999999', rows[0].get('Number_Field__c'), 'Rows as fetchRows sends them.');
            System.assertEquals(2, page.get('totalRows'));
            System.assertEquals(false, page.get('hasMore'));
            Map<String, Object> newRow = (Map<String, Object>) result.get('newRow');
            System.assertEquals(true, newRow.get('inline'), 'The New button adds a row in place here.');
            System.assertEquals(
                null,
                GridController.openGrid('Save_Test', null, null, null, null).get('newRow'),
                'No New button, no new row.'
            );
        }
    }

    @IsTest
    static void aPicklistThatFollowsRecordTypesBringsEachRowsRecordType() {
        Map<String, Schema.RecordTypeInfo> types = Schema.SObjectType.Rowhouse_Test_Typed__c.getRecordTypeInfosByDeveloperName();
        Id standard = types.get('Standard').getRecordTypeId();
        Id restricted = types.get('Restricted').getRecordTypeId();
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Typed__c a = new Rowhouse_Test_Typed__c(
                Name = 'A',
                RecordTypeId = standard,
                Status__c = 'Working'
            );
            Rowhouse_Test_Typed__c b = new Rowhouse_Test_Typed__c(
                Name = 'B',
                RecordTypeId = restricted,
                Status__c = 'Archived'
            );
            insert new List<Rowhouse_Test_Typed__c>{ a, b };
            Map<String, Object> result = GridController.openGrid('Typed_Test', null, null, null, null);
            GridConfig.Definition def = (GridConfig.Definition) result.get('definition');
            System.assertEquals(true, def.byRecordType, 'An editable picklist on an object with record types.');
            List<Map<String, Object>> rows = (List<Map<String, Object>>) ((Map<String, Object>) result.get('page'))
                .get('rows');
            System.assertEquals(2, rows.size());
            System.assertEquals(standard, rows[0].get('RecordTypeId'), 'Each row says its record type.');
            System.assertEquals(restricted, rows[1].get('RecordTypeId'));
            List<Map<String, Object>> reread = GridController.fetchRowsById('Typed_Test', new List<Id>{ b.Id });
            System.assertEquals(restricted, reread[0].get('RecordTypeId'), 'A row read again after a save keeps it.');
            GridConfig.Definition plain = (GridConfig.Definition) GridController.openGrid(
                    'Test_Records',
                    null,
                    null,
                    null,
                    null
                )
                .get('definition');
            System.assertEquals(
                false,
                plain.byRecordType,
                'No record types on the object: the picklists are as they are.'
            );
        }
    }

    @IsTest
    static void createRowsCreatesTheNewRowsRecordsAndSaysWhyNot() {
        System.runAs(GridTestUsers.fullUser()) {
            GridCreateService.Result result = GridController.createRows(
                'Test_Records',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'key' => 'rh-new-1', 'Name' => 'From the grid' }
                },
                null,
                null,
                null
            );
            System.assertEquals('rh-new-1', result.rows[0].key);
            System.assert(result.rows[0].success, String.valueOf(result.rows[0].errors));
            try {
                GridController.createRows(
                    'Save_Test',
                    new List<Map<String, Object>>{ new Map<String, Object>{ 'key' => 'k', 'Name' => 'x' } },
                    null,
                    null,
                    null
                );
                System.assert(false, 'Expected a refusal.');
            } catch (AuraHandledException e) {
                System.assertEquals('This grid does not allow new records.', e.getMessage());
            }
        }
    }

    @IsTest
    static void openGridSearchesAsFetchRowsDoes() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> page = (Map<String, Object>) GridController.openGrid(
                    'Test_Records',
                    'TC-055',
                    null,
                    null,
                    null
                )
                .get('page');
            System.assertEquals(1, page.get('totalRows'));
            System.assertEquals('TC-055 long text', ((List<Map<String, Object>>) page.get('rows'))[0].get('Name'));
        }
    }

    @IsTest
    static void openGridSortsAndGroupsTheFirstPageAsTheLayoutSays() {
        System.runAs(GridTestUsers.fullUser()) {
            String layout = '{"v":1,"sort":[{"field":"Name","direction":"desc"}],"grouping":[{"field":"Picklist_Field__c","unit":null}]}';
            GridLayouts.save('Test_Records', layout);
            Map<String, Object> result = GridController.openGrid('Test_Records', null, null, null, null);
            System.assertEquals(layout, result.get('layout'), 'The layout comes with it, for the browser to read.');
            Map<String, Object> start = (Map<String, Object>) result.get('start');
            System.assertEquals('Name', start.get('sortField'));
            System.assertEquals('desc', start.get('sortDirection'));
            System.assertEquals(new List<String>{ 'Picklist_Field__c' }, start.get('groupBy'));
            List<Map<String, Object>> rows = (List<Map<String, Object>>) ((Map<String, Object>) result.get('page'))
                .get('rows');
            System.assertEquals(
                'TC-055 long text',
                rows[0].get('Name'),
                'One group (no picklist value), Name descending.'
            );
        }
    }

    @IsTest
    static void openGridFallsBackToTheAdminsSortAndGrouping() {
        System.runAs(GridTestUsers.fullUser()) {
            // A column the grid no longer has is passed over; a grouping with no
            // level left is the admin's (none here).
            GridLayouts.save(
                'Test_Records',
                '{"v":1,"sort":[{"field":"Gone__c","direction":"desc"},' +
                '{"field":"Text_Field__c","direction":"desc"}],"grouping":[{"field":"Text_Field__c"}]}'
            );
            Map<String, Object> start = (Map<String, Object>) GridController.openGrid(
                    'Test_Records',
                    null,
                    null,
                    null,
                    null
                )
                .get('start');
            System.assertEquals('Text_Field__c', start.get('sortField'), 'The first sort key left.');
            System.assertEquals('desc', start.get('sortDirection'));
            System.assertEquals(
                new List<String>(),
                start.get('groupBy'),
                'Text cannot be grouped by: the admin\'s grouping.'
            );
        }
    }

    @IsTest
    static void aChildTableKeepsItsOwnLayoutForItsTab() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c parent = [
                SELECT Id
                FROM Rowhouse_Test_Record__c
                WHERE Name = 'TC-024 large number'
            ];
            String own = '{"v":1,"sort":[{"field":"Name","direction":"desc"}]}';
            String inTab = '{"v":1,"sort":[{"field":"Name","direction":"desc"}],"widths":{"Name":180}}';
            GridLayouts.save('Test_Children', own);
            System.assertEquals(true, GridController.saveLayout('Test_Children', inTab, 'Test_Records_Children'));
            Map<String, Object> result = GridController.openGrid(
                'Test_Children',
                null,
                'Test_Records_Children',
                parent.Id,
                null
            );
            System.assertEquals(inTab, result.get('layout'), 'The tab\'s own layout, not the grid\'s on its own.');
            System.assertEquals('desc', ((Map<String, Object>) result.get('start')).get('sortDirection'), 'Its sort.');
            System.assertEquals(
                0,
                ((Map<String, Object>) result.get('page')).get('totalRows'),
                'Only the parent\'s records: none.'
            );
            System.assertEquals(own, GridLayouts.read('Test_Children', null), 'The grid on its own keeps its own.');
            GridController.resetLayout('Test_Children', 'Test_Records_Children');
            System.assertEquals(null, GridLayouts.read('Test_Children', 'Test_Records_Children'), 'Reset in the tab.');
            System.assertEquals(
                own,
                GridLayouts.read('Test_Children', null),
                '... leaves the grid on its own as it was.'
            );
            try {
                GridController.saveLayout('Test_Records', inTab, 'Test_Records_Children');
                System.assert(false, 'A tab that does not show the grid is no key.');
            } catch (AuraHandledException e) {
                System.assert(
                    e.getMessage().contains('does not') || e.getMessage().contains('shows the grid'),
                    e.getMessage()
                );
            }
        }
    }

    @IsTest
    static void rowsThatCannotBeReadAreNoPage() {
        System.runAs(GridTestUsers.fullUser()) {
            // A child tab the grid does not have: the configuration still comes,
            // and the grid asks for the rows itself, which shows why.
            Map<String, Object> result = GridController.openGrid(
                'Test_Children',
                null,
                'Nope',
                UserInfo.getUserId(),
                null
            );
            System.assertNotEquals(null, result.get('definition'));
            System.assertEquals(null, result.get('page'));
            System.assert(String.isNotBlank((String) result.get('pageError')), 'Says why.');
        }
    }

    @IsTest
    static void openGridRefusesAGridThatDoesNotExist() {
        try {
            GridController.openGrid('No_Such_Grid', null, null, null, null);
            System.assert(false, 'Expected an exception.');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('No_Such_Grid'), e.getMessage());
        }
    }

    @IsTest
    static void errorsReachTheClientWithTheirMessage() {
        // Rowhouse's own refusal keeps its words.
        try {
            GridController.fetchRows('No_Such_Grid', null, null, null, null, null, null, null, null, null, null, null);
            System.assert(false, 'Expected an exception.');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('No_Such_Grid'), e.getMessage());
        }
        // Anything else reads plainly; only Rowhouse Grid Diagnostics users see the platform's text.
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridController.lookupName('Test_Records', 'Lookup_Field__c', 'not an id');
                System.assert(false, 'Expected an exception.');
            } catch (AuraHandledException e) {
                System.assertEquals(GridException.UNEXPECTED, e.getMessage(), 'No type or detail without Diagnostics.');
            }
        }
        System.runAs(GridTestUsers.diagnosticsUser()) {
            try {
                GridController.lookupName('Test_Records', 'Lookup_Field__c', 'not an id');
                System.assert(false, 'Expected an exception.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().startsWith(GridException.UNEXPECTED), e.getMessage());
                System.assert(e.getMessage().contains('(System.StringException: '), e.getMessage());
            }
        }
    }

    @IsTest
    static void onlyASortableColumnOfTheGridSortsTheRows() {
        System.runAs(GridTestUsers.fullUser()) {
            // A column of the grid, in any case: sorted.
            Map<String, Object> page = GridController.fetchRows(
                'Test_Records',
                null,
                'name',
                'desc',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            List<Map<String, Object>> rows = (List<Map<String, Object>>) page.get('rows');
            System.assertEquals('TC-055 long text', rows[0].get('Name'), 'Name descending.');
            // A field the user can read, but no column of this grid: refused (HR-6).
            try {
                GridController.fetchRows(
                    'Test_Records',
                    null,
                    'CreatedDate',
                    'asc',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
                System.assert(false, 'The browser may sort only by the grid\'s own sortable columns.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().startsWith('Cannot sort by CreatedDate'), e.getMessage());
            }
        }
    }
}
