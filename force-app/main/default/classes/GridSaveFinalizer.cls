/**
 * Runs after every GridSaveChunk, including one that died on an uncatchable
 * governor limit. On failure it records every record in the chunk as not saved,
 * with the platform's reason, so the grid can show the user exactly which rows
 * need another try.
 */
public with sharing class GridSaveFinalizer implements Finalizer {

    private final String saveId;
    private final Integer chunkIndex;
    private final Integer chunkCount;
    private final List<Id> recordIds;

    public GridSaveFinalizer(String saveId, Integer chunkIndex, Integer chunkCount, List<Id> recordIds) {
        this.saveId = saveId;
        this.chunkIndex = chunkIndex;
        this.chunkCount = chunkCount;
        this.recordIds = recordIds;
    }

    public void execute(FinalizerContext context) {
        if (context.getResult() == ParentJobResult.SUCCESS) {
            return; // the chunk wrote its own report
        }
        Exception failure = context.getException();
        String reason = 'Not saved: ' + (failure == null ? 'the save job failed.' : failure.getMessage());
        List<GridSaveError> errors = new List<GridSaveError>();
        for (Id recordId : recordIds) {
            errors.add(new GridSaveError(recordId, null, reason));
        }
        GridSecurity.insertOwnRecords(new List<SObject>{
            report(saveId, chunkIndex, chunkCount, 0, errors)
        });
    }

    /** One chunk's outcome, as the row the grid polls for. */
    public static Grid_Save_Result__c report(String saveId, Integer chunkIndex, Integer chunkCount,
                                             Integer successCount, List<GridSaveError> errors) {
        return new Grid_Save_Result__c(
            Name = saveId.left(16) + '-' + chunkIndex,
            Save_Id__c = saveId,
            Chunk_Index__c = chunkIndex,
            Chunk_Count__c = chunkCount,
            Success_Count__c = successCount,
            Status__c = errors.isEmpty() ? 'Succeeded' : (successCount > 0 ? 'Partial' : 'Failed'),
            Errors_JSON__c = errors.isEmpty() ? null : JSON.serialize(errors).left(131072)
        );
    }
}
