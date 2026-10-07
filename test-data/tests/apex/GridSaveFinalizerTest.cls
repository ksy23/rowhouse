/**
 * DEVELOPMENT ONLY. Never packaged.
 * The failure path of an asynchronous save: a chunk that dies on an uncatchable
 * limit must still report, or the grid would wait for an answer forever.
 */
@IsTest
private class GridSaveFinalizerTest {

    private class FailedContext implements FinalizerContext {
        public Id getAsyncApexJobId() { return null; }
        public String getRequestId() { return 'test'; }
        public ParentJobResult getResult() { return ParentJobResult.UNHANDLED_EXCEPTION; }
        public Exception getException() { return new SimulatedLimitException('Apex CPU time limit exceeded'); }
    }

    private class SimulatedLimitException extends Exception {}

    @IsTest
    static void aFailedChunkReportsEveryRecordAsNotSaved() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c a = new Rowhouse_Test_Record__c(Name = 'a');
            Rowhouse_Test_Record__c b = new Rowhouse_Test_Record__c(Name = 'b');
            insert new List<Rowhouse_Test_Record__c>{ a, b };

            new GridSaveFinalizer('abc123', 0, 1, new List<Id>{ a.Id, b.Id }).execute(new FailedContext());

            GridSaveResult result = GridSaveService.status('abc123');
            System.assert(result.done);
            System.assertEquals(0, result.successCount);
            System.assertEquals(2, result.errors.size());
            System.assert(result.errors[0].message.contains('CPU time'), result.errors[0].message);
            System.assertEquals(null, result.errors[0].fieldName, 'A failed chunk is a row-level error.');
        }
    }
}
