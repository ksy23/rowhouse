/** One save problem: a cell when fieldName is set, otherwise the whole row. */
public with sharing class GridSaveError {
    @AuraEnabled
    public Id recordId;
    @AuraEnabled
    public String fieldName;
    @AuraEnabled
    public String message;

    public GridSaveError(Id recordId, String fieldName, String message) {
        this.recordId = recordId;
        this.fieldName = fieldName;
        this.message = message;
    }
}
