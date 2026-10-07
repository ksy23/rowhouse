/**
 * DEVELOPMENT ONLY. Never packaged.
 * HR-4 — namespace normalisation, and why this test only counts in CI.
 *
 * WHY THIS EXISTS
 * getGlobalDescribe() returns 'rowhouse__Grid_Configuration__mdt' in the managed
 * build and 'Grid_Configuration__mdt' in the unlocked one. The same code, two
 * different keys. This is the sharpest correctness hazard in a dual build.
 *
 * IMPORTANT: a pass in ONE build proves nothing. The CI workflow runs this
 * suite in both, and only both passing counts. A green run locally against your
 * default org is not evidence.
 */
@IsTest
private class GridDescribeTest {
    @IsTest
    static void localNameIsIdenticalInBothBuilds() {
        Test.startTest();
        String local = GridDescribe.localName(Rowhouse_Test_Record__c.SObjectType);
        Test.stopTest();
        // Asserted WITHOUT a namespace prefix on purpose. If this assertion needs
        // to change between builds, HR-4 has been violated.
        System.assertEquals(
            'Rowhouse_Test_Record__c',
            local,
            'localName() must strip any namespace prefix so both builds agree.'
        );
    }

    @IsTest
    static void fieldMapIsKeyedByLocalName() {
        Test.startTest();
        Map<String, Schema.SObjectField> fields = GridDescribe.fieldsFor('Rowhouse_Test_Record__c');
        Test.stopTest();
        System.assert(fields.containsKey('Text_Field__c'), 'Field map must be keyed by local name in both builds.');
        for (String key : fields.keySet()) {
            // A namespaced key looks like 'rowhouse__Text_Field__c', so the check
            // is on the PREFIX. Searching for '__rowhouse' would never fire.
            System.assert(!key.startsWithIgnoreCase('rowhouse__'), 'Namespaced key leaked into the field map: ' + key);
        }
    }

    @IsTest
    static void unknownObjectFailsClearlyRatherThanReturningNull() {
        Boolean threw = false;
        try {
            GridDescribe.fieldsFor('No_Such_Object__c');
        } catch (Exception e) {
            threw = true;
            // HR-1: subscribers catch bare Exception, so the MESSAGE has to be
            // useful — it is the only diagnostic they get.
            System.assert(e.getMessage().contains('No_Such_Object__c'), 'The exception message must name the object.');
        }
        System.assert(threw, 'An unknown object must throw, not return null.');
    }

    @IsTest
    static void aRollUpSummaryIsReadOnlyByType() {
        // Rollup_Total__c sums the child object's Amount__c. The platform reports
        // it as a calculated currency field, which is what GridConfig reads to
        // keep it out of the editable columns whatever the admin sets.
        Schema.DescribeFieldResult d = Rowhouse_Test_Record__c.Rollup_Total__c.getDescribe();
        System.assertEquals('currency', GridDescribe.cellType(Rowhouse_Test_Record__c.Rollup_Total__c));
        System.assertEquals(
            true,
            d.isCalculated(),
            'A roll-up must report as calculated, or GridConfig would offer an editor.'
        );
        System.assertEquals(false, GridDescribe.isRequired(d), 'A roll-up is never required from the user.');
    }
}
