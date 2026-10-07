/**
 * DEVELOPMENT ONLY. Never packaged.
 * Cursor paging and sort ordering.
 *
 * WHY THIS EXISTS
 * Database.PaginationCursor is snapshot-stable and documented to skip rows
 * deleted after the cursor opens. Both properties are load-bearing for a grid
 * and neither is something to assume — the deleted-row behaviour in particular
 * is not spelled out anywhere, so this test is how it gets answered rather
 * than argued about.
 *
 * Queries run in user mode, so every test that reads data runs as
 * GridTestUsers.fullUser(): what it can see comes from permission sets alone,
 * not from whoever runs the suite.
 */
@IsTest
private class GridDataServiceTest {

    @TestSetup
    static void setup() {
        // At API 67 plain DML runs in user mode too, so even the seed rows are
        // written by a user with field access, never by whoever runs the suite.
        System.runAs(GridTestUsers.fullUser()) {
            List<Rowhouse_Test_Record__c> recs = new List<Rowhouse_Test_Record__c>();
            for (Integer i = 1; i <= 550; i++) {
                recs.add(new Rowhouse_Test_Record__c(
                    Name = String.valueOf(1000 + i), Number_Field__c = i));
            }
            insert recs;
        }
    }

    @IsTest
    static void pagesThroughEveryRecordExactlyOnce() {
        System.runAs(GridTestUsers.fullUser()) {
            Set<Id> seen = new Set<Id>();
            Test.startTest();
            GridPage page = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, null, 200));
            while (true) {
                for (SObject r : page.rows) {
                    System.assert(seen.add(r.Id), 'Record returned twice: ' + r.Id);
                }
                if (!page.hasMore) break;
                page = GridDataService.fetchPage(
                    new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' },
                                    page.cursorLocator, 200));
            }
            Test.stopTest();
            System.assertEquals(550, seen.size(), 'Paging lost or repeated records.');
        }
    }

    @IsTest
    static void deletingARowMidCursorDoesNotShiftThePage() {
        System.runAs(GridTestUsers.fullUser()) {
            User owner = new User(Id = [SELECT OwnerId FROM Rowhouse_Test_Record__c LIMIT 1].OwnerId);
            // If deleted rows are skipped
            // cleanly, page 2 has no gap and no duplicate. If this fails, paging
            // needs its own reconciliation and the design changes.
            Test.startTest();
            GridPage first = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, null, 200));

            // Someone else deletes rows while this user pages: the seed rows'
            // owner, since deleting a record needs ownership, not just edit access.
            System.runAs(owner) {
                delete [SELECT Id FROM Rowhouse_Test_Record__c WHERE Number_Field__c > 250 AND Number_Field__c <= 260];
            }

            GridPage second = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' },
                                first.cursorLocator, 200));
            Test.stopTest();

            Set<Id> firstIds = new Map<Id, SObject>(first.rows).keySet();
            for (SObject r : second.rows) {
                System.assert(!firstIds.contains(r.Id),
                    'Page 2 repeated a record from page 1 after a mid-cursor delete.');
            }
        }
    }

    @IsTest
    static void nullsSortLastOnAscending() {
        System.runAs(GridTestUsers.fullUser()) {
            insert new Rowhouse_Test_Record__c(Name = 'null sort probe');  // Number_Field__c null
            Test.startTest();
            GridPage page = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Number_Field__c' },
                                null, 600).orderBy('Number_Field__c', 'asc'));
            Test.stopTest();
            // NOTE: NULLS FIRST is the SOQL default for ASC, so this passes only if
            // the service emits an explicit NULLS LAST. This asserts a Rowhouse
            // requirement, not platform behaviour — TC-049 to TC-054 assert the same
            // rule client-side, and the two must agree.
            Rowhouse_Test_Record__c last = (Rowhouse_Test_Record__c) page.rows[page.rows.size() - 1];
            System.assertEquals(null, last.Number_Field__c, 'Nulls must sort last on ascending.');
        }
    }

    @IsTest
    static void makesNoCallouts() {
        System.runAs(GridTestUsers.fullUser()) {
            // HR-9. Two mechanisms, and the first is the real one: Test.setMock is
            // deliberately NOT configured, so any callout at all throws here.
            //
            // The Limits assertion must be read INSIDE the start/stop window. Code
            // after Test.stopTest() is assigned the limits that were in effect
            // before startTest, so a read there measures the outer context and
            // passes regardless of what the service did.
            Test.startTest();
            GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, null, 10));
            Integer callouts = Limits.getCallouts();
            Test.stopTest();
            System.assertEquals(0, callouts, 'Rowhouse must make no callouts.');
        }
    }

    @IsTest
    static void pagingStaysWithinTheTenFetchCallsPerTransaction() {
        System.runAs(GridTestUsers.fullUser()) {
            // The limit is 100 fetch calls per transaction,
            // not 10 — the Apex Cursors guide says so, and a Developer Edition org reports
            // Limits.getLimitFetchCallsOnApexCursor() = 100. This test keeps its
            // stricter ten-call budget on purpose: walking the 550-record seed in
            // 200-row pages must stay small, and a regression to per-row paging
            // fails here with a clear message instead of a governor exception.
            Test.startTest();
            Integer fetches = 0;
            GridPage page = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, null, 200));
            fetches++;
            while (page.hasMore && fetches < 10) {
                page = GridDataService.fetchPage(
                    new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' },
                                    page.cursorLocator, 200));
                fetches++;
            }
            Test.stopTest();
            System.assert(fetches < 10,
                'Walking the seed data consumed ' + fetches + ' of 10 fetch calls. '
                + 'Either reduce the seed size or page in a larger chunk.');
            System.assert(!page.hasMore, 'Ran out of fetch calls before reaching the last page.');
        }
    }

    @IsTest
    static void theFetchCallLimitIsWhatThePlatformReports() {
        // Pins the corrected number, so the next person to quote "ten" finds out.
        System.assertEquals(100, Limits.getLimitFetchCallsOnApexCursor(),
            'The per-transaction cursor fetch limit has changed.');
    }

    @IsTest
    static void quickSearchBindsTheTermAndEscapesWildcards() {
        System.runAs(GridTestUsers.fullUser()) {
            // TC-021. The term
            // carries a quote, a backslash, double quotes and both LIKE wildcards. If
            // it were concatenated into the SOQL, the quote would break the query; if
            // the wildcards were not escaped, "%" would match every row.
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(Name = 'TC-021 probe', Text_Field__c = 'O\'Brien \\ "quoted" %wildcard%_'),
                new Rowhouse_Test_Record__c(Name = 'wildcard decoy', Text_Field__c = 'wildcard without percent signs')
            };
            Test.startTest();
            GridPage quoted = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name', 'Text_Field__c' }, null, 50)
                    .withSearch('O\'Brien \\'));
            GridPage wildcard = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name', 'Text_Field__c' }, null, 50)
                    .withSearch('%wildcard%_'));
            GridPage percentOnly = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name', 'Text_Field__c' }, null, 50)
                    .withSearch('%'));
            Test.stopTest();

            System.assertEquals(1, quoted.rows.size(), 'A quote and a backslash must be searchable, not a syntax error.');
            System.assertEquals(1, wildcard.rows.size(), '"%wildcard%_" must match the literal text only, not the decoy.');
            System.assertEquals('TC-021 probe', (String) wildcard.rows[0].get('Name'));
            System.assertEquals(1, percentOnly.rows.size(), 'A bare "%" is a literal percent sign, not "match everything".');
        }
    }

    // ------------------------------------------------ one cursor per query
    //
    // Opening a cursor charges the org for every row of the result, so the
    // second page must continue on the first page's cursor, handed back by the
    // browser as a token, rather than open another. forgetOpenCursors() stands
    // in for the gap between two requests.

    private static GridRequest nameRequest(String locator, String token) {
        return new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, locator, 200)
            .orderBy('Name', 'asc').withCursor(token);
    }

    @IsTest
    static void theNextPageContinuesOnTheCursorTheBrowserHandsBack() {
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridPage first = GridDataService.fetchPage(nameRequest(null, null));
            System.assertEquals(1, Limits.getApexPaginationCursors());
            System.assert(String.isNotBlank(first.cursorToken), 'The first page hands out its cursor.');
            GridDataService.forgetOpenCursors();
            GridPage second = GridDataService.fetchPage(nameRequest(first.cursorLocator, first.cursorToken));
            System.assertEquals(1, Limits.getApexPaginationCursors(), 'The second page opened another cursor.');
            Test.stopTest();
            System.assertEquals('1201', (String) second.rows[0].get('Name'));
            System.assertEquals(first.cursorToken, second.cursorToken);
        }
    }

    @IsTest
    static void withoutTheTokenTheNextPageOpensAnotherCursor() {
        // The control for the test above: it proves the count moves at all.
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridPage first = GridDataService.fetchPage(nameRequest(null, null));
            GridDataService.forgetOpenCursors();
            GridPage second = GridDataService.fetchPage(nameRequest(first.cursorLocator, null));
            System.assertEquals(2, Limits.getApexPaginationCursors());
            Test.stopTest();
            System.assertEquals('1201', (String) second.rows[0].get('Name'));
        }
    }

    @IsTest
    static void aTokenThatIsNotAUsableCursorCostsACursorNeverAWrongPage() {
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridPage first = GridDataService.fetchPage(nameRequest(null, null));
            for (String bad : new List<String>{ 'not json', '{"queryId":"0r8xx5vwXXr9Zz9"}', '[]' }) {
                GridDataService.forgetOpenCursors();
                GridPage second = GridDataService.fetchPage(nameRequest(first.cursorLocator, bad));
                System.assertEquals('1201', (String) second.rows[0].get('Name'), 'Token ' + bad);
                System.assertNotEquals(bad, second.cursorToken, 'A fresh cursor is handed out instead.');
            }
            Test.stopTest();
        }
    }

    @IsTest
    static void aWrongRowCountInTheLocatorCostsACursorNeverAWrongPage() {
        // The locator carries the row count so that a handed-back cursor can be
        // fetched from before it is asked for its count (see GridDataService.fill).
        // A count that is too high runs the last fetch past the end; that must
        // fall back to a fresh cursor, not fail.
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridPage first = GridDataService.fetchPage(nameRequest(null, null));
            GridPage second = GridDataService.fetchPage(nameRequest(first.cursorLocator, first.cursorToken));
            String forged = second.cursorLocator.substringBeforeLast(':') + ':99999';
            GridDataService.forgetOpenCursors();
            GridPage last = GridDataService.fetchPage(nameRequest(forged, second.cursorToken));
            Test.stopTest();
            System.assertEquals(150, last.rows.size());
            System.assertEquals('1401', (String) last.rows[0].get('Name'));
            System.assertEquals(550, last.totalRows);
            System.assert(!last.hasMore);
        }
    }

    @IsTest
    static void aCursorFromAnotherQueryIsRefused() {
        // HR-6: a real cursor, this user's own, but opened for a query with
        // another select list. Its rows must not come back through this one.
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            GridPage wider = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name', 'Number_Field__c' }, null, 200)
                    .orderBy('Name', 'asc'));
            GridPage first = GridDataService.fetchPage(nameRequest(null, null));
            GridDataService.forgetOpenCursors();
            try {
                GridDataService.fetchPage(nameRequest(first.cursorLocator, wider.cursorToken));
                System.assert(false, 'A cursor for another select list was accepted.');
            } catch (GridException e) {
                System.assertEquals(GridDataService.FOREIGN_LOCATOR, e.getMessage());
            }
            Test.stopTest();
        }
    }

    @IsTest
    static void anotherUsersCursorIsNeverUsed() {
        User owner = GridTestUsers.fullUser();
        User other = GridTestUsers.fullUser();
        GridPage first;
        System.runAs(owner) {
            first = GridDataService.fetchPage(nameRequest(null, null));
        }
        GridDataService.forgetOpenCursors();
        System.runAs(other) {
            Test.startTest();
            // The platform refuses it ("Only the user who executed the original
            // query can access additional results"); the page comes from a fresh
            // cursor opened as this user.
            GridPage second = GridDataService.fetchPage(nameRequest(first.cursorLocator, first.cursorToken));
            System.assertEquals(1, Limits.getApexPaginationCursors());
            Test.stopTest();
            System.assertEquals('1201', (String) second.rows[0].get('Name'));
            System.assertNotEquals(first.cursorToken, second.cursorToken);
        }
    }

    @IsTest
    static void aLocatorFromAnotherQueryIsRefused() {
        System.runAs(GridTestUsers.fullUser()) {
            GridPage first = GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name' }, null, 10));
            Boolean refused = false;
            try {
                GridDataService.fetchPage(
                    new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'Name', 'Number_Field__c' },
                                    first.cursorLocator, 10));
            } catch (GridException e) {
                refused = true;
            }
            System.assert(refused, 'A cursor locator must only be accepted by the query that produced it.');
        }
    }

    @IsTest
    static void anUnknownFieldFailsWithItsName() {
        try {
            GridDataService.fetchPage(
                new GridRequest('Rowhouse_Test_Record__c', new List<String>{ 'No_Such_Field__c' }, null, 10));
            System.assert(false, 'Expected an exception.');
        } catch (GridException e) {
            System.assert(e.getMessage().contains('No_Such_Field__c'), e.getMessage());
        }
    }
}
