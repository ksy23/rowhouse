/**
 * DEVELOPMENT ONLY. Never packaged.
 * Data for grid actions, never packaged: an invocable Apex action the
 * Consignments grid runs on its rows. It stamps each record's Consignee,
 * then throws if one of the records is the one held at customs. One exception fails
 * the whole call and the platform undoes its work,
 * which is what GridActionService's one-by-one retry is for.
 */
public with sharing class ConsignmentStampAction {
    public static final String STAMP = 'Portland Terminal Receiving';
    public static final String FAILS_ON = 'Held at customs, Calais';

    @InvocableMethod(
        label='Stamp for Portland receiving'
        description='Data for Rowhouse grid actions: stamps the consignments for Portland receiving; fails on one held at customs.'
    )
    public static List<String> run(List<Id> recordIds) {
        List<Consignment__c> rows = [SELECT Id, Name FROM Consignment__c WHERE Id IN :recordIds];
        for (Consignment__c r : rows) {
            r.Consignee__c = STAMP;
        }
        update rows;
        for (Consignment__c r : rows) {
            if (r.Name == FAILS_ON) {
                throw new IllegalArgumentException(
                    'A consignment held at customs cannot be stamped: "' + FAILS_ON + '".'
                );
            }
        }
        List<String> out = new List<String>();
        for (Id recordId : recordIds) {
            out.add('Stamped ' + recordId);
        }
        return out;
    }
}
