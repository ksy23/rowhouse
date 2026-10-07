/**
 * The state of one save: returned at once as a ticket (done = false), then
 * polled until every chunk has reported (done = true).
 */
public with sharing class GridSaveResult {
    @AuraEnabled public String saveId;
    @AuraEnabled public Boolean done = true;
    @AuraEnabled public Integer chunkCount = 0;
    @AuraEnabled public Integer chunksReported = 0;
    @AuraEnabled public Integer successCount = 0;
    @AuraEnabled public List<GridSaveError> errors = new List<GridSaveError>();
    /** Fields in the payload that are not editable columns of this grid (HR-6). */
    @AuraEnabled public List<String> rejectedFields = new List<String>();
    /** Fields removed because the user cannot edit them (field-level security). */
    @AuraEnabled public List<String> strippedFields = new List<String>();
}
