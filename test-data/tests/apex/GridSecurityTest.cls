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
            insert new Consignment__c(
                Name = 'Wachusett Paper, 18 pallets',
                Consignee__c = 'Wachusett Paper',
                Carrier_Code__c = 'GCFR',
                Delivery_Notes__c = 'Call Ruth Sargent before delivery; dock 3 closes at 4 pm.',
                Weight__c = 42.00,
                Freight_Charge__c = 500.00 // editable, but NOT in the column set
            );
        }
    }

    private static User limitedUser() {
        return [
            SELECT Id
            FROM User
            WHERE LastName = 'Thibodeau' AND Alias = 'rhltd' AND IsActive = TRUE
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
    }

    /** Reads the probe row back with full field access. */
    private static Consignment__c probe() {
        User reader = [
            SELECT Id
            FROM User
            WHERE LastName = 'Coffin' AND Alias = 'rhfull' AND IsActive = TRUE
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        Consignment__c row;
        System.runAs(reader) {
            row = [
                SELECT Id, Consignee__c, Carrier_Code__c, Freight_Charge__c, Delivery_Notes__c
                FROM Consignment__c
                WHERE Name = 'Wachusett Paper, 18 pallets'
                LIMIT 1
            ];
        }
        return row;
    }

    @IsTest
    static void queryOmitsFieldsTheUserCannotRead() {
        Consignment__c row;
        System.runAs(limitedUser()) {
            Test.startTest();
            row = (Consignment__c) GridDataService.fetchPage(
                    new GridRequest(
                        'Consignment__c',
                        new List<String>{ 'Consignee__c', 'Delivery_Notes__c' }, // asks for both
                        null,
                        50
                    )
                )
                .rows[0];
            Test.stopTest();
        }
        System.assertEquals('Wachusett Paper', row.Consignee__c, 'A readable field must still come through.');
        // By the field's token, not its name: in a namespaced org the result's
        // key is rowhouse__Delivery_Notes__c, so a name check would pass vacuously.
        System.assert(
            !row.isSet(Consignment__c.Delivery_Notes__c),
            'An unreadable field leaked into the query result. Security-review failure.'
        );
    }

    @IsTest
    static void saveStripsAFieldTheUserCannotEdit() {
        Consignment__c rec = probe();
        GridSaveResult ticket;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => rec.Id,
                        'Consignee__c' => 'Wachusett Paper Company',
                        'Carrier_Code__c' => 'NEFT'
                    }
                }
            );
            Test.stopTest();
        }
        Consignment__c after = probe();
        System.assertEquals('Wachusett Paper Company', after.Consignee__c);
        System.assertEquals('GCFR', after.Carrier_Code__c, 'A field the user cannot edit was written anyway.');
        System.assert(
            ticket.strippedFields.contains('Carrier_Code__c'),
            'Refused, but not by FLS. Carrier_Code__c is an editable column of Consignment_Charges, ' +
                'so the field-level security strip must be what stopped it: ' +
                ticket
        );
    }

    @IsTest
    static void saveRejectsAnEditableFieldThatIsNotInTheColumnSet() {
        // THE test for HR-6, and the distinction matters. Stripping a field the
        // user cannot READ only proves FLS works. HR-6 is about the allow-list:
        // Freight_Charge__c is readable AND editable for this user, but it is
        // not in the configured column set, so a payload naming it must still be
        // refused. That is the case a reviewer asks about.
        Consignment__c rec = probe();
        GridSaveResult ticket;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => rec.Id,
                        'Consignee__c' => 'Wachusett Paper, Fitchburg',
                        'Freight_Charge__c' => 999999 // editable, out of band
                    }
                }
            );
            Test.stopTest();
        }
        Consignment__c after = probe();
        System.assertEquals('Wachusett Paper, Fitchburg', after.Consignee__c);
        System.assertEquals(
            500.00,
            after.Freight_Charge__c,
            'A field outside the configured column set was written from the client payload. ' +
            'FLS did not catch it because the user CAN edit it — only the allow-list can.'
        );
        System.assert(
            ticket.rejectedFields.contains('Freight_Charge__c'),
            'Freight_Charge__c must be refused by the allow-list, and reported as such: ' + ticket
        );
    }

    @IsTest
    static void aRowWhoseEveryFieldIsRefusedIsNotWrittenAtAll() {
        // An update carrying only an Id still runs the org's triggers and flows
        // and stamps Last Modified. A row whose every field was refused, by the
        // allow-list or by field-level security, must queue nothing.
        Consignment__c rec = probe();
        GridSaveResult ticket;
        Integer queued;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => rec.Id, 'Freight_Charge__c' => 1 }, // not a column
                    new Map<String, Object>{ 'Id' => rec.Id, 'Delivery_Notes__c' => 'Use the side door.' } // stripped
                }
            );
            queued = Limits.getQueueableJobs();
            Test.stopTest();
        }
        System.assertEquals(0, queued, 'Nothing to write, so nothing is queued: ' + ticket);
        System.assertEquals(0, ticket.chunkCount, String.valueOf(ticket));
        System.assert(ticket.done, 'With nothing queued the save is done at once.');
        System.assertEquals(0, ticket.successCount, 'Nothing was saved, and the count says so.');
        System.assert(ticket.rejectedFields.contains('Freight_Charge__c'), String.valueOf(ticket));
        System.assert(ticket.strippedFields.contains('Delivery_Notes__c'), String.valueOf(ticket));
        Consignment__c after = probe();
        System.assertEquals(500.00, after.Freight_Charge__c);
        System.assertEquals('Call Ruth Sargent before delivery; dock 3 closes at 4 pm.', after.Delivery_Notes__c);
    }

    @IsTest
    static void aGridThatDoesNotEditCellsRefusesEverySave() {
        // Consignment_Directory marks its columns Editable but has Allow Inline Edit
        // off: that one setting must refuse the save before anything is queued.
        Consignment__c rec = probe();
        String refusal;
        Integer queued;
        System.runAs(limitedUser()) {
            Test.startTest();
            try {
                GridSaveService.save(
                    'Consignment_Directory',
                    new List<Map<String, Object>>{
                        new Map<String, Object>{ 'Id' => rec.Id, 'Consignee__c' => 'Wachusett Paper Co.' }
                    }
                );
            } catch (GridException e) {
                refusal = e.getMessage();
            }
            queued = Limits.getQueueableJobs();
            Test.stopTest();
        }
        System.assertEquals('This grid does not allow editing records.', refusal);
        System.assertEquals(0, queued, 'Nothing is queued for a grid that does not edit cells.');
        System.assertEquals('Wachusett Paper', probe().Consignee__c);
    }

    @IsTest
    static void saveAlsoStripsAFieldTheUserCannotRead() {
        // The FLS half, kept separate from the allow-list half above so a failure
        // says which mechanism broke.
        Consignment__c rec = probe();
        GridSaveResult ticket;
        System.runAs(limitedUser()) {
            Test.startTest();
            ticket = GridSaveService.save(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => rec.Id, 'Delivery_Notes__c' => 'Deliver after 2 pm only.' }
                }
            );
            Test.stopTest();
        }
        System.assertEquals(
            'Call Ruth Sargent before delivery; dock 3 closes at 4 pm.',
            probe().Delivery_Notes__c,
            'An unreadable field from the client payload was written.'
        );
        System.assert(
            ticket.strippedFields.contains('Delivery_Notes__c'),
            'Delivery_Notes__c is an editable column of Consignment_Charges, so FLS — not the allow-list — ' +
                'must be what refused it: ' +
                ticket
        );
    }

    @IsTest
    static void importStripsAFieldTheUserCannotWrite() {
        // Import writes through the same two gates as a save: the
        // allow-list, then field-level security, on an update (edit access) and
        // on a new record (create access). Carrier_Code__c is an editable
        // column of Consignment_Charges that this user can read but not write.
        Consignment__c rec = probe();
        GridImportService.Result result;
        System.runAs(limitedUser()) {
            Test.startTest();
            result = GridImportService.importRows(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => rec.Id,
                        'Consignee__c' => 'Wachusett Paper (Fitchburg mill)',
                        'Carrier_Code__c' => 'NEFT'
                    },
                    new Map<String, Object>{ 'Consignee__c' => 'Quabbin Supply', 'Carrier_Code__c' => 'CBMX' }
                }
            );
            Test.stopTest();
        }
        System.assert(result.rows[0].success && result.rows[1].success, String.valueOf(result.rows));
        Consignment__c after = probe();
        System.assertEquals('Wachusett Paper (Fitchburg mill)', after.Consignee__c);
        System.assertEquals('GCFR', after.Carrier_Code__c, 'A field the user cannot edit was imported anyway.');
        System.assert(result.strippedFields.contains('Carrier_Code__c'), String.valueOf(result));
        User reader = [
            SELECT Id
            FROM User
            WHERE LastName = 'Coffin' AND Alias = 'rhfull' AND IsActive = TRUE
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
        System.runAs(reader) {
            Consignment__c made = [
                SELECT Consignee__c, Carrier_Code__c
                FROM Consignment__c
                WHERE Id = :result.rows[1].recordId
            ];
            System.assertEquals('Quabbin Supply', made.Consignee__c);
            System.assertEquals(
                null,
                made.Carrier_Code__c,
                'A field the user cannot set on create was imported anyway.'
            );
        }
    }

    @IsTest
    static void deleteIsRefusedWhenTheUserLacksTheObjectPermission() {
        // The permission set sets allowDelete=false, so this is a real denial
        // rather than a hypothetical one. Consignments allows mass delete,
        // so the configuration is not what refuses it.
        Consignment__c rec = probe();
        String message;
        System.runAs(limitedUser()) {
            Test.startTest();
            try {
                GridDeleteService.deleteRows('Consignments', new List<Id>{ rec.Id });
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
        // Consignments_By_Mode totals When (Picked_Up__c) and shows Account
        // (Shipper__c); this user can read neither.
        probe();
        System.runAs(limitedUser()) {
            GridConfig.Definition def = GridConfig.forUser('Consignments_By_Mode');
            for (GridConfig.Column c : def.columns) {
                System.assert(
                    c.field != 'Picked_Up__c' && c.field != 'Shipper__c',
                    'Unreadable column sent: ' + c.field
                );
            }
            String refused;
            try {
                GridGroupService.summarize('Consignments_By_Mode', null, new List<String>{ 'Shipper__c' }, null, null);
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals('Cannot group by Shipper__c.', refused);
            GridGroupService.Result result = GridGroupService.summarize(
                'Consignments_By_Mode',
                null,
                new List<String>{ 'Service_Level__c' },
                null,
                null
            );
            System.assert(!result.groups.isEmpty(), 'The consignment is readable, so there is a group.');
            Map<String, Object> values = (Map<String, Object>) result.groups[0].get('v');
            System.assert(!values.containsKey('Picked_Up__c'), 'A subtotal of an unreadable field was sent: ' + values);
            System.assert(values.containsKey('Pieces__c'), String.valueOf(values));
        }
    }
}
