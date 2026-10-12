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
private class FreightBillDataTest {
    private static Freight_Bill__c row(Integer i) {
        return FreightBillData.build(i, i)[0]; // on its own: exercises skip-ahead
    }

    @IsTest
    static void rowOneMatchesThePythonGenerator() {
        Freight_Bill__c r = row(1);
        System.assertEquals('FB-000001', r.Name);
        System.assertEquals('Mara Brandt, 88 Pitch Lane', r.Consignee__c);
        System.assertEquals(316144, r.Pieces__c.intValue());
        System.assertEquals(Decimal.valueOf('93888.85'), r.Weight__c);
        System.assertEquals(Decimal.valueOf('80944.76'), r.Freight_Charge__c);
        System.assertEquals(Decimal.valueOf('5.43'), r.Fuel_Surcharge__c);
        System.assertEquals(Datetime.newInstanceGmt(2026, 9, 29, 21, 28, 0), r.Picked_Up__c);
        System.assertEquals(false, r.Delivered__c);
        System.assertEquals('pim.ghosh74@granitecoastfreight.com', r.Contact_Email__c);
        System.assertEquals('+1 555 513 4362', r.Contact_Phone__c);
        System.assertEquals('Standard', r.Service_Level__c);
        System.assertEquals('LTL', r.Mode__c);
        System.assertEquals('Pallet', r.Equipment__c);
        System.assertEquals(null, r.Handling__c);
    }

    @IsTest
    static void theOtherGoldenRowsMatch() {
        Freight_Bill__c two = row(2);
        System.assertEquals('Foundry Terrace', two.Consignee__c);
        System.assertEquals(true, two.Delivered__c);
        System.assertEquals('Parcel', two.Mode__c);
        System.assertEquals(null, two.Equipment__c, 'Parcel has no dependent values.');

        String part = 'Mara Halloran ' + String.fromCharArray(new List<Integer>{ 8212 }) + ' Sable Terrace';
        System.assertEquals(
            String.join(new List<String>{ part, part, part, part, part, part }, ' '),
            row(20).Consignee__c,
            'The long-text case, em dash included.'
        );
        System.assertEquals('White Glove', row(23).Service_Level__c);
        System.assertEquals('Liftgate;Inside Delivery;Appointment', row(44).Handling__c);

        Freight_Bill__c thousand = row(1000);
        System.assertEquals('Sable Row', thousand.Consignee__c);
        System.assertEquals(Decimal.valueOf('18508.73'), thousand.Freight_Charge__c);
        System.assertEquals(Date.newInstance(2026, 11, 7), thousand.Ship_Date__c);
        System.assertEquals(null, thousand.Contact_Phone__c);
        System.assertEquals('Appointment;Hazmat', thousand.Handling__c);

        Freight_Bill__c last = row(10000);
        System.assertEquals('FB-010000', last.Name);
        System.assertEquals('Rowan Row', last.Consignee__c);
        System.assertEquals(209513, last.Pieces__c.intValue());
        System.assertEquals(Datetime.newInstanceGmt(2025, 9, 1, 18, 33, 0), last.Picked_Up__c);
        System.assertEquals('Appointment;Hazmat;Fragile', last.Handling__c);

        Freight_Bill__c fiftyK = row(50000);
        System.assertEquals('FB-050000', fiftyK.Name);
        System.assertEquals('Cobble Yard', fiftyK.Consignee__c);
        System.assertEquals(353165, fiftyK.Pieces__c.intValue());
        System.assertEquals(Decimal.valueOf('52986.89'), fiftyK.Freight_Charge__c);
        System.assertEquals(Datetime.newInstanceGmt(2025, 3, 6, 23, 47, 0), fiftyK.Picked_Up__c);
        System.assertEquals('kira.kowalski18@granitecoastfreight.com', fiftyK.Contact_Email__c);
        System.assertEquals('Liftgate', fiftyK.Handling__c);
    }

    @IsTest
    static void aSliceIsTheSameRowsAsALongerRun() {
        List<Freight_Bill__c> run = FreightBillData.build(1, 60);
        List<Freight_Bill__c> slice = FreightBillData.build(41, 60);
        for (Integer k = 0; k < slice.size(); k++) {
            System.assertEquals(run[40 + k], slice[k], 'Row ' + (41 + k) + ' differs: the sizes would not nest.');
        }
    }

    @IsTest
    static void insertsRowsAndRefusesBadRanges() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(3, FreightBillData.insertRows(1, 3));
            System.assertEquals(3, [SELECT COUNT() FROM Freight_Bill__c]);
        }
        for (
            List<Integer> bad : new List<List<Integer>>{
                new List<Integer>{ 0, 5 },
                new List<Integer>{ 5, 4 },
                new List<Integer>{ 1, 2001 }
            }
        ) {
            try {
                FreightBillData.build(bad[0], bad[1]);
                System.assert(false, 'Expected a refusal for ' + bad);
            } catch (IllegalArgumentException e) {
                System.assert(String.isNotBlank(e.getMessage()));
            }
        }
    }
}
