/**
 * DEVELOPMENT ONLY. Never packaged.
 * Golden rows for the benchmark generator.
 *
 * The same rows are asserted in test-data/scripts/test_generate_benchmark.py.
 * If both pass, Anonymous Apex and the CSV files produce identical data, and a
 * benchmark run on either is the same benchmark. Change a golden value in one,
 * change it in the other.
 */
@IsTest
private class RowhouseBenchDataTest {

    private static Rowhouse_Bench__c row(Integer i) {
        return RowhouseBenchData.build(i, i)[0];   // on its own: exercises skip-ahead
    }

    @IsTest
    static void rowOneMatchesThePythonGenerator() {
        Rowhouse_Bench__c r = row(1);
        System.assertEquals('BM-000001', r.Name);
        System.assertEquals('Mara Brandt, 88 Pitch Lane', r.Text_Field__c);
        System.assertEquals(316144, r.Number_Field__c.intValue());
        System.assertEquals(Decimal.valueOf('93888.85'), r.Decimal_Field__c);
        System.assertEquals(Decimal.valueOf('80944.76'), r.Currency_Field__c);
        System.assertEquals(Decimal.valueOf('5.43'), r.Percent_Field__c);
        System.assertEquals(Datetime.newInstanceGmt(2026, 9, 29, 21, 28, 0), r.DateTime_Field__c);
        System.assertEquals(false, r.Checkbox_Field__c);
        System.assertEquals('pim.ghosh74@example.com', r.Email_Field__c);
        System.assertEquals('+1 555 513 4362', r.Phone_Field__c);
        System.assertEquals('Beta', r.Picklist_Field__c);
        System.assertEquals('Software', r.Controlling_Picklist__c);
        System.assertEquals('Licence', r.Dependent_Picklist__c);
        System.assertEquals(null, r.Multi_Picklist__c);
    }

    @IsTest
    static void theOtherGoldenRowsMatch() {
        Rowhouse_Bench__c two = row(2);
        System.assertEquals('Foundry Terrace', two.Text_Field__c);
        System.assertEquals(true, two.Checkbox_Field__c);
        System.assertEquals('Services', two.Controlling_Picklist__c);
        System.assertEquals(null, two.Dependent_Picklist__c, 'Services has no dependent values.');

        String part = 'Mara Halloran ' + String.fromCharArray(new List<Integer>{ 8212 }) + ' Sable Terrace';
        System.assertEquals(String.join(new List<String>{ part, part, part, part, part, part }, ' '),
            row(20).Text_Field__c, 'The long-text case, em dash included.');
        System.assertEquals('Obsolete', row(23).Picklist_Field__c);
        System.assertEquals('Green;Blue;Amber', row(44).Multi_Picklist__c);

        Rowhouse_Bench__c thousand = row(1000);
        System.assertEquals('Sable Row', thousand.Text_Field__c);
        System.assertEquals(Decimal.valueOf('18508.73'), thousand.Currency_Field__c);
        System.assertEquals(Date.newInstance(2026, 11, 7), thousand.Date_Field__c);
        System.assertEquals(null, thousand.Phone_Field__c);
        System.assertEquals('Amber;Slate', thousand.Multi_Picklist__c);

        Rowhouse_Bench__c last = row(10000);
        System.assertEquals('BM-010000', last.Name);
        System.assertEquals('Rowan Row', last.Text_Field__c);
        System.assertEquals(209513, last.Number_Field__c.intValue());
        System.assertEquals(Datetime.newInstanceGmt(2025, 9, 1, 18, 33, 0), last.DateTime_Field__c);
        System.assertEquals('Amber;Slate;Red', last.Multi_Picklist__c);

        Rowhouse_Bench__c fiftyK = row(50000);
        System.assertEquals('BM-050000', fiftyK.Name);
        System.assertEquals('Cobble Yard', fiftyK.Text_Field__c);
        System.assertEquals(353165, fiftyK.Number_Field__c.intValue());
        System.assertEquals(Decimal.valueOf('52986.89'), fiftyK.Currency_Field__c);
        System.assertEquals(Datetime.newInstanceGmt(2025, 3, 6, 23, 47, 0), fiftyK.DateTime_Field__c);
        System.assertEquals('kira.kowalski18@example.com', fiftyK.Email_Field__c);
        System.assertEquals('Green', fiftyK.Multi_Picklist__c);
    }

    @IsTest
    static void aSliceIsTheSameRowsAsALongerRun() {
        List<Rowhouse_Bench__c> run = RowhouseBenchData.build(1, 60);
        List<Rowhouse_Bench__c> slice = RowhouseBenchData.build(41, 60);
        for (Integer k = 0; k < slice.size(); k++) {
            System.assertEquals(run[40 + k], slice[k], 'Row ' + (41 + k) + ' differs: the sizes would not nest.');
        }
    }

    @IsTest
    static void insertsRowsAndRefusesBadRanges() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(3, RowhouseBenchData.insertRows(1, 3));
            System.assertEquals(3, [SELECT COUNT() FROM Rowhouse_Bench__c]);
        }
        for (List<Integer> bad : new List<List<Integer>>{ new List<Integer>{ 0, 5 }, new List<Integer>{ 5, 4 },
                                                          new List<Integer>{ 1, 2001 } }) {
            try {
                RowhouseBenchData.build(bad[0], bad[1]);
                System.assert(false, 'Expected a refusal for ' + bad);
            } catch (IllegalArgumentException e) {
                System.assert(String.isNotBlank(e.getMessage()));
            }
        }
    }
}
