/**
 * DEVELOPMENT ONLY. Never packaged.
 * Record sharing, on the read path and the write path. Rowhouse runs every
 * query and every write in user mode, so the platform's sharing decides which
 * records a user reaches; these tests prove it with two users and records
 * that are private to one of them.
 *
 * Rowhouse_Test_Private__c is Private by organization-wide default (its
 * object metadata sets it, so a fresh build org starts that way) and no test
 * permission set grants View All or Modify All on it. fullUser() owns two
 * records: one kept to themselves ("Owner secret") and one shared with
 * peerUser() to read only ("Owner shared", a manual share). peerUser() owns
 * one ("Peer own"). The Private_Test grid (test-data/config) shows them:
 * Text can be grouped by, Amount is summed, Long Text is read whole, and
 * Related Record is a lookup to the same object.
 *
 * What is proved: the peer's rows, the count of every match, the group counts
 * and totals, the whole of a long text and the lookup search leave out the
 * owner's private record and include the shared one; and a save or an import
 * over a record the peer can only read, or cannot see, fails on its row and
 * changes nothing. Last, one user cannot read another's save result.
 */
@IsTest
private class GridSharingTest {
    private static final String SECRET = 'Owner secret';
    private static final String SHARED = 'Owner shared';
    private static final String PEER_OWN = 'Peer own';

    @TestSetup
    static void setup() {
        User owner = GridTestUsers.fullUser();
        User peer = GridTestUsers.peerUser();
        Rowhouse_Test_Private__c sharedRecord = new Rowhouse_Test_Private__c(
            Name = SHARED,
            Text_Field__c = 'Shared read only',
            Amount__c = 10,
            Long_Text__c = 'The peer may read this'
        );
        System.runAs(owner) {
            insert new List<Rowhouse_Test_Private__c>{
                new Rowhouse_Test_Private__c(
                    Name = SECRET,
                    Text_Field__c = 'Owner only',
                    Amount__c = 1000,
                    Long_Text__c = 'Not for the peer'
                ),
                sharedRecord
            };
            insert new Rowhouse_Test_Record__c(Name = 'Saved by the owner', Number_Field__c = 1);
        }
        System.runAs(peer) {
            insert new Rowhouse_Test_Private__c(Name = PEER_OWN, Text_Field__c = 'Peer only', Amount__c = 1);
        }
        // Shared with the peer to read only, as an admin shares a record from its
        // Sharing button. Rowhouse itself never writes a share.
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new Rowhouse_Test_Private__Share(
                ParentId = sharedRecord.Id,
                UserOrGroupId = peer.Id,
                AccessLevel = 'Read'
            );
        }
    }

    // ---------------------------------------------------------------- helpers

    private static User owner() {
        return GridTestUsers.built(GridTestUsers.FULL);
    }

    private static User peer() {
        return GridTestUsers.built(GridTestUsers.PEER);
    }

    /** The owner's records by name, read by the owner. */
    private static Map<String, Rowhouse_Test_Private__c> ownersRecords() {
        Map<String, Rowhouse_Test_Private__c> out = new Map<String, Rowhouse_Test_Private__c>();
        List<String> names = new List<String>{ SECRET, SHARED };
        System.runAs(owner()) {
            for (Rowhouse_Test_Private__c r : [
                SELECT Id, Name, Text_Field__c, Amount__c
                FROM Rowhouse_Test_Private__c
                WHERE Name IN :names
            ]) {
                out.put(r.Name, r);
            }
        }
        System.assertEquals(2, out.size(), 'The owner sees both of their own records: ' + out.keySet());
        return out;
    }

    private static Map<String, Object> page(String searchTerm) {
        // Each page as a request of its own: a cursor opened for one user is never another's.
        GridDataService.forgetOpenCursors();
        return GridController.fetchRows(
            'Private_Test',
            searchTerm,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
        );
    }

    private static Set<String> namesOf(Map<String, Object> page) {
        Set<String> out = new Set<String>();
        for (Map<String, Object> row : (List<Map<String, Object>>) page.get('rows')) {
            out.add((String) row.get('Name'));
        }
        return out;
    }

    /** Text value to record count, and the Amount total over every group. */
    private static Map<String, Integer> groupCounts(GridGroupService.Result result) {
        Map<String, Integer> out = new Map<String, Integer>();
        for (Map<String, Object> g : result.groups) {
            out.put(((List<String>) g.get('k'))[0], Integer.valueOf(String.valueOf(g.get('n'))));
        }
        return out;
    }

    private static Decimal amountTotal(GridGroupService.Result result) {
        Decimal total = 0;
        for (Map<String, Object> g : result.groups) {
            Map<String, Object> amount = (Map<String, Object>) ((Map<String, Object>) g.get('v')).get('Amount__c');
            total += Decimal.valueOf(String.valueOf(amount.get('s')));
        }
        return total;
    }

    // ---------------------------------------------------------------- reading

    @IsTest
    static void anotherUsersPrivateRecordIsNotInTheRows() {
        Map<String, Object> peersPage;
        Map<String, Object> peersSearch;
        Map<String, Object> ownersPage;
        System.runAs(peer()) {
            peersPage = page(null);
            peersSearch = page('Owner');
        }
        System.runAs(owner()) {
            ownersPage = page(null);
        }
        System.assertEquals(
            new Set<String>{ PEER_OWN, SHARED },
            namesOf(peersPage),
            'The peer sees their own record and the one shared with them, not the owner\'s private one.'
        );
        System.assertEquals(2, peersPage.get('totalRows'), 'The count leaves it out too.');
        System.assertEquals(
            new Set<String>{ SHARED },
            namesOf(peersSearch),
            'A search that the private record matches still does not find it.'
        );
        System.assertEquals(
            new Set<String>{ SECRET, SHARED },
            namesOf(ownersPage),
            'The owner sees both of their own, and not the peer\'s.'
        );
        System.assertEquals(2, ownersPage.get('totalRows'));
    }

    @IsTest
    static void theCountOfEveryMatchLeavesOutAnotherUsersPrivateRecord() {
        // A cursor holds at most maxCursorRows rows; a full one is followed by a
        // COUNT() of every match. One row makes this page take that path.
        GridDataService.maxCursorRows = 1;
        Map<String, Object> peersPage;
        System.runAs(peer()) {
            peersPage = page(null);
        }
        System.assertEquals(1, ((List<Map<String, Object>>) peersPage.get('rows')).size(), 'One row in the cursor.');
        System.assertEquals(
            2,
            peersPage.get('totalRows'),
            'The COUNT() of every match runs as the peer: 2, not the 3 records there are.'
        );
    }

    @IsTest
    static void anotherUsersPrivateRecordIsLeftOutOfGroupCountsAndTotals() {
        GridGroupService.Result peers;
        GridGroupService.Result owners;
        System.runAs(peer()) {
            peers = GridGroupService.summarize('Private_Test', null, new List<String>{ 'Text_Field__c' }, null, null);
        }
        System.runAs(owner()) {
            owners = GridGroupService.summarize('Private_Test', null, new List<String>{ 'Text_Field__c' }, null, null);
        }
        System.assertEquals(
            new Map<String, Integer>{ 'Peer only' => 1, 'Shared read only' => 1 },
            groupCounts(peers),
            'No group for the owner\'s private record, and no count of it.'
        );
        System.assertEquals(11, amountTotal(peers).intValue(), 'Its 1,000 is not in the peer\'s totals.');
        System.assertEquals(
            new Map<String, Integer>{ 'Owner only' => 1, 'Shared read only' => 1 },
            groupCounts(owners)
        );
        System.assertEquals(1010, amountTotal(owners).intValue(), 'Nor is the peer\'s in the owner\'s.');
    }

    @IsTest
    static void anotherUsersPrivateLongTextCannotBeReadWhole() {
        Map<String, Rowhouse_Test_Private__c> records = ownersRecords();
        String refused;
        String sharedText;
        System.runAs(peer()) {
            try {
                GridController.fetchFullText('Private_Test', records.get(SECRET).Id, 'Long_Text__c');
            } catch (AuraHandledException e) {
                refused = e.getMessage();
            }
            sharedText = GridController.fetchFullText('Private_Test', records.get(SHARED).Id, 'Long_Text__c');
        }
        System.assertEquals(
            'The record could not be found. It may have been deleted.',
            refused,
            'The record is read in user mode, so the peer is told nothing about it.'
        );
        System.assertEquals('The peer may read this', sharedText, 'A record shared with the peer is read.');
    }

    @IsTest
    static void aLookupFindsOnlyTheRecordsTheUserCanSee() {
        Map<String, Rowhouse_Test_Private__c> records = ownersRecords();
        List<Map<String, String>> found;
        Map<String, List<Map<String, String>>> named;
        String secretName;
        String sharedName;
        System.runAs(peer()) {
            found = GridController.searchLookup('Private_Test', 'Related__c', 'Owner');
            named = GridController.findLookupNames('Private_Test', 'Related__c', new List<String>{ SECRET, SHARED });
            secretName = GridController.lookupName('Private_Test', 'Related__c', records.get(SECRET).Id);
            sharedName = GridController.lookupName('Private_Test', 'Related__c', records.get(SHARED).Id);
        }
        Set<String> names = new Set<String>();
        for (Map<String, String> r : found) {
            names.add(r.get('name'));
        }
        System.assertEquals(new Set<String>{ SHARED }, names, 'The typeahead does not offer the private record.');
        System.assertEquals(
            new Set<String>{ SHARED.toLowerCase() },
            named.keySet(),
            'A pasted or imported name does not match the private record.'
        );
        System.assertEquals(null, secretName, 'Its name is not given out by its Id.');
        System.assertEquals(SHARED, sharedName);
    }

    // ---------------------------------------------------------------- writing

    @IsTest
    static void aSaveOverRecordsTheUserCanOnlyReadOrCannotSeeFailsOnEachRowAndChangesNothing() {
        Map<String, Rowhouse_Test_Private__c> records = ownersRecords();
        Id secretId = records.get(SECRET).Id;
        Id sharedId = records.get(SHARED).Id;
        GridSaveResult done;
        System.runAs(peer()) {
            Test.startTest();
            GridSaveResult ticket = GridSaveService.save(
                'Private_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => sharedId, 'Text_Field__c' => 'Changed by the peer' },
                    new Map<String, Object>{ 'Id' => secretId, 'Text_Field__c' => 'Changed by the peer' }
                }
            );
            Test.stopTest();
            done = GridSaveService.status(ticket.saveId);
        }
        System.assert(done.done, 'The chunk reported: ' + done);
        System.assertEquals(0, done.successCount, String.valueOf(done.errors));
        Set<Id> failed = new Set<Id>();
        for (GridSaveError e : done.errors) {
            failed.add(e.recordId);
            System.assert(String.isNotBlank(e.message), 'Each row says why: ' + done.errors);
        }
        System.assertEquals(new Set<Id>{ sharedId, secretId }, failed, 'Each row fails on its own: ' + done.errors);
        Map<String, Rowhouse_Test_Private__c> after = ownersRecords();
        System.assertEquals('Shared read only', after.get(SHARED).Text_Field__c, 'A record shared to read only.');
        System.assertEquals('Owner only', after.get(SECRET).Text_Field__c, 'A record the peer cannot see.');
    }

    @IsTest
    static void anImportOverRecordsTheUserCanOnlyReadOrCannotSeeFailsOnEachRowAndChangesNothing() {
        Map<String, Rowhouse_Test_Private__c> records = ownersRecords();
        GridImportService.Result result;
        System.runAs(peer()) {
            result = GridImportService.importRows(
                'Private_Test',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => records.get(SHARED).Id,
                        'Text_Field__c' => 'Imported by the peer'
                    },
                    new Map<String, Object>{ 'Id' => records.get(SECRET).Id, 'Text_Field__c' => 'Imported by the peer' }
                }
            );
        }
        System.assertEquals(2, result.rows.size());
        for (GridImportService.RowResult r : result.rows) {
            System.assertEquals(false, r.success, 'Row ' + r.index + ' was imported: ' + result.rows);
            System.assert(String.isNotBlank(r.message), 'Row ' + r.index + ' says why: ' + result.rows);
            System.assertEquals(null, r.previous, 'Nothing was read back for an Undo: ' + result.rows);
        }
        Map<String, Rowhouse_Test_Private__c> after = ownersRecords();
        System.assertEquals('Shared read only', after.get(SHARED).Text_Field__c);
        System.assertEquals('Owner only', after.get(SECRET).Text_Field__c);
    }

    // ---------------------------------------------------------------- save results

    @IsTest
    static void oneUserCannotReadAnotherUsersSaveResult() {
        GridSaveResult ticket;
        Id saved;
        System.runAs(owner()) {
            saved = [SELECT Id FROM Rowhouse_Test_Record__c WHERE Name = 'Saved by the owner' LIMIT 1].Id;
            Test.startTest();
            ticket = GridSaveService.save(
                'Save_Test',
                new List<Map<String, Object>>{ new Map<String, Object>{ 'Id' => saved, 'Number_Field__c' => '2' } }
            );
            Test.stopTest(); // the chunk runs and writes its result, owned by the owner
        }
        System.assert(String.isNotBlank(ticket.saveId), String.valueOf(ticket));
        GridSaveResult peerSees;
        GridSaveResult peerSeesThroughTheController;
        Integer peerReads;
        System.runAs(peer()) {
            peerSees = GridSaveService.status(ticket.saveId);
            peerSeesThroughTheController = GridController.saveStatus(ticket.saveId);
            peerReads = GridSecurity.countQuery(
                'SELECT COUNT() FROM Grid_Save_Result__c WHERE Save_Id__c = :saveId',
                new Map<String, Object>{ 'saveId' => ticket.saveId }
            );
        }
        for (GridSaveResult r : new List<GridSaveResult>{ peerSees, peerSeesThroughTheController }) {
            System.assertEquals(false, r.done, 'Another user\'s save is never done for the peer: ' + r);
            System.assertEquals(0, r.chunksReported, String.valueOf(r));
            System.assertEquals(0, r.successCount, String.valueOf(r));
            System.assert(r.errors.isEmpty(), 'No error of another user\'s save reaches the peer: ' + r);
        }
        System.assertEquals(0, peerReads, 'The result records are private to the user who saved.');
        GridSaveResult ownerSees;
        System.runAs(owner()) {
            ownerSees = GridSaveService.status(ticket.saveId);
            System.assertEquals(
                2,
                [SELECT Number_Field__c FROM Rowhouse_Test_Record__c WHERE Id = :saved].Number_Field__c
            );
        }
        System.assert(ownerSees.done, 'The peer\'s poll took nothing away from the owner: ' + ownerSees);
        System.assertEquals(1, ownerSees.successCount, String.valueOf(ownerSees.errors));
    }
}
