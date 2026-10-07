/**
 * DEVELOPMENT ONLY. Never packaged.
 * A long text the grid shows shortened (TC-055: its first 1,000 characters and
 * "…") is never written back as if it were the whole text (review, 1 Oct
 * 2026): not by a save (a shortened cell pasted elsewhere), not by an import
 * (an exported file imported again). Security_Test (test-data/config) has
 * Long_Text__c as an editable column and allows import.
 */
@IsTest
private class GridLongTextTest {

    private static final Integer PREVIEW = GridController.LONG_TEXT_PREVIEW;

    private static String longText(String seed) {
        return (seed + ' ').repeat(400).trim(); // Salesforce drops a trailing space when it stores a text
    }

    /** What the grid shows of a long text. */
    private static String shortened(String whole) {
        return whole.left(PREVIEW) + '…';
    }

    private static Rowhouse_Test_Record__c record(String name, String text) {
        // Text_Field__c too: Security_Test has no Name column, and search reads its columns.
        Rowhouse_Test_Record__c r = new Rowhouse_Test_Record__c(Name = name, Text_Field__c = name, Long_Text__c = text);
        insert r;
        return r;
    }

    private static String storedText(Id recordId) {
        return [SELECT Long_Text__c FROM Rowhouse_Test_Record__c WHERE Id = :recordId].Long_Text__c;
    }

    @IsTest
    static void aSaveNeverWritesTheShortenedCopy() {
        System.runAs(GridTestUsers.fullUser()) {
            String whole = longText('alpha');
            Rowhouse_Test_Record__c unchanged = record('LT unchanged', whole);
            Rowhouse_Test_Record__c changed = record('LT changed', whole);
            String shortText = 'short';
            Rowhouse_Test_Record__c ownValue = record('LT own value', shortText);
            String ownForm = 'x'.repeat(PREVIEW) + '…'; // the shortened form, typed over a short text

            Test.startTest();
            GridSaveResult ticket = GridSaveService.save('Security_Test', new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => unchanged.Id, 'Long_Text__c' => shortened(whole), 'Text_Field__c' => 'LT unchanged 2' },
                new Map<String, Object>{ 'Id' => changed.Id, 'Long_Text__c' => 'EDITED' + shortened(whole).substring(6) },
                new Map<String, Object>{ 'Id' => ownValue.Id, 'Long_Text__c' => ownForm }
            });
            Test.stopTest();

            System.assertEquals(1, ticket.errors.size(), String.valueOf(ticket.errors));
            System.assertEquals(changed.Id, ticket.errors[0].recordId);
            System.assertEquals('Long_Text__c', ticket.errors[0].fieldName);
            System.assertEquals(GridSaveService.SHORTENED_MESSAGE, ticket.errors[0].message);

            System.assertEquals(whole, storedText(unchanged.Id), 'The unchanged shortened copy is left out of the write.');
            System.assertEquals('LT unchanged 2', [SELECT Text_Field__c FROM Rowhouse_Test_Record__c WHERE Id = :unchanged.Id]
                .Text_Field__c, 'The rest of the row is saved.');
            System.assertEquals(whole, storedText(changed.Id), 'A changed shortened copy is refused, not saved.');
            System.assertEquals(ownForm, storedText(ownValue.Id), 'Over a text that is not longer, the value is the user\'s own.');
        }
    }

    @IsTest
    static void anImportNeverWritesTheShortenedCopy() {
        System.runAs(GridTestUsers.fullUser()) {
            String whole = longText('beta');
            Rowhouse_Test_Record__c unchanged = record('LT import unchanged', whole);
            Rowhouse_Test_Record__c changed = record('LT import changed', whole);

            Test.startTest();
            GridImportService.Result result = GridImportService.importRows('Security_Test', new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => unchanged.Id, 'Long_Text__c' => shortened(whole), 'Text_Field__c' => 'LT renamed' },
                new Map<String, Object>{ 'Id' => changed.Id, 'Long_Text__c' => 'Edited ' + shortened(whole).substring(7) },
                new Map<String, Object>{ 'Text_Field__c' => 'LT created', 'Long_Text__c' => shortened(whole) }
            });
            Test.stopTest();

            System.assert(result.rows[0].success, String.valueOf(result.rows[0]));
            System.assertEquals(whole, storedText(unchanged.Id), 'Exported and imported again, the whole text stays.');
            System.assertEquals('LT renamed', [SELECT Text_Field__c FROM Rowhouse_Test_Record__c WHERE Id = :unchanged.Id].Text_Field__c);

            System.assert(!result.rows[1].success, 'A changed shortened copy fails its row.');
            System.assertEquals('Long_Text__c', result.rows[1].fieldName);
            System.assert(result.rows[1].message.contains(GridSaveService.SHORTENED_MESSAGE), result.rows[1].message);
            System.assertEquals(whole, storedText(changed.Id));

            System.assert(result.rows[2].success && result.rows[2].created, 'A new record has no whole text to keep: '
                + String.valueOf(result.rows[2]));
        }
    }

    @IsTest
    static void aTextOfExactlyOneMoreCharacterIsMarkedShortened() {
        System.runAs(GridTestUsers.fullUser()) {
            // Shortened, it is as long as before: 1,000 characters and "…".
            String text = 'y'.repeat(PREVIEW + 1);
            record('LT 1001', text);
            Map<String, Object> result = GridController.fetchRows('Security_Test', 'LT 1001', null, null, null, null, null,
                null, null, null, null, null);
            List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get('rows');
            System.assertEquals(1, rows.size());
            System.assertEquals(shortened(text), rows[0].get('Long_Text__c'));
            System.assertEquals(new List<String>{ 'Long_Text__c' }, rows[0].get('_cut'), 'Its editor reads the whole text first.');
        }
    }
}
