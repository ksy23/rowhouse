/**
 * DEVELOPMENT ONLY. Never packaged.
 * HR-7 — chunked save, and the assertion that actually proves it.
 *
 * Every save names its grid configuration (Save_Test, in test-data/config):
 * the editable columns of that configuration are the HR-6 allow-list, so a save
 * with no configuration could not enforce it.
 *
 * WHY THIS EXISTS
 * "No DML in a loop" is easy to say and easy to regress, because a looped save
 * works perfectly at 50 records and fails at 200. Counting rows saved proves
 * nothing; counting DML STATEMENTS is the test.
 *
 * The saves run as GridTestUsers.fullUser(): the bookkeeping rows are written
 * in user mode, through the product's own permission set.
 */
@IsTest
private class GridSaveServiceTest {
    private static List<Map<String, Object>> payload(Integer n) {
        List<Rowhouse_Test_Record__c> recs = new List<Rowhouse_Test_Record__c>();
        for (Integer i = 0; i < n; i++) {
            recs.add(new Rowhouse_Test_Record__c(Name = 'chunk ' + i, Number_Field__c = i));
        }
        insert recs;
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Rowhouse_Test_Record__c r : recs) {
            out.add(new Map<String, Object>{ 'Id' => r.Id, 'Number_Field__c' => r.Number_Field__c + 1000 });
        }
        return out;
    }

    /**
     * The Queueable-per-chunk model: each 200-record chunk
     * is its own transaction, so the CALLING transaction issues ZERO DML and
     * queues three jobs for 450 records. The chunk jobs run at Test.stopTest().
     *
     * Both numbers are read inside the start/stop window: after stopTest the
     * Limits methods report the outer context and would prove nothing.
     */
    @IsTest
    static void saves450RecordsAsThreeQueuedChunksWithNoDmlInTheCaller() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> rows = payload(450);
            Test.startTest();
            Integer dmlBefore = Limits.getDmlStatements();
            Integer jobsBefore = Limits.getQueueableJobs();
            GridSaveResult ticket = GridSaveService.save('Save_Test', rows);
            Integer dmlUsed = Limits.getDmlStatements() - dmlBefore;
            Integer jobsQueued = Limits.getQueueableJobs() - jobsBefore;
            Test.stopTest();

            System.assertEquals(0, dmlUsed, 'The calling transaction must issue no DML; it issued ' + dmlUsed);
            // 450 records at 200 per chunk is 3 jobs. A per-record design would queue
            // 450 and hit the 50-job limit long before that.
            System.assertEquals(3, jobsQueued, 'Expected 3 chunk jobs, got ' + jobsQueued);
            System.assertEquals(3, ticket.chunkCount);
            System.assertEquals(450, [SELECT COUNT() FROM Rowhouse_Test_Record__c WHERE Number_Field__c >= 1000]);

            GridSaveResult done = GridSaveService.status(ticket.saveId);
            System.assert(done.done, 'All three chunks must have reported: ' + done);
            System.assertEquals(450, done.successCount);
            System.assertEquals(
                0,
                [SELECT COUNT() FROM Grid_Save_Result__c WHERE Save_Id__c = :ticket.saveId],
                'Result rows are bookkeeping and must be deleted once read.'
            );
        }
    }

    @IsTest
    static void oneBadRowFailsOnlyItsOwnChunkAndReportsPerCell() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> rows = payload(10);
            // Percent_Field__c is precision 5 scale 2 — this overflows it.
            rows[4].put('Percent_Field__c', 99999999.00); // Decimal, not Integer:
            // an Integer into a Decimal field can throw at put() time rather than
            // producing the per-row DML error this test is about.

            Test.startTest();
            GridSaveResult ticket = GridSaveService.save('Save_Test', rows);
            Test.stopTest();
            GridSaveResult res = GridSaveService.status(ticket.saveId);

            System.assert(res.done, 'The chunk must have reported: ' + res);
            System.assertEquals(9, res.successCount, 'Good rows in a failing chunk must still save.');
            System.assertEquals(1, res.errors.size());
            GridSaveError err = res.errors[0];
            System.assertEquals((Id) rows[4].get('Id'), err.recordId);
            System.assertEquals(
                'Percent_Field__c',
                err.fieldName,
                'The error must identify the field so the grid can mark the cell, not just the row.'
            );
            System.assert(String.isNotBlank(err.message));
        }
    }

    @IsTest
    static void aBlankRequiredFieldIsRefusedRatherThanReplacedWithTheId() {
        System.runAs(GridTestUsers.fullUser()) {
            // Found in Lightning Experience: the platform accepts a blank Name on
            // update and stores the record Id in it. The grid must refuse instead.
            Rowhouse_Test_Record__c rec = new Rowhouse_Test_Record__c(Name = 'keep me');
            insert rec;
            Test.startTest();
            GridSaveResult res = GridSaveService.save(
                'Test_Records',
                new List<Map<String, Object>>{ new Map<String, Object>{ 'Id' => rec.Id, 'Name' => '' } }
            );
            Test.stopTest();
            System.assert(res.done, 'Nothing valid was left to queue: ' + res);
            System.assertEquals(1, res.errors.size(), String.valueOf(res.errors));
            System.assertEquals('Name', res.errors[0].fieldName);
            System.assertEquals(GridSaveService.REQUIRED_MESSAGE, res.errors[0].message);
            System.assertEquals('keep me', [SELECT Name FROM Rowhouse_Test_Record__c WHERE Id = :rec.Id].Name);
        }
    }

    @IsTest
    static void roundsExtraDecimalsToTheFieldScaleHalfUp() {
        // TC-023. The platform stores extra decimals given through Apex or the
        // API (1.005 in a two-decimal field stays 1.005), while the grid shows
        // them rounded. The save rounds, so what is saved is what was shown.
        Schema.SObjectField dec = Rowhouse_Test_Record__c.Decimal_Field__c; // scale 2
        Schema.SObjectField whole = Rowhouse_Test_Record__c.Number_Field__c; // scale 0
        Schema.SObjectField money = Rowhouse_Test_Record__c.Currency_Field__c; // scale 2
        System.assertEquals(1234.57, GridSaveService.coerce(dec, '1234.567'));
        System.assertEquals(1.01, GridSaveService.coerce(dec, '1.005'), 'Half up, not setScale\'s HALF_EVEN (1.00).');
        System.assertEquals(-1.01, GridSaveService.coerce(dec, '-1.005'), 'Half away from zero for negatives.');
        System.assertEquals(3, ((Decimal) GridSaveService.coerce(whole, '2.5')).intValue(), 'HALF_EVEN would give 2.');
        System.assertEquals(0.01, GridSaveService.coerce(money, 0.005));
        System.assertEquals(12.30, GridSaveService.coerce(dec, '12.30'), 'A value that fits is left alone.');
        System.assertEquals(
            Decimal.valueOf('999999999999999999'),
            GridSaveService.coerce(whole, '999999999999999999'),
            'TC-024 stays exact.'
        );
    }

    @IsTest
    static void readsTimesAndDateTimesAsTheEditorsSendThem() {
        // A Time needs its own case, or saving one fails.
        Schema.SObjectField t = Rowhouse_Test_Record__c.Time_Field__c;
        System.assertEquals(Time.newInstance(17, 30, 0, 0), GridSaveService.coerce(t, '17:30'));
        System.assertEquals(Time.newInstance(9, 5, 7, 250), GridSaveService.coerce(t, '09:05:07.25Z'));
        System.assertEquals(
            Time.newInstance(17, 30, 0, 0),
            GridSaveService.coerce(t, '17:30:00.000Z'),
            'As Salesforce sends it.'
        );
        System.assertEquals(null, GridSaveService.coerce(t, ''));
        for (String bad : new List<String>{ '25:00', '5:30 PM', 'noon' }) {
            try {
                GridSaveService.coerce(t, bad);
                System.assert(false, bad + ' is not a time.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains(bad), e.getMessage());
            }
        }
        System.assertEquals(
            Datetime.newInstanceGmt(2026, 10, 1, 17, 30, 0),
            GridSaveService.coerce(Rowhouse_Test_Record__c.DateTime_Field__c, '2026-10-01T17:30:00.000Z')
        );
    }

    @IsTest
    static void savesNothingWhenThePayloadIsEmpty() {
        Test.startTest();
        Integer before = Limits.getDmlStatements();
        GridSaveResult res = GridSaveService.save('Save_Test', new List<Map<String, Object>>());
        Integer after = Limits.getDmlStatements(); // read inside the window
        Test.stopTest();
        System.assertEquals(before, after, 'An empty save must issue no DML at all.');
        System.assertEquals(0, res.successCount);
        System.assert(res.done, 'Nothing to save is already done — nothing to poll for.');
    }
}
