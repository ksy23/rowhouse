/**
 * DEVELOPMENT ONLY. Never packaged.
 * Test data for grid actions, never packaged: an invocable Apex action
 * the Test_Records grid runs on its rows. It stamps each record's Text field,
 * then throws if one of the records is named "Fail me". One exception fails
 * the whole call and the platform undoes its work,
 * which is what GridActionService's one-by-one retry is for.
 */
public with sharing class RowhouseTestAction {

    public static final String STAMP = 'Stamped by Apex';
    public static final String FAILS_ON = 'Fail me';

    @InvocableMethod(label='Rowhouse test action'
                     description='Test data for Rowhouse grid actions: stamps the records; fails on one named Fail me.')
    public static List<String> run(List<Id> recordIds) {
        List<Rowhouse_Test_Record__c> rows = [SELECT Id, Name FROM Rowhouse_Test_Record__c WHERE Id IN :recordIds];
        for (Rowhouse_Test_Record__c r : rows) {
            r.Text_Field__c = STAMP;
        }
        update rows;
        for (Rowhouse_Test_Record__c r : rows) {
            if (r.Name == FAILS_ON) {
                throw new IllegalArgumentException('The test action does not run on a record named "' + FAILS_ON + '".');
            }
        }
        List<String> out = new List<String>();
        for (Id recordId : recordIds) {
            out.add('Stamped ' + recordId);
        }
        return out;
    }
}
