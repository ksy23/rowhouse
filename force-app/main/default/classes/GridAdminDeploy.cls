/**
 * GridAdminDeploy — called when a save from the Grid Admin tab has been
 * deployed. It writes the outcome to a Grid Save Result row, owned by
 * the admin who saved, which the page polls for (GridAdmin.saveStatus) and
 * deletes once read. Rows the page never reads go with the other results'
 * clean-up after a day (GridSaveChunk).
 */
public with sharing class GridAdminDeploy implements Metadata.DeployCallback {

    private final Id ownerId;

    public GridAdminDeploy(Id ownerId) {
        this.ownerId = ownerId;
    }

    public void handleResult(Metadata.DeployResult result, Metadata.DeployCallbackContext context) {
        GridSecurity.insertOwnRecords(new List<SObject>{ report(result, context, ownerId) });
    }

    /** The row for one deployment: Succeeded, or Failed with what went wrong, record by record. */
    @TestVisible
    private static Grid_Save_Result__c report(Metadata.DeployResult result, Metadata.DeployCallbackContext context, Id ownerId) {
        String jobId = result != null && String.isNotBlank(result.id) ? result.id
            : (context == null ? null : String.valueOf(context.getCallbackJobId()));
        Boolean succeeded = result != null && result.status == Metadata.DeployStatus.Succeeded;
        List<String> messages = new List<String>();
        if (!succeeded) {
            if (result != null && result.details != null && result.details.componentFailures != null) {
                for (Metadata.DeployMessage m : result.details.componentFailures) {
                    messages.add((String.isBlank(m.fullName) ? '' : m.fullName + ': ') + m.problem);
                }
            }
            if (messages.isEmpty()) {
                messages.add(result == null || String.isBlank(result.errorMessage)
                    ? 'The save did not go through. Try again.' : result.errorMessage);
            }
        }
        return new Grid_Save_Result__c(
            Name = ('Admin ' + jobId).left(80),
            Save_Id__c = jobId,
            Chunk_Index__c = 0,
            Chunk_Count__c = 1,
            Success_Count__c = succeeded ? 1 : 0,
            Status__c = succeeded ? 'Succeeded' : 'Failed',
            Errors_JSON__c = messages.isEmpty() ? null : JSON.serialize(messages).left(131072),
            OwnerId = ownerId
        );
    }
}
