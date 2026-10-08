/**
 * DEVELOPMENT ONLY. Never packaged.
 * GridConfig — configuration parsing.
 * Uses the fixture configurations in test-data/config.
 */
@IsTest
private class GridConfigTest {
    @IsTest
    static void loadsColumnsInSortOrderWithDescribeDetail() {
        GridConfig.Definition def = GridConfig.load('Test_Records');
        System.assertEquals('Rowhouse_Test_Record__c', def.objectApiName);
        System.assertEquals('Test Records', def.label, 'The label is the grid title.');
        System.assertEquals(16, def.columns.size(), 'Test_Records has sixteen columns.');
        System.assertEquals('Name', def.columns[0].field, 'Sort_Order__c 1 comes first.');
        for (Integer i = 1; i < def.columns.size(); i++) {
            System.assertNotEquals(def.columns[i - 1].field, def.columns[i].field);
        }
        GridConfig.Column currencyCol;
        GridConfig.Column formulaCol;
        GridConfig.Column picklistCol;
        for (GridConfig.Column c : def.columns) {
            if (c.field == 'Currency_Field__c')
                currencyCol = c;
            if (c.field == 'Formula_Number__c')
                formulaCol = c;
            if (c.field == 'Picklist_Field__c')
                picklistCol = c;
        }
        System.assertEquals('currency', currencyCol.type);
        System.assertEquals(2, currencyCol.scale);
        System.assertEquals(false, formulaCol.editable, 'A formula is read-only by type, whatever the config says.');
        System.assertEquals(3, picklistCol.options.size(), 'Active values only: Alpha, Beta, Gamma.');
        for (GridConfig.Column c : def.columns) {
            if (c.field == 'Name') {
                // The schema calls a text Name nillable; users and the grid do not.
                System.assertEquals(true, c.required, 'Name must be required.');
            }
            // Wrap_Text__c is set on the Test Case column only; unset means clip.
            System.assertEquals(c.field == 'Test_Case__c', c.wrap, 'Wrap default for ' + c.field);
            // Always_Shown__c is set on the Name column only.
            System.assertEquals(c.field == 'Name', c.alwaysShown, 'Always Shown for ' + c.field);
        }
        System.assertEquals(200, def.pageSize);
        System.assertEquals(1, def.frozenColumns, 'Test_Records freezes its Name column.');
        System.assertEquals(null, def.height, 'No Height: the grid fills the window.');
        System.assertEquals(320, GridConfig.load('Save_Test').height, 'A Height is passed on in pixels.');
        System.assertEquals('asc', def.sortDirection);
        System.assertEquals(true, def.showRowNumbers, 'Checked: the rows are numbered.');
    }

    @IsTest
    static void showRowNumbersIsPassedOn() {
        GridConfig.Definition def = GridConfig.build(
            new Grid_Configuration__mdt(
                DeveloperName = 'No_Numbers',
                MasterLabel = 'No Numbers',
                Object_API_Name__c = 'Rowhouse_Test_Record__c',
                Show_Row_Numbers__c = false
            ),
            new List<Grid_Column__mdt>{
                new Grid_Column__mdt(DeveloperName = 'No_Numbers_Name', Field_API_Name__c = 'Name', Sort_Order__c = 10)
            },
            new List<Grid_Format_Rule__mdt>(),
            new List<Grid_Child__mdt>(),
            new List<Grid_Action__mdt>()
        );
        System.assertEquals(false, def.showRowNumbers, 'Unchecked: no row numbers.');
    }

    @IsTest
    static void lookupsOwnersAndPicklistDependenciesAreDescribed() {
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : GridConfig.load('Test_Records').columns) {
            byField.put(c.field, c);
        }
        System.assertEquals('reference', byField.get('Lookup_Field__c').type);
        System.assertEquals(new List<String>{ 'Account' }, byField.get('Lookup_Field__c').referenceTo);
        System.assertEquals('owner', byField.get('OwnerId').type, 'OwnerId is an owner, not a plain lookup.');
        System.assert(byField.get('OwnerId').referenceTo.contains('User'));
        System.assertEquals('multipicklist', byField.get('Multi_Picklist__c').type);
        System.assertEquals(5, byField.get('Multi_Picklist__c').options.size());
        for (
            String f : new List<String>{ 'Lookup_Field__c', 'OwnerId', 'Multi_Picklist__c', 'Dependent_Picklist__c' }
        ) {
            System.assertEquals(true, byField.get(f).editable, f + ' has an editor now.');
        }

        GridConfig.Column dependent = byField.get('Dependent_Picklist__c');
        System.assertEquals('Controlling_Picklist__c', dependent.dependentOn);
        Map<String, Object> validFor = new Map<String, Object>();
        for (Map<String, Object> o : dependent.options) {
            validFor.put((String) o.get('value'), o.get('validFor'));
        }
        System.assertEquals(new List<String>{ 'Hardware' }, validFor.get('Keyboard'));
        System.assertEquals(new List<String>{ 'Hardware' }, validFor.get('Monitor'));
        System.assertEquals(new List<String>{ 'Software' }, validFor.get('Licence'));
        System.assertEquals(null, byField.get('Controlling_Picklist__c').dependentOn);
        System.assertEquals(
            null,
            byField.get('Picklist_Field__c').options[0].get('validFor'),
            'Only dependent values carry validFor.'
        );
    }

    @IsTest
    static void validForReadsOneBitPerControllingValueMostSignificantFirst() {
        List<String> nine = new List<String>{ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i' };
        System.assertEquals(new List<String>{ 'a' }, GridDescribe.validFor('gAAA', nine), '0x80: the first value.');
        System.assertEquals(new List<String>{ 'b' }, GridDescribe.validFor('QAAA', nine), '0x40: the second.');
        System.assertEquals(new List<String>{ 'a', 'b' }, GridDescribe.validFor('wAAA', nine), '0xC0: both.');
        System.assertEquals(
            new List<String>{ 'i' },
            GridDescribe.validFor('AIAA', nine),
            'The ninth is in the second byte.'
        );
        System.assertEquals(new List<String>(), GridDescribe.validFor(null, nine));
    }

    @IsTest
    static void theControllingFieldIsReadOnceEvenWhenItIsAColumn() {
        List<String> names = GridConfig.load('Test_Records').fieldNames();
        Integer count = 0;
        for (String n : names) {
            if (n == 'Controlling_Picklist__c')
                count++;
        }
        System.assertEquals(1, count, String.valueOf(names));
    }

    @IsTest
    static void theAllowListIsTheAdminsEditableColumns() {
        Set<String> allowed = GridConfig.load('Security_Test').editableFields();
        System.assertEquals(new Set<String>{ 'text_field__c', 'read_only_text__c', 'long_text__c' }, allowed);
        System.assert(
            !allowed.contains('currency_field__c'),
            'Not a column of Security_Test, so never writable through it.'
        );
    }

    @IsTest
    static void longTextIsEditableSinceItsEditorReadsTheWholeText() {
        // TC-055 still shortens long text in the rows; its editor
        // reads the whole value first (GridController.fetchFullText), so the
        // shortened copy is never what is saved, and the column is offered.
        GridConfig.Column longText;
        for (GridConfig.Column c : GridConfig.load('Security_Test').columns) {
            if (c.field == 'Long_Text__c')
                longText = c;
        }
        System.assertEquals(true, longText.adminEditable);
        System.assertEquals(true, longText.editable);
        System.assertEquals(
            'text',
            longText.type,
            'The fixture shows it as text (Cell Type); its editor still reads the whole value.'
        );
    }

    @IsTest
    static void aLookupIsHeadedByWhatItPointsTo() {
        // Describe labels standard lookups "Account ID", "Owner ID".
        System.assertEquals('Account', GridConfig.defaultLabel(Contact.AccountId.getDescribe()));
        System.assertEquals('Owner', GridConfig.defaultLabel(Rowhouse_Test_Record__c.OwnerId.getDescribe()));
        System.assertEquals(
            'Related Account',
            GridConfig.defaultLabel(Rowhouse_Test_Record__c.Lookup_Field__c.getDescribe()),
            'A custom lookup has no " ID" to drop.'
        );
        System.assertEquals(
            'Number Field',
            GridConfig.defaultLabel(Rowhouse_Test_Record__c.Number_Field__c.getDescribe())
        );
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : GridConfig.load('Test_Records').columns) {
            byField.put(c.field, c);
        }
        System.assert(!byField.get('OwnerId').label.endsWith(' ID'), byField.get('OwnerId').label);
    }

    @IsTest
    static void dateTimesTimesAndTextAreasHaveEditors() {
        // Each has its editor.
        System.assert(GridConfig.EDITABLE_TYPES.containsAll(new Set<String>{ 'datetime', 'time', 'textarea' }));
    }

    @IsTest
    static void anUnknownConfigurationFailsWithItsName() {
        try {
            GridConfig.load('No_Such_Grid');
            System.assert(false, 'Expected an exception.');
        } catch (GridException e) {
            System.assert(e.getMessage().contains('No_Such_Grid'), e.getMessage());
        }
    }

    @IsTest
    static void forUserDropsUnreadableColumnsAndNarrowsEditing() {
        User limited = GridTestUsers.limitedUser();
        GridConfig.Definition def;
        System.runAs(limited) {
            def = GridConfig.forUser('Test_Records');
        }
        Set<String> fields = new Set<String>();
        for (GridConfig.Column c : def.columns) {
            fields.add(c.field);
            if (c.field == 'Read_Only_Text__c') {
                System.assertEquals(false, c.editable, 'Readable but not editable for this user.');
            }
            if (c.field == 'Text_Field__c') {
                System.assertEquals(true, c.editable);
            }
        }
        System.assert(!fields.contains('Formula_Number__c'), 'Invisible to the limited user, so not a column at all.');
        System.assert(!fields.contains('Auto_Number__c'), 'Invisible to the limited user, so not a column at all.');
        System.assert(fields.contains('Currency_Field__c'));
        System.assert(!fields.contains('Lookup_Field__c'), 'Invisible to the limited user.');
        System.assert(!fields.contains('Dependent_Picklist__c'), 'Invisible to the limited user.');
    }
}
