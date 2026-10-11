/**
 * DEVELOPMENT ONLY. Never packaged.
 * Encrypted fields (Shield Platform Encryption, or classic Encrypted Text):
 * shown and edited as usual, never sorted, filtered, grouped, searched or
 * subtotalled, since SOQL cannot do those on them. Shield cannot be turned on
 * in the orgs this suite runs in, so a field is marked encrypted through
 * GridDescribe's test seam; what describe itself reports for a Shield field
 * is not tested here.
 */
@IsTest
private class GridEncryptedFieldsTest {
    private static final Schema.SObjectType TEST_RECORD = Rowhouse_Test_Record__c.SObjectType;

    private static GridConfig.Definition grid(String sortField) {
        return grid(sortField, false, true);
    }

    /** The test grid, logging its changes or not, its encrypted Text column editable or not. */
    private static GridConfig.Definition grid(String sortField, Boolean logChanges, Boolean textEditable) {
        return GridConfig.build(
            new Grid_Configuration__mdt(
                DeveloperName = 'Encrypted',
                MasterLabel = 'Encrypted',
                Object_API_Name__c = 'Rowhouse_Test_Record__c',
                Default_Sort_Field__c = sortField,
                Allow_Inline_Edit__c = true,
                Log_Changes__c = logChanges
            ),
            new List<Grid_Column__mdt>{
                new Grid_Column__mdt(
                    DeveloperName = 'Encrypted_Name',
                    Field_API_Name__c = 'Name',
                    Sort_Order__c = 10,
                    Editable__c = true,
                    Sortable__c = true
                ),
                new Grid_Column__mdt(
                    DeveloperName = 'Encrypted_Text',
                    Field_API_Name__c = 'Text_Field__c',
                    Sort_Order__c = 20,
                    Editable__c = textEditable,
                    Sortable__c = true,
                    Allow_Grouping__c = true,
                    Subtotal__c = 'count'
                )
            },
            new List<Grid_Format_Rule__mdt>(),
            new List<Grid_Child__mdt>(),
            new List<Grid_Action__mdt>()
        );
    }

    private static GridConfig.Column column(GridConfig.Definition def, String field) {
        for (GridConfig.Column c : def.columns) {
            if (c.field == field) {
                return c;
            }
        }
        return null;
    }

    @IsTest
    static void anEncryptedColumnIsShownAndEditedButNeverSortedFilteredGroupedOrSubtotalled() {
        GridDescribe.encryptedForTest.add('text_field__c');
        GridConfig.Definition def = grid('Name');
        GridConfig.Column text = column(def, 'Text_Field__c');
        System.assertEquals(true, text.encrypted);
        System.assertEquals(true, text.editable, 'Users who may edit it still do.');
        System.assertEquals(false, text.sortable);
        System.assertEquals(false, text.filterable);
        System.assertEquals(false, text.groupable, 'Allow Grouping does not make it groupable.');
        System.assertEquals(null, text.subtotal);
        Boolean warned = false;
        for (String w : def.warnings) {
            warned = warned || (w.startsWith('Grid Column Encrypted_Text: ') && w.contains('is encrypted'));
        }
        System.assert(warned, String.valueOf(def.warnings));

        GridConfig.Column name = column(def, 'Name');
        System.assertEquals(false, name.encrypted);
        System.assertEquals(true, name.sortable, 'Other columns as before.');
        System.assertEquals('Name', def.sortField);
    }

    @IsTest
    static void aGridThatLogsSaysAnEncryptedColumnsChangesAreLoggedWithoutValues() {
        GridDescribe.encryptedForTest.add('text_field__c');
        String logged = 'Its changes are logged without their old and new values.';
        String warning = warningFor(grid('Name', true, true));
        System.assert(warning.endsWith(logged), warning);
        System.assert(
            !warningFor(grid('Name', false, true)).contains(logged),
            'A grid that does not log says nothing of the log.'
        );
        System.assert(
            !warningFor(grid('Name', true, false)).contains(logged),
            'A column nobody edits writes no log entries.'
        );
    }

    /** The warning about the encrypted Text column. */
    private static String warningFor(GridConfig.Definition def) {
        for (String w : def.warnings) {
            if (w.startsWith('Grid Column Encrypted_Text: ')) {
                return w;
            }
        }
        System.assert(false, 'No warning about the encrypted column: ' + def.warnings);
        return null;
    }

    @IsTest
    static void anEncryptedDefaultSortFieldIsDroppedWithAWarning() {
        GridDescribe.encryptedForTest.add('text_field__c');
        GridConfig.Definition def = grid('Text_Field__c');
        System.assertEquals(null, def.sortField, 'The grid opens unsorted rather than failing.');
        Boolean warned = false;
        for (String w : def.warnings) {
            warned = warned || w.startsWith('Default Sort Field: ');
        }
        System.assert(warned, String.valueOf(def.warnings));
    }

    @IsTest
    static void searchLeavesEncryptedFieldsOut() {
        System.runAs(GridTestUsers.fullUser()) {
            searchesWithoutEncrypted();
        }
    }

    private static void searchesWithoutEncrypted() {
        Map<String, Object> binds = new Map<String, Object>();
        String before = GridDataService.searchCondition(
            TEST_RECORD,
            new List<String>{ 'Name', 'Text_Field__c' },
            'harbor',
            binds
        );
        System.assert(before.contains('Text_Field__c LIKE'), before);
        GridDescribe.encryptedForTest.add('text_field__c');
        String after = GridDataService.searchCondition(
            TEST_RECORD,
            new List<String>{ 'Name', 'Text_Field__c' },
            'harbor',
            new Map<String, Object>()
        );
        System.assert(!after.contains('Text_Field__c'), after);
        System.assert(after.contains('Name LIKE'), after);
    }

    @IsTest
    static void anAdminFilterOnAnEncryptedFieldStopsTheGridAndSaysWhy() {
        GridDescribe.encryptedForTest.add('text_field__c');
        try {
            GridFilters.fromRecords(
                new List<Grid_Filter__mdt>{
                    new Grid_Filter__mdt(
                        DeveloperName = 'On_Encrypted',
                        Field_API_Name__c = 'Text_Field__c',
                        Operator__c = 'equals',
                        Value__c = 'x'
                    )
                },
                TEST_RECORD
            );
            System.assert(false, 'A filter that cannot work must not be skipped: it would widen the grid.');
        } catch (GridException e) {
            System.assert(e.getMessage().contains('is encrypted, so the grid cannot filter on it'), e.getMessage());
        }
    }

    @IsTest
    static void describeDecidesWithoutTheSeam() {
        System.assertEquals(false, GridDescribe.isEncrypted(Rowhouse_Test_Record__c.Text_Field__c.getDescribe()));
        System.assertEquals(
            true,
            GridDescribe.subtotalFits('count', Rowhouse_Test_Record__c.Text_Field__c.getDescribe()),
            'Count fits an unencrypted text.'
        );
        GridDescribe.encryptedForTest.add('text_field__c');
        System.assertEquals(true, GridDescribe.isEncrypted(Rowhouse_Test_Record__c.Text_Field__c.getDescribe()));
        System.assertEquals(
            false,
            GridDescribe.subtotalFits('count', Rowhouse_Test_Record__c.Text_Field__c.getDescribe())
        );
        System.assertEquals(false, GridDescribe.isGroupable(Rowhouse_Test_Record__c.Text_Field__c.getDescribe()));
    }
}
