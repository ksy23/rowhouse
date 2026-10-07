/**
 * DEVELOPMENT ONLY. Never packaged.
 * HR-5, HR-6 — the security tests a reviewer will look for.
 *
 * WHY THESE EXIST
 * Rowhouse builds SOQL dynamically from admin configuration, which is the
 * highest-scrutiny shape in an AppExchange security review. Two things have to
 * be demonstrable: every access decision passes through one auditable choke
 * point, and the server never trusts the client about which fields to write.
 *
 * TWO THINGS THAT MAKE OR BREAK THIS CLASS
 *
 * 1. The test creates its own restricted user. It must NOT depend on a user
 *    seeded by a shell script, because package version creation runs this
 *    suite in a fresh throwaway build org where that script never ran — and
 *    that is the run whose coverage number gates the release.
 *
 * 2. System.runAs enforces field-level and object-level permissions, not just
 *    record sharing. (The widely-repeated claim that it only does sharing is
 *    stale.) But it does so ONLY while the code under test runs in user mode.
 *    A service pinned below API 67, or one passing AccessLevel.SYSTEM_MODE,
 *    silently voids every assertion here without failing anything — which is
 *    why CI also greps for SYSTEM_MODE.
 */
@IsTest
private class GridSecurityTest {
    @TestSetup
    static void setup() {
        // Both users come from GridTestUsers, created here, not by seed.sh. The
        // limited user holds the restricted test access plus Rowhouse's own
        // packaged permission set, which every Rowhouse user needs because
        // profiles cannot grant a public controller (HR-1). The full user
        // writes the probe row and reads results back: at API 67 plain DML runs
        // in user mode, so the admin running the suite cannot be relied on to
        // see the test fields.
        GridTestUsers.limitedUser();
        System.runAs(GridTestUsers.fullUser()) {
            insert new Rowhouse_Test_Record__c(
                Name = 'FLS probe',
                Text_Field__c = 'visible and editable',
                Read_Only_Text__c = 'visible, not editable',
                Long_Text__c = 'must never reach the client',
                Decimal_Field__c = 42.00,
                Currency_Field__c = 500.00 // editable, but NOT in the column set
            );
        }
    }

    private static User limitedUser() {
        return [
            SELECT Id
            FROM User
            WHERE LastName = 'Limited' AND Alias = 'rhltd' AND IsActive = TRUE
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
    }

    /** Reads the probe row back with full field access. */
    private static Rowhouse_Test_Record__c probe() {
        User reader = [
            SELECT Id
            FROM User
            WHERE LastName = 'Full' AND Alias = 'rhfull' AND IsActive = TRUE
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        Rowhouse_Test_Record__c row;
        System.runAs(reader) {
            row = [
                SELECT Id, Text_Field__c, Read_Only_Text__c, Currency_Field__c, Long_Text__c
                FROM Rowhouse_Test_Record__c
                WHERE Name = 'FLS probe'
                LIMIT 1
            ];
        }
        return row;
    }

    @IsTest
    static void queryOmitsFieldsTheUserCannotRead() {
        Rowhouse_Test_Record__c row;
        System.runAs(limitedUser()) {
            Test.startTest();
            row = (Rowhouse_Test_Record__c) GridDataService.fetchPage(
                    new GridRequest(
                        'Rowhouse_Test_Record__c',
                        new List<String>{ 'Text_Field__c', 'Long_Text__c' }, // asks for both
                        null,
                        50
                    )
                )
                .rows[0];
            Test.stopTest();
        }
        System.assertEquals('visible and editable', row.Text_Field__c, 'A readable field must still come through.');
        System.assert(
            !row.getPopulatedFieldsAsMap().containsKey('Long_Text__c'),
            'An unreadable field leaked into the query result. Security-review failure.'
        );
    }

    @IsTest
    static void saveStripsAFieldTheUserCannotEdit() {
        Rowhouse_Test_Record__c rec = probe();
        GridSaveResult ticket;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Security_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => rec.Id,
                        'Text_Field__c' => 'changed legitimately',
                        'Read_Only_Text__c' => 'should be stripped'
                    }
                }
            );
            Test.stopTest();
        }
        Rowhouse_Test_Record__c after = probe();
        System.assertEquals('changed legitimately', after.Text_Field__c);
        System.assertEquals(
            'visible, not editable',
            after.Read_Only_Text__c,
            'A field the user cannot edit was written anyway.'
        );
        System.assert(
            ticket.strippedFields.contains('Read_Only_Text__c'),
            'Refused, but not by FLS. Read_Only_Text__c is an editable column of Security_Test, ' +
                'so the field-level security strip must be what stopped it: ' +
                ticket
        );
    }

    @IsTest
    static void saveRejectsAnEditableFieldThatIsNotInTheColumnSet() {
        // THE test for HR-6, and the distinction matters. Stripping a field the
        // user cannot READ only proves FLS works. HR-6 is about the allow-list:
        // Currency_Field__c is readable AND editable for this user, but it is
        // not in the configured column set, so a payload naming it must still be
        // refused. That is the case a reviewer asks about.
        Rowhouse_Test_Record__c rec = probe();
        GridSaveResult ticket;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Security_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => rec.Id,
                        'Text_Field__c' => 'in the column set',
                        'Currency_Field__c' => 999999 // editable, out of band
                    }
                }
            );
            Test.stopTest();
        }
        Rowhouse_Test_Record__c after = probe();
        System.assertEquals('in the column set', after.Text_Field__c);
        System.assertEquals(
            500.00,
            after.Currency_Field__c,
            'A field outside the configured column set was written from the client payload. ' +
            'FLS did not catch it because the user CAN edit it — only the allow-list can.'
        );
        System.assert(
            ticket.rejectedFields.contains('Currency_Field__c'),
            'Currency_Field__c must be refused by the allow-list, and reported as such: ' + ticket
        );
    }

    @IsTest
    static void saveAlsoStripsAFieldTheUserCannotRead() {
        // The FLS half, kept separate from the allow-list half above so a failure
        // says which mechanism broke.
        Rowhouse_Test_Record__c rec = probe();
        GridSaveResult ticket;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Security_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => rec.Id, 'Long_Text__c' => 'invisible to this user' }
                }
            );
            Test.stopTest();
        }
        System.assertEquals(
            'must never reach the client',
            probe().Long_Text__c,
            'An unreadable field from the client payload was written.'
        );
        System.assert(
            ticket.strippedFields.contains('Long_Text__c'),
            'Long_Text__c is an editable column of Security_Test, so FLS — not the allow-list — ' +
                'must be what refused it: ' +
                ticket
        );
    }

    @IsTest
    static void importStripsAFieldTheUserCannotWrite() {
        // Import writes through the same two gates as a save: the
        // allow-list, then field-level security, on an update (edit access) and
        // on a new record (create access). Read_Only_Text__c is an editable
        // column of Security_Test that this user can read but not write.
        Rowhouse_Test_Record__c rec = probe();
        GridImportService.Result result;
        System.runAs(limitedUser()) {
            Test.startTest();
            result = GridImportService.importRows(
                'Security_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => rec.Id,
                        'Text_Field__c' => 'imported',
                        'Read_Only_Text__c' => 'should be stripped'
                    },
                    new Map<String, Object>{
                        'Text_Field__c' => 'a new row',
                        'Read_Only_Text__c' => 'should be stripped too'
                    }
                }
            );
            Test.stopTest();
        }
        System.assert(result.rows[0].success && result.rows[1].success, String.valueOf(result.rows));
        Rowhouse_Test_Record__c after = probe();
        System.assertEquals('imported', after.Text_Field__c);
        System.assertEquals(
            'visible, not editable',
            after.Read_Only_Text__c,
            'A field the user cannot edit was imported anyway.'
        );
        System.assert(result.strippedFields.contains('Read_Only_Text__c'), String.valueOf(result));
        User reader = [
            SELECT Id
            FROM User
            WHERE LastName = 'Full' AND Alias = 'rhfull' AND IsActive = TRUE
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        System.runAs(reader) {
            Rowhouse_Test_Record__c made = [
                SELECT Text_Field__c, Read_Only_Text__c
                FROM Rowhouse_Test_Record__c
                WHERE Id = :result.rows[1].recordId
            ];
            System.assertEquals('a new row', made.Text_Field__c);
            System.assertEquals(
                null,
                made.Read_Only_Text__c,
                'A field the user cannot set on create was imported anyway.'
            );
        }
    }

    @IsTest
    static void deleteIsRefusedWhenTheUserLacksTheObjectPermission() {
        // The permission set sets allowDelete=false, so this is a real denial
        // rather than a hypothetical one. Test_Records allows mass delete,
        // so the configuration is not what refuses it.
        Rowhouse_Test_Record__c rec = probe();
        String message;
        System.runAs(limitedUser()) {
            Test.startTest();
            try {
                GridDeleteService.deleteRows('Test_Records', new List<Id>{ rec.Id });
            } catch (GridException e) {
                message = e.getMessage();
            }
            Test.stopTest();
        }
        System.assert(
            message != null && message.contains('permission to delete'),
            'Delete must be refused, by the object permission, without it: ' + message
        );
        System.assertEquals(rec.Id, probe().Id, 'The row must still be there.');
    }

    @IsTest
    static void groupingAndSubtotalsNeverReachAFieldTheUserCannotRead() {
        // Group_Test totals When (DateTime_Field__c) and shows Account
        // (Lookup_Field__c); this user can read neither.
        probe();
        System.runAs(limitedUser()) {
            GridConfig.Definition def = GridConfig.forUser('Group_Test');
            for (GridConfig.Column c : def.columns) {
                System.assert(
                    c.field != 'DateTime_Field__c' && c.field != 'Lookup_Field__c',
                    'Unreadable column sent: ' + c.field
                );
            }
            String refused;
            try {
                GridGroupService.summarize('Group_Test', null, new List<String>{ 'Lookup_Field__c' }, null, null);
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals('Cannot group by Lookup_Field__c.', refused);
            GridGroupService.Result result = GridGroupService.summarize(
                'Group_Test',
                null,
                new List<String>{ 'Picklist_Field__c' },
                null,
                null
            );
            System.assert(!result.groups.isEmpty(), 'The probe row is readable, so there is a group.');
            Map<String, Object> values = (Map<String, Object>) result.groups[0].get('v');
            System.assert(
                !values.containsKey('DateTime_Field__c'),
                'A subtotal of an unreadable field was sent: ' + values
            );
            System.assert(values.containsKey('Number_Field__c'), String.valueOf(values));
        }
    }
}
