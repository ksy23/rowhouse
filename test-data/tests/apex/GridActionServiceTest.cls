/**
 * DEVELOPMENT ONLY. Never packaged.
 * Grid actions: what a grid offers, what the server refuses, and how
 * each kind runs and fails. The fixture actions are on Test_Records (a screen
 * flow, an autolaunched flow, invocable Apex, a quick action, and one that
 * needs Rowhouse_Diagnostics); Group_Test carries three that cannot work, so
 * their warnings are tested. The flow and the Apex action they run are test
 * data (test-data/actions): both fail on a record named "Fail me".
 */
@IsTest
private class GridActionServiceTest {
    private static final String FAIL_ME = 'Fail me';

    private static List<Rowhouse_Test_Record__c> newRecords(List<String> names) {
        List<Rowhouse_Test_Record__c> out = new List<Rowhouse_Test_Record__c>();
        for (String name : names) {
            out.add(new Rowhouse_Test_Record__c(Name = name, Text_Field__c = 'before'));
        }
        insert out;
        return out;
    }

    private static List<Id> idsOf(List<Rowhouse_Test_Record__c> records) {
        List<Id> out = new List<Id>();
        for (Rowhouse_Test_Record__c r : records) {
            out.add(r.Id);
        }
        return out;
    }

    private static Map<Id, String> textsOf(List<Rowhouse_Test_Record__c> records) {
        Map<Id, String> out = new Map<Id, String>();
        for (Rowhouse_Test_Record__c r : [SELECT Id, Text_Field__c FROM Rowhouse_Test_Record__c WHERE Id IN :records]) {
            out.put(r.Id, r.Text_Field__c);
        }
        return out;
    }

    private static String refusal(String actionName, List<Id> ids) {
        try {
            GridActionService.run('Test_Records', actionName, ids);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    private static Map<String, GridConfig.Action> byName(List<GridConfig.Action> actions) {
        Map<String, GridConfig.Action> out = new Map<String, GridConfig.Action>();
        for (GridConfig.Action a : actions) {
            out.put(a.name, a);
        }
        return out;
    }

    // ------------------------------------------------------------ what a grid offers

    @IsTest
    static void offersTheConfigurationsActionsInOrder() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Test_Records');
            List<String> names = new List<String>();
            for (GridConfig.Action a : def.actions) {
                names.add(a.name);
            }
            System.assertEquals(
                new List<String>{
                    'Test_Records_Add_Note',
                    'Test_Records_Mark_Seen',
                    'Test_Records_Stamp',
                    'Test_Records_Log_Call'
                },
                names,
                'In Sort Order, and without the action that needs a permission this user lacks.'
            );

            Map<String, GridConfig.Action> a = byName(def.actions);
            GridConfig.Action note = a.get('Test_Records_Add_Note');
            System.assertEquals('Add a note', note.label, 'The record\'s Label is what the menu says.');
            System.assertEquals('screenflow', note.type);
            System.assertEquals(
                'Rowhouse_Test_Screen_Flow',
                note.flowName,
                'The browser runs a screen flow, so it is told which.'
            );
            System.assertEquals(
                'recordId',
                note.inputName,
                'A screen flow takes the row\'s Id in recordId unless told otherwise.'
            );
            System.assert(note.onRow && note.onSelection, 'Show In Both: the row menu and the selection bar.');

            GridConfig.Action seen = a.get('Test_Records_Mark_Seen');
            System.assertEquals('flow', seen.type);
            System.assertEquals(null, seen.flowName, 'What a server action runs is not told to the browser.');
            System.assertEquals(null, seen.inputName);
            System.assertEquals('Rowhouse_Test_Action_Flow', seen.actionName, 'The server keeps it.');

            GridConfig.Action stamp = a.get('Test_Records_Stamp');
            System.assert(!stamp.onRow && stamp.onSelection, 'Show In Selection.');
            System.assertEquals('Stamp these records with Apex?', stamp.confirmation);

            GridConfig.Action call = a.get('Test_Records_Log_Call');
            System.assertEquals('quickaction', call.type);
            System.assert(call.onRow && !call.onSelection, 'Show In Row.');
        }
    }

    @IsTest
    static void theScreenFlowPageIsToldWhichFlowByTheConfiguration() {
        // The page names the grid and the action; the server says which flow.
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> note = GridController.screenFlow('Test_Records', 'Test_Records_Add_Note');
            System.assertEquals('Add a note', note.get('label'));
            System.assertEquals('Rowhouse_Test_Screen_Flow', note.get('flowName'));
            System.assertEquals('recordId', note.get('inputName'));
            System.assertEquals(true, note.get('onRow'));
            System.assertEquals(true, note.get('onSelection'));
            for (
                String notOne : new List<String>{
                    'Test_Records_Mark_Seen',
                    'No_Such_Action',
                    'Test_Records_Diagnostics_Only'
                }
            ) {
                try {
                    GridController.screenFlow('Test_Records', notOne);
                    System.assert(false, notOne + ' is not a screen flow this user can run.');
                } catch (AuraHandledException e) {
                    System.assert(e.getMessage().contains('no screen flow called "' + notOne + '"'), e.getMessage());
                }
            }
        }
    }

    @IsTest
    static void offersAnActionThatNeedsAPermissionOnlyToThoseWhoHaveIt() {
        System.runAs(GridTestUsers.diagnosticsUser()) {
            Map<String, GridConfig.Action> a = byName(GridConfig.forUser('Test_Records').actions);
            System.assert(a.containsKey('Test_Records_Diagnostics_Only'), 'This user holds Rowhouse_Diagnostics.');
        }
    }

    @IsTest
    static void skipsAnActionThatCannotWorkWithAWarning() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.load('Group_Test');
            System.assert(def.actions.isEmpty(), 'None of Group_Test\'s actions can work: ' + def.actions);
            String warnings = String.join(def.warnings, '\n');
            System.assert(
                warnings.contains('Grid Action Group_Test_No_Type was skipped: it has no Action Type.'),
                warnings
            );
            System.assert(
                warnings.contains(
                    'Grid Action Group_Test_Other_Object was skipped: "Account.NewCase" is a quick action of Account'
                ),
                warnings
            );
            System.assert(
                warnings.contains('Grid Action Group_Test_Bad_Name was skipped: "Mark as seen" is not an API name.'),
                warnings
            );
        }
    }

    // ------------------------------------------------------------ running each kind

    @IsTest
    static void runsAFlowOnEachRecordAndReportsTheOneThatFails() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Plain 1', FAIL_ME, 'Plain 2' });
            Test.startTest();
            GridActionService.Result result = GridActionService.run(
                'Test_Records',
                'Test_Records_Mark_Seen',
                idsOf(recs)
            );
            Test.stopTest();
            System.assertEquals(
                new List<Id>{ recs[0].Id, recs[2].Id },
                result.succeededIds,
                'A flow interview that fails, fails alone.'
            );
            System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
            System.assertEquals(recs[1].Id, result.errors[0].recordId);
            System.assertEquals(null, result.errors[0].fieldName, 'An action error belongs to the row, not a cell.');
            System.assert(
                result.errors[0].message.containsIgnoreCase('flow'),
                'The platform\'s message: ' + result.errors[0].message
            );
            Map<Id, String> texts = textsOf(recs);
            System.assertEquals('Seen by flow', texts.get(recs[0].Id));
            System.assertEquals('Seen by flow', texts.get(recs[2].Id));
            System.assertEquals('before', texts.get(recs[1].Id));
        }
    }

    @IsTest
    static void runsApexAgainOneRecordAtATimeWhenOneRecordFailsTheCall() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Plain 1', FAIL_ME, 'Plain 2' });
            Test.startTest();
            GridActionService.Result result = GridActionService.run('Test_Records', 'Test_Records_Stamp', idsOf(recs));
            Test.stopTest();
            System.assertEquals(
                new List<Id>{ recs[0].Id, recs[2].Id },
                result.succeededIds,
                'The records that were not the problem run on their own.'
            );
            System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
            System.assertEquals(recs[1].Id, result.errors[0].recordId);
            System.assert(
                result.errors[0].message.contains('Fail me'),
                'The Apex exception\'s message: ' + result.errors[0].message
            );
            Map<Id, String> texts = textsOf(recs);
            System.assertEquals(RowhouseTestAction.STAMP, texts.get(recs[0].Id));
            System.assertEquals(RowhouseTestAction.STAMP, texts.get(recs[2].Id));
            System.assertEquals('before', texts.get(recs[1].Id), 'The failed call\'s work is undone.');
        }
    }

    @IsTest
    static void runsAllTheRecordsOfAnApexCallInOneGoWhenNoneFails() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Plain 1', 'Plain 2' });
            Test.startTest();
            GridActionService.Result result = GridActionService.run('Test_Records', 'Test_Records_Stamp', idsOf(recs));
            Integer queries = Limits.getQueries();
            Test.stopTest();
            System.assertEquals(idsOf(recs), result.succeededIds);
            System.assert(result.errors.isEmpty(), String.valueOf(result.errors));
            System.assert(queries <= 3, 'One call for both records, not one each: ' + queries + ' queries.');
        }
    }

    @IsTest
    static void runsAQuickActionOnARow() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Call me' });
            Integer tasksBefore = [SELECT COUNT() FROM Task];
            Test.startTest();
            GridActionService.Result result = GridActionService.run(
                'Test_Records',
                'Test_Records_Log_Call',
                idsOf(recs)
            );
            Test.stopTest();
            System.assertEquals(idsOf(recs), result.succeededIds, String.valueOf(result.errors));
            System.assertEquals(tasksBefore + 1, [SELECT COUNT() FROM Task], 'Log a Call logs one call.');
            // Related to the row: the platform reports success even when it cannot
            // relate the Task, on an object that does not allow activities.
            System.assertEquals(
                1,
                [SELECT COUNT() FROM Task WHERE WhatId = :recs[0].Id],
                'The call is logged against the row it was run on.'
            );
        }
    }

    // ------------------------------------------------------------ what the server refuses

    @IsTest
    static void refusesWhatTheGridDoesNotOffer() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Keep 1', 'Keep 2' });
            List<Id> one = new List<Id>{ recs[0].Id };
            System.assert(
                refusal('No_Such_Action', one).contains('has no action named "No_Such_Action"'),
                'Only the grid\'s own actions run.'
            );
            System.assert(
                refusal('Test_Records_Add_Note', one).contains('runs in the browser'),
                'A screen flow runs in the browser.'
            );
            System.assert(
                refusal('Test_Records_Log_Call', idsOf(recs)).contains('runs on one row at a time'),
                'An action shown only in the row menu runs on one record.'
            );
            System.assert(
                refusal('Test_Records_Mark_Seen', new List<Id>{ recs[0].Id, UserInfo.getUserId() })
                    .contains('is not a Rowhouse_Test_Record__c. Nothing was run.'),
                'Another object\'s Id refuses the whole request.'
            );
            List<Id> tooMany = new List<Id>();
            for (Integer i = 0; i <= GridActionService.MAX_IDS; i++) {
                tooMany.add(recs[0].Id);
            }
            System.assert(
                refusal('Test_Records_Mark_Seen', tooMany).contains('at most ' + GridActionService.MAX_IDS),
                'A request may hold at most MAX_IDS records.'
            );
            System.assertEquals(
                new Map<Id, String>{ recs[0].Id => 'before', recs[1].Id => 'before' },
                textsOf(recs),
                'Nothing refused was run.'
            );
        }
    }

    @IsTest
    static void refusesAnActionThatNeedsAPermissionTheUserLacks() {
        User diagnostics = GridTestUsers.diagnosticsUser();
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Keep' });
            System.assertEquals(
                'You do not have permission to run Stamp (diagnostics only).',
                refusal('Test_Records_Diagnostics_Only', idsOf(recs))
            );
        }
        System.runAs(diagnostics) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Stamp me' });
            GridActionService.Result result = GridActionService.run(
                'Test_Records',
                'Test_Records_Diagnostics_Only',
                idsOf(recs)
            );
            System.assertEquals(idsOf(recs), result.succeededIds, String.valueOf(result.errors));
        }
    }

    @IsTest
    static void reportsARecordTheUserCannotSeeAndRunsTheRest() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = newRecords(new List<String>{ 'Gone', 'Here' });
            delete recs[0];
            GridActionService.Result result = GridActionService.run(
                'Test_Records',
                'Test_Records_Mark_Seen',
                idsOf(recs)
            );
            System.assertEquals(new List<Id>{ recs[1].Id }, result.succeededIds);
            System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
            System.assertEquals(recs[0].Id, result.errors[0].recordId);
            System.assertEquals('You do not have access to this record, or it was deleted.', result.errors[0].message);
        }
    }

    @IsTest
    static void findsTheApexInputOrSaysWhatIsMissing() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Action apex = new GridConfig.Action();
            apex.name = 'Test';
            apex.type = 'apex';
            apex.actionName = 'RowhouseTestAction';
            System.assertEquals('recordIds', GridActionService.inputFor(apex), 'The action\'s one input, by describe.');
            apex.serverInput = 'someOtherInput';
            System.assertEquals('someOtherInput', GridActionService.inputFor(apex), 'An Input Name wins.');
            apex.serverInput = null;
            apex.actionName = 'No_Such_Class_Rowhouse';
            try {
                GridActionService.inputFor(apex);
                System.assert(false, 'A class that is not there must be named in the error.');
            } catch (GridException e) {
                System.assert(
                    e.getMessage().contains('There is no invocable Apex action named "No_Such_Class_Rowhouse"'),
                    e.getMessage()
                );
            }
            GridConfig.Action flow = new GridConfig.Action();
            flow.type = 'flow';
            System.assertEquals('recordId', GridActionService.inputFor(flow));
            flow.type = 'quickaction';
            System.assertEquals('contextId', GridActionService.inputFor(flow));
            System.assert(GridActionService.roomToRetry(), 'A fresh transaction has room to retry.');
        }
    }

    @IsTest
    static void theControllerPassesOnARefusalAndAnEmptyRequest() {
        System.runAs(GridTestUsers.fullUser()) {
            GridActionService.Result empty = GridController.runAction(
                'Test_Records',
                'Test_Records_Mark_Seen',
                new List<Id>()
            );
            System.assert(empty.succeededIds.isEmpty() && empty.errors.isEmpty(), 'Nothing asked, nothing run.');
            try {
                GridController.runAction('Test_Records', 'No_Such_Action', new List<Id>{ UserInfo.getUserId() });
                System.assert(false, 'An unknown action must be refused.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('has no action named'), e.getMessage());
            }
        }
    }
}
