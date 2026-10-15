/**
 * DEVELOPMENT ONLY. Never packaged.
 * Grid actions: what a grid offers, what the server refuses, and how an
 * autolaunched flow runs and fails. The fixture actions are on Consignments (a
 * screen flow, an autolaunched flow, a flow that runs Apex, a quick action, and
 * one that needs Rowhouse_Diagnostics); the autolaunched flows need
 * Run_Freight_Actions, which Freight Full Access grants. Consignments_By_Mode
 * carries five that cannot work, so their warnings are tested. The flows and
 * the Apex action they run are test data (test-data/actions): they fail on a
 * record named "Held at customs, Calais".
 */
@IsTest
private class GridActionServiceTest {
    private static final String FAIL_ME = 'Held at customs, Calais';

    private static List<Consignment__c> newRecords(List<String> names) {
        List<Consignment__c> out = new List<Consignment__c>();
        for (String name : names) {
            out.add(new Consignment__c(Name = name, Consignee__c = 'Wachusett Paper'));
        }
        insert out;
        return out;
    }

    private static List<Id> idsOf(List<Consignment__c> records) {
        List<Id> out = new List<Id>();
        for (Consignment__c r : records) {
            out.add(r.Id);
        }
        return out;
    }

    private static Map<Id, String> textsOf(List<Consignment__c> records) {
        Map<Id, String> out = new Map<Id, String>();
        for (Consignment__c r : [SELECT Id, Consignee__c FROM Consignment__c WHERE Id IN :records]) {
            out.put(r.Id, r.Consignee__c);
        }
        return out;
    }

    private static String refusal(String actionName, List<Id> ids) {
        try {
            GridActionService.run('Consignments', actionName, ids);
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
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            List<String> names = new List<String>();
            for (GridConfig.Action a : def.actions) {
                names.add(a.name);
            }
            System.assertEquals(
                new List<String>{
                    'Consignments_Add_Note',
                    'Consignments_Mark_Seen',
                    'Consignments_Stamp',
                    'Consignments_Log_Call'
                },
                names,
                'In Sort Order, and without the action that needs a permission this user lacks.'
            );

            Map<String, GridConfig.Action> a = byName(def.actions);
            GridConfig.Action note = a.get('Consignments_Add_Note');
            System.assertEquals('Add a note', note.label, 'The record\'s Label is what the menu says.');
            System.assertEquals('screenflow', note.type);
            System.assertEquals(
                'Add_Delivery_Note',
                note.flowName,
                'The browser runs a screen flow, so it is told which.'
            );
            System.assertEquals(
                'recordId',
                note.inputName,
                'A screen flow takes the row\'s Id in recordId unless told otherwise.'
            );
            System.assert(note.onRow && note.onSelection, 'Show In Both: the row menu and the selection bar.');

            GridConfig.Action seen = a.get('Consignments_Mark_Seen');
            System.assertEquals('flow', seen.type);
            System.assertEquals(null, seen.flowName, 'What a server action runs is not told to the browser.');
            System.assertEquals(null, seen.inputName);
            System.assertEquals('Mark_Consignment_Reviewed', seen.actionName, 'The server keeps it.');

            GridConfig.Action stamp = a.get('Consignments_Stamp');
            System.assertEquals('flow', stamp.type, 'Apex runs from an autolaunched flow.');
            System.assert(!stamp.onRow && stamp.onSelection, 'Show In Selection.');
            System.assertEquals('Stamp these records with Apex?', stamp.confirmation);

            GridConfig.Action call = a.get('Consignments_Log_Call');
            System.assertEquals('quickaction', call.type);
            System.assert(call.onRow && !call.onSelection, 'Show In Row.');
            System.assertEquals(
                'Global.LogACall',
                call.quickActionName,
                'The browser opens Salesforce\'s window for it, so it is told which; a global action\'s name is Global.'
            );
            System.assertEquals(null, seen.quickActionName);
        }
    }

    @IsTest
    static void theScreenFlowPageIsToldWhichFlowByTheConfiguration() {
        // The page names the grid and the action; the server says which flow.
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> note = GridController.screenFlow('Consignments', 'Consignments_Add_Note');
            System.assertEquals('Add a note', note.get('label'));
            System.assertEquals('Add_Delivery_Note', note.get('flowName'));
            System.assertEquals('recordId', note.get('inputName'));
            System.assertEquals(true, note.get('onRow'));
            System.assertEquals(true, note.get('onSelection'));
            for (
                String notOne : new List<String>{
                    'Consignments_Mark_Seen',
                    'Consignments_Rerate',
                    'Consignments_Diagnostics_Only'
                }
            ) {
                try {
                    GridController.screenFlow('Consignments', notOne);
                    System.assert(false, notOne + ' is not a screen flow this user can run.');
                } catch (AuraHandledException e) {
                    System.assert(e.getMessage().contains('no screen flow of that name'), e.getMessage());
                    System.assert(!e.getMessage().contains(notOne), 'The name came from the address; not repeated.');
                }
            }
        }
    }

    @IsTest
    static void offersAnActionThatNeedsAPermissionOnlyToThoseWhoHaveIt() {
        System.runAs(GridTestUsers.diagnosticsUser()) {
            Map<String, GridConfig.Action> a = byName(GridConfig.forUser('Consignments').actions);
            System.assert(a.containsKey('Consignments_Diagnostics_Only'), 'This user holds Rowhouse_Diagnostics.');
        }
    }

    @IsTest
    static void skipsAnActionThatCannotWorkWithAWarning() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.load('Consignments_By_Mode');
            System.assert(def.actions.isEmpty(), 'None of Consignments_By_Mode\'s actions can work: ' + def.actions);
            String warnings = String.join(def.warnings, '\n');
            System.assert(
                warnings.contains('Grid Action Consignments_By_Mode_No_Type was skipped: it has no Action Type.'),
                warnings
            );
            System.assert(
                warnings.contains(
                    'Grid Action Consignments_By_Mode_Other_Object was skipped: "Account.NewCase" is a quick action of Account'
                ),
                warnings
            );
            System.assert(
                warnings.contains(
                    'Grid Action Consignments_By_Mode_Bad_Name was skipped: "Mark as seen" is not an API name.'
                ),
                warnings
            );
            System.assert(
                warnings.contains(
                    'Grid Action Consignments_By_Mode_No_Permission was skipped: ' + GridActions.PERMISSION_NEEDED
                ),
                warnings
            );
            System.assert(
                warnings.contains(
                    'Grid Action Consignments_By_Mode_Call_On_Selection was skipped: ' + GridActions.QUICK_ACTION_ON_ROW
                ),
                warnings
            );
        }
    }

    @IsTest
    static void skipsAnApexActionAndSaysToRunItFromAFlow() {
        Grid_Action__mdt r = new Grid_Action__mdt(
            DeveloperName = 'Consignments_Rerate',
            MasterLabel = 'Rerate',
            Action_Type__c = 'Apex',
            Action_Name__c = 'ConsignmentStampAction',
            Required_Permission__c = 'Run_Freight_Actions'
        );
        List<String> warnings = new List<String>();
        List<GridConfig.Action> out = GridActions.actionsFrom(
            new List<Grid_Action__mdt>{ r },
            Consignment__c.SObjectType,
            warnings
        );
        System.assert(out.isEmpty());
        System.assertEquals(
            new List<String>{ 'Grid Action Consignments_Rerate was skipped: ' + GridActions.NO_APEX },
            warnings
        );
    }

    @IsTest
    static void offersAnAutolaunchedFlowOnlyToThoseWhoHoldItsPermission() {
        User reader = GridTestUsers.readOnlyUser(); // reads consignments; does not hold Run_Freight_Actions
        List<Consignment__c> recs;
        System.runAs(GridTestUsers.fullUser()) {
            recs = newRecords(new List<String>{ 'Birch dowels, Skowhegan' });
        }
        System.runAs(reader) {
            List<String> names = new List<String>();
            for (GridConfig.Action a : GridConfig.forUser('Consignments').actions) {
                names.add(a.name);
            }
            System.assertEquals(
                new List<String>{ 'Consignments_Add_Note', 'Consignments_Log_Call' },
                names,
                'A screen flow and a quick action may name no permission; the autolaunched flows name ' +
                'Run_Freight_Actions, which this user does not hold.'
            );
            System.assertEquals(
                'You do not have permission to run Mark as seen.',
                refusal('Consignments_Mark_Seen', idsOf(recs))
            );
        }
    }

    // ------------------------------------------------------------ running each kind

    @IsTest
    static void runsAFlowOnEachRecordAndReportsTheOneThatFails() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(
                new List<String>{ 'Paper rolls, Augusta', FAIL_ME, 'Paper rolls, Worcester' }
            );
            Test.startTest();
            GridActionService.Result result = GridActionService.run(
                'Consignments',
                'Consignments_Mark_Seen',
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
            System.assertEquals('Reviewed by dispatch', texts.get(recs[0].Id));
            System.assertEquals('Reviewed by dispatch', texts.get(recs[2].Id));
            System.assertEquals('Wachusett Paper', texts.get(recs[1].Id));
        }
    }

    @IsTest
    static void runsApexThroughAFlowAndUndoesTheRecordWhoseApexThrows() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(
                new List<String>{ 'Paper rolls, Augusta', FAIL_ME, 'Paper rolls, Worcester' }
            );
            Test.startTest();
            GridActionService.Result result = GridActionService.run('Consignments', 'Consignments_Stamp', idsOf(recs));
            Test.stopTest();
            System.assertEquals(
                new List<Id>{ recs[0].Id, recs[2].Id },
                result.succeededIds,
                'The records that were not the problem are stamped.'
            );
            System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
            System.assertEquals(recs[1].Id, result.errors[0].recordId);
            System.assert(String.isNotBlank(result.errors[0].message));
            System.assert(!result.errors[0].message.contains('  '), 'No doubled spaces: ' + result.errors[0].message);
            Map<Id, String> texts = textsOf(recs);
            System.assertEquals(ConsignmentStampAction.STAMP, texts.get(recs[0].Id));
            System.assertEquals(ConsignmentStampAction.STAMP, texts.get(recs[2].Id));
            System.assertEquals(
                'Wachusett Paper',
                texts.get(recs[1].Id),
                'The Apex stamped it before it threw; that is undone.'
            );
        }
    }

    @IsTest
    static void runsAnotherInterviewOnlyWhileThereIsRoomForTwiceTheLast() {
        System.assert(GridActionService.roomForTwice(new List<Integer>{ 0, 0, 0 }), 'A fresh transaction has room.');
        System.assert(
            !GridActionService.roomForTwice(new List<Integer>{ Limits.getLimitQueries(), 0, 0 }),
            'Not when the last interview used half the queries or more.'
        );
        System.assert(
            !GridActionService.roomForTwice(new List<Integer>{ 0, Limits.getLimitDmlStatements(), 0 }),
            'Nor half the DML statements.'
        );
        System.assert(GridActionService.NOT_REACHED.startsWith('Not run:'));
    }

    @IsTest
    static void aQuickActionIsNotRunOnTheServer() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Missed pickup, Lewiston' });
            System.assertEquals(
                'Log a call is a quick action: it opens in Salesforce\'s own window, not on the server.',
                refusal('Consignments_Log_Call', idsOf(recs))
            );
        }
    }

    // ------------------------------------------------------------ what the server refuses

    @IsTest
    static void refusesWhatTheGridDoesNotOffer() {
        User diagnostics = GridTestUsers.diagnosticsUser();
        System.runAs(diagnostics) {
            List<Consignment__c> two = newRecords(new List<String>{ 'Shingles, Keene', 'Shingles, Dover' });
            System.assert(
                refusal('Consignments_Diagnostics_Only', idsOf(two)).contains('runs on one row at a time'),
                'An action shown only in the row menu runs on one record.'
            );
        }
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Shingles, Concord', 'Shingles, Nashua' });
            List<Id> one = new List<Id>{ recs[0].Id };
            System.assert(
                refusal('Consignments_Rerate', one).contains('has no action named "Consignments_Rerate"'),
                'Only the grid\'s own actions run.'
            );
            System.assert(
                refusal('Consignments_Add_Note', one).contains('runs in the browser'),
                'A screen flow runs in the browser.'
            );
            System.assert(
                refusal('Consignments_Mark_Seen', new List<Id>{ recs[0].Id, UserInfo.getUserId() })
                    .contains('is not a Consignment__c. Nothing was run.'),
                'Another object\'s Id refuses the whole request.'
            );
            List<Id> tooMany = new List<Id>();
            for (Integer i = 0; i <= GridActionService.MAX_IDS; i++) {
                tooMany.add(recs[0].Id);
            }
            System.assert(
                refusal('Consignments_Mark_Seen', tooMany).contains('at most ' + GridActionService.MAX_IDS),
                'A request may hold at most MAX_IDS records.'
            );
            System.assertEquals(
                new Map<Id, String>{ recs[0].Id => 'Wachusett Paper', recs[1].Id => 'Wachusett Paper' },
                textsOf(recs),
                'Nothing refused was run.'
            );
        }
    }

    @IsTest
    static void refusesAnActionThatNeedsAPermissionTheUserLacks() {
        User diagnostics = GridTestUsers.diagnosticsUser();
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Shingles, Concord' });
            System.assertEquals(
                'You do not have permission to run Stamp (diagnostics only).',
                refusal('Consignments_Diagnostics_Only', idsOf(recs))
            );
        }
        System.runAs(diagnostics) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Bonded cargo, Portland' });
            GridActionService.Result result = GridActionService.run(
                'Consignments',
                'Consignments_Diagnostics_Only',
                idsOf(recs)
            );
            System.assertEquals(idsOf(recs), result.succeededIds, String.valueOf(result.errors));
        }
    }

    @IsTest
    static void reportsARecordTheUserCannotSeeAndRunsTheRest() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(
                new List<String>{ 'Cancelled pickup, Bath', 'Lobster crates, Bath' }
            );
            delete recs[0];
            GridActionService.Result result = GridActionService.run(
                'Consignments',
                'Consignments_Mark_Seen',
                idsOf(recs)
            );
            System.assertEquals(new List<Id>{ recs[1].Id }, result.succeededIds);
            System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
            System.assertEquals(recs[0].Id, result.errors[0].recordId);
            System.assertEquals('You do not have access to this record, or it was deleted.', result.errors[0].message);
        }
    }

    @IsTest
    static void looksForAnInstalledPackagesFlowInItsNamespace() {
        System.assertEquals(
            new List<String>{ null, 'Mark_Consignment_Reviewed' },
            GridActionService.namespaceAndName('Mark_Consignment_Reviewed'),
            'The org\'s own flow, by its plain name.'
        );
        System.assertEquals(
            new List<String>{ 'cargo_ops', 'Mark_Reviewed' },
            GridActionService.namespaceAndName('cargo_ops__Mark_Reviewed'),
            'Another package\'s flow: its namespace, then its own name.'
        );
    }

    @IsTest
    static void saysSoOnEveryRowWhenTheFlowIsNotThere() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords(new List<String>{ 'Paper rolls, Worcester', 'Paper rolls, Lowell' });
            GridConfig.Action flow = new GridConfig.Action();
            flow.name = 'Consignments_Rerate';
            flow.type = 'flow';
            flow.actionName = 'Rerate_Consignment';
            Map<Id, String> failures = GridActionService.interviews(flow, idsOf(recs));
            String missing = 'There is no autolaunched flow named "Rerate_Consignment" (Grid Action Consignments_Rerate).';
            System.assertEquals(new Map<Id, String>{ recs[0].Id => missing, recs[1].Id => missing }, failures);
        }
    }

    @IsTest
    static void theControllerPassesOnARefusalAndAnEmptyRequest() {
        System.runAs(GridTestUsers.fullUser()) {
            GridActionService.Result empty = GridController.runAction(
                'Consignments',
                'Consignments_Mark_Seen',
                new List<Id>()
            );
            System.assert(empty.succeededIds.isEmpty() && empty.errors.isEmpty(), 'Nothing asked, nothing run.');
            try {
                GridController.runAction('Consignments', 'Consignments_Rerate', new List<Id>{ UserInfo.getUserId() });
                System.assert(false, 'An unknown action must be refused.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('has no action named'), e.getMessage());
            }
        }
    }
}
