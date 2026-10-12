/**
 * DEVELOPMENT ONLY. Never packaged.
 * The failure path of an asynchronous save: a chunk that dies on an uncatchable
 * limit must still report, or the grid would wait for an answer forever.
 */
@IsTest
private class GridSaveFinalizerTest {
    private class FailedContext implements FinalizerContext {
        public Id getAsyncApexJobId() {
            return null;
        }
        public String getRequestId() {
            return '4exQ7Lr2KmVt9WcN8pZbJ-';
        }
        public ParentJobResult getResult() {
            return ParentJobResult.UNHANDLED_EXCEPTION;
        }
        public Exception getException() {
            return new SimulatedLimitException('Apex CPU time limit exceeded');
        }
    }

    private class SimulatedLimitException extends Exception {
    }

    @IsTest
    static void aFailedChunkReportsEveryRecordAsNotSaved() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c a = new Consignment__c(Name = 'Kennebec Lumber, 12 bundles');
            Consignment__c b = new Consignment__c(Name = 'Penobscot Paper, full truck');
            insert new List<Consignment__c>{ a, b };
            String saveId = '3f9a1c7e5b2d48a6904e7c1b2a6d5f30'; // as GridSaveService makes one: 32 hex digits

            new GridSaveFinalizer(saveId, 0, 1, new List<Id>{ a.Id, b.Id }).execute(new FailedContext());

            GridSaveResult result = GridSaveService.status(saveId);
            System.assert(result.done);
            System.assertEquals(0, result.successCount);
            System.assertEquals(2, result.errors.size());
            System.assert(result.errors[0].message.contains('CPU time'), result.errors[0].message);
            System.assertEquals(null, result.errors[0].fieldName, 'A failed chunk is a row-level error.');
        }
    }
}
