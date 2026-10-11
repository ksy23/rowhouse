/**
 * DEVELOPMENT ONLY. Never packaged.
 * What a grid's own settings refuse, whoever asks. Run as fullUser(), who may
 * edit and create test records, so the grid, not the user's access, is what
 * refuses.
 *
 * A grid that does not edit cells: Read_Only_Test (test-data/config) has
 * Allow Inline Edit off, although its columns are marked Editable and it sets
 * Allow Import and Allow New Records, so that one setting is what must refuse
 * a save, an import and new rows, and nothing may be written.
 *
 * An Id of another object: the grid sends only its own records' Ids, so a
 * save or an import that carries a Rowhouse_Bench__c record's Id, whose
 * fields have the same names, must be refused, or fail on that row, and
 * write nothing to that record.
 */
@IsTest
private class GridReadOnlyGridTest {
    private static final String PROBE = 'Read only grid probe';
    private static final String BENCH = 'Another object';

    @TestSetup
    static void setup() {
        System.runAs(GridTestUsers.fullUser()) {
            insert new Rowhouse_Test_Record__c(Name = PROBE, Text_Field__c = 'as it was', Number_Field__c = 7);
            insert new Rowhouse_Bench__c(Name = BENCH, Text_Field__c = 'bench as it was');
        }
    }

    // ---------------------------------------------------------------- helpers

    private static User full() {
        return GridTestUsers.built(GridTestUsers.FULL);
    }

    private static Rowhouse_Test_Record__c probe() {
        Rowhouse_Test_Record__c found;
        System.runAs(full()) {
            found = [
                SELECT Id, Text_Field__c, Number_Field__c
                FROM Rowhouse_Test_Record__c
                WHERE Name = :PROBE
                LIMIT 1
            ];
        }
        return found;
    }

    private static Rowhouse_Bench__c bench() {
        Rowhouse_Bench__c found;
        System.runAs(full()) {
            found = [SELECT Id, Text_Field__c FROM Rowhouse_Bench__c WHERE Name = :BENCH LIMIT 1];
        }
        return found;
    }

    private static Integer recordCount() {
        Integer n;
        System.runAs(full()) {
            n = [SELECT COUNT() FROM Rowhouse_Test_Record__c];
        }
        return n;
    }

    // ------------------------------------------------- a grid that does not edit cells

    @IsTest
    static void aGridThatDoesNotEditCellsOffersNothingToEdit() {
        System.runAs(full()) {
            GridConfig.Definition def = GridConfig.forUser('Read_Only_Test');
            System.assertEquals(false, def.allowInlineEdit);
            System.assertEquals(false, def.allowImport, 'Allow Import is set, but the grid does not edit cells.');
            System.assert(!def.columns.isEmpty());
            for (GridConfig.Column c : def.columns) {
                System.assertEquals(false, c.editable, c.field + ' is offered for editing.');
                System.assertEquals(false, c.creatable, c.field + ' is offered on a new row.');
            }
            System.assert(
                GridConfig.load('Read_Only_Test').editableFields().isEmpty(),
                'The server\'s allow-list for a save is empty.'
            );
        }
    }

    @IsTest
    static void aSaveToAGridThatDoesNotEditCellsWritesNothing() {
        Rowhouse_Test_Record__c before = probe();
        GridSaveResult ticket;
        String refused;
        Integer queued;
        System.runAs(full()) {
            Test.startTest();
            Integer jobs = Limits.getQueueableJobs();
            Integer dml = Limits.getDmlStatements();
            try {
                ticket = GridSaveService.save(
                    'Read_Only_Test',
                    new List<Map<String, Object>>{
                        new Map<String, Object>{
                            'Id' => before.Id,
                            'Text_Field__c' => 'changed',
                            'Number_Field__c' => '8'
                        }
                    }
                );
            } catch (GridException e) {
                refused = e.getMessage();
            }
            queued = Limits.getQueueableJobs() - jobs;
            System.assertEquals(dml, Limits.getDmlStatements(), 'No DML in the call.');
            Test.stopTest();
        }
        if (ticket != null) {
            System.assert(
                ticket.rejectedFields.contains('Text_Field__c') && ticket.rejectedFields.contains('Number_Field__c'),
                'Every field is refused by the allow-list: ' + ticket
            );
        }
        System.assertEquals(
            0,
            queued,
            'A grid that does not edit cells queued ' +
                queued +
                ' save chunk(s). An update that carries no field still runs the org\'s triggers and flows on the ' +
                'record and stamps it Last Modified, so the save must be refused, or queue nothing.'
        );
        Rowhouse_Test_Record__c after = probe();
        System.assertEquals('as it was', after.Text_Field__c);
        System.assertEquals(7, after.Number_Field__c);
    }

    @IsTest
    static void anImportIntoAGridThatDoesNotEditCellsIsRefused() {
        Rowhouse_Test_Record__c before = probe();
        Integer count = recordCount();
        List<String> refusals = new List<String>();
        System.runAs(full()) {
            Integer dml = Limits.getDmlStatements();
            for (
                Map<String, Object> row : new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => before.Id, 'Text_Field__c' => 'imported' },
                    new Map<String, Object>{ 'Name' => 'Imported into a read-only grid', 'Text_Field__c' => 'new' }
                }
            ) {
                try {
                    GridImportService.importRows('Read_Only_Test', new List<Map<String, Object>>{ row });
                    refusals.add(null);
                } catch (GridException e) {
                    refusals.add(e.getMessage());
                }
            }
            System.assertEquals(dml, Limits.getDmlStatements(), 'Nothing was written.');
        }
        System.assertEquals(
            new List<String>{
                'This grid does not allow importing records.',
                'This grid does not allow importing records.'
            },
            refusals,
            'An import of updates, then of new records.'
        );
        System.assertEquals('as it was', probe().Text_Field__c);
        System.assertEquals(count, recordCount(), 'No record was created.');
    }

    @IsTest
    static void newRowsInAGridThatDoesNotEditCellsAreRefused() {
        Integer count = recordCount();
        String refused;
        String refusedByTheController;
        System.runAs(full()) {
            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                new Map<String, Object>{ 'key' => 'rh-new-1', 'Name' => 'New in a read-only grid' }
            };
            try {
                GridCreateService.create('Read_Only_Test', rows, null, null, null);
            } catch (GridException e) {
                refused = e.getMessage();
            }
            try {
                GridController.createRows('Read_Only_Test', rows, null, null, null);
            } catch (AuraHandledException e) {
                refusedByTheController = e.getMessage();
            }
        }
        System.assertEquals('This grid does not allow new records.', refused);
        System.assertEquals('This grid does not allow new records.', refusedByTheController);
        System.assertEquals(count, recordCount(), 'No record was created.');
    }

    // ------------------------------------------------- an Id of another object

    @IsTest
    static void aSaveCarryingAnotherObjectsIdWritesNothingToThatRecord() {
        Rowhouse_Test_Record__c before = probe();
        Rowhouse_Bench__c other = bench();
        GridSaveResult ticket;
        String refused;
        System.runAs(full()) {
            Test.startTest();
            try {
                ticket = GridSaveService.save(
                    'Test_Records',
                    new List<Map<String, Object>>{
                        new Map<String, Object>{ 'Id' => other.Id, 'Text_Field__c' => 'written through the grid' },
                        new Map<String, Object>{ 'Id' => before.Id, 'Text_Field__c' => 'changed' }
                    }
                );
            } catch (GridException e) {
                refused = e.getMessage();
            }
            Test.stopTest();
        }
        System.assertEquals('bench as it was', bench().Text_Field__c, 'Nothing was written to the other object.');
        if (refused != null) {
            System.assert(refused.contains(String.valueOf(other.Id)), 'The refusal names the Id: ' + refused);
            System.assertEquals('as it was', probe().Text_Field__c, 'A refused request writes nothing at all.');
            return;
        }
        System.assertEquals(1, ticket.errors.size(), String.valueOf(ticket.errors));
        System.assertEquals(other.Id, ticket.errors[0].recordId);
        System.assertEquals(
            'Record ' + other.Id + ' is not a Rowhouse_Test_Record__c.',
            ticket.errors[0].message,
            'A row error that names the Id.'
        );
        System.assertEquals('changed', probe().Text_Field__c, 'The grid\'s own row is saved.');
    }

    @IsTest
    static void anImportCarryingAnotherObjectsIdWritesNothingToThatRecord() {
        Rowhouse_Bench__c other = bench();
        GridImportService.Result result;
        String refused;
        System.runAs(full()) {
            try {
                result = GridImportService.importRows(
                    'Test_Records',
                    new List<Map<String, Object>>{
                        new Map<String, Object>{ 'Id' => other.Id, 'Text_Field__c' => 'imported through the grid' }
                    }
                );
            } catch (GridException e) {
                refused = e.getMessage();
            }
        }
        System.assertEquals('bench as it was', bench().Text_Field__c, 'Nothing was written to the other object.');
        if (refused != null) {
            System.assert(refused.contains(String.valueOf(other.Id)), 'The refusal names the Id: ' + refused);
            return;
        }
        System.assertEquals(false, result.rows[0].success, String.valueOf(result.rows));
        System.assertEquals('Record ' + other.Id + ' is not a Rowhouse_Test_Record__c.', result.rows[0].message);
    }
}
