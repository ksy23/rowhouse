/**
 * DEVELOPMENT ONLY. Never packaged.
 * GridConfig — configuration parsing.
 * Uses the fixture configurations in test-data/config.
 */
@IsTest
private class GridConfigTest {
    @IsTest
    static void loadsColumnsInSortOrderWithDescribeDetail() {
        GridConfig.Definition def = GridConfig.load('Consignments');
        System.assertEquals('Consignment__c', def.objectApiName);
        System.assertEquals('Consignments', def.label, 'The label is the grid title.');
        System.assertEquals(16, def.columns.size(), 'Consignments has sixteen columns.');
        System.assertEquals('Name', def.columns[0].field, 'Sort_Order__c 1 comes first.');
        for (Integer i = 1; i < def.columns.size(); i++) {
            System.assertNotEquals(def.columns[i - 1].field, def.columns[i].field);
        }
        GridConfig.Column currencyCol;
        GridConfig.Column formulaCol;
        GridConfig.Column picklistCol;
        for (GridConfig.Column c : def.columns) {
            if (c.field == 'Freight_Charge__c')
                currencyCol = c;
            if (c.field == 'Pallet_Positions__c')
                formulaCol = c;
            if (c.field == 'Service_Level__c')
                picklistCol = c;
        }
        System.assertEquals('currency', currencyCol.type);
        System.assertEquals(2, currencyCol.scale);
        System.assertEquals(false, formulaCol.editable, 'A formula is read-only by type, whatever the config says.');
        System.assertEquals(3, picklistCol.options.size(), 'Active values only: Economy, Standard, Express.');
        for (GridConfig.Column c : def.columns) {
            if (c.field == 'Name') {
                // The schema calls a text Name nillable; users and the grid do not.
                System.assertEquals(true, c.required, 'Name must be required.');
            }
            // Wrap_Text__c is set on the PRO Number column only; unset means clip.
            System.assertEquals(c.field == 'Pro_Number__c', c.wrap, 'Wrap default for ' + c.field);
            // Always_Shown__c is set on the Name column only.
            System.assertEquals(c.field == 'Name', c.alwaysShown, 'Always Shown for ' + c.field);
        }
        System.assertEquals(200, def.pageSize);
        System.assertEquals(1, def.frozenColumns, 'Consignments freezes its Name column.');
        System.assertEquals(null, def.height, 'No Height: the grid fills the window.');
        System.assertEquals(320, GridConfig.load('Consignment_Rates').height, 'A Height is passed on in pixels.');
        System.assertEquals('asc', def.sortDirection);
        System.assertEquals(true, def.showRowNumbers, 'Checked: the rows are numbered.');
        System.assertEquals(true, def.allowNewRecords, 'Checked: the grid has a New button.');
        System.assertEquals(false, GridConfig.load('Consignment_Rates').allowNewRecords, 'Unchecked: no New button.');
    }

    @IsTest
    static void newRowCellsAreTheEditableColumnsTheUserMaySetOnCreate() {
        GridConfig.Definition def;
        GridConfig.Definition off;
        System.runAs(GridTestUsers.limitedUser()) {
            def = GridConfig.forUser('Consignment_Charges');
            off = GridConfig.forUser('Consignment_Rates');
        }
        System.assertEquals(true, def.allowNewRecords, 'The limited user may create consignments.');
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            byField.put(c.field, c);
        }
        System.assertEquals(true, byField.get('Consignee__c').creatable);
        System.assertEquals(
            false,
            byField.get('Carrier_Code__c').creatable,
            'An editable column the user may not set on create is not filled in on a new row.'
        );
        System.assertEquals(false, off.allowNewRecords);
        for (GridConfig.Column c : off.columns) {
            System.assertEquals(false, c.creatable, c.field + ': no New button, no new row cells.');
        }
    }

    @IsTest
    static void aGridThatRequiresExportReportsOffersExportOnlyToUsersWhoHoldIt() {
        User holder = GridTestUsers.fullUser();
        User without = GridTestUsers.noExportUser();
        // Whether this org's Standard User profile grants Export Reports, read apart from the code under test.
        Boolean standardUserExports = [
            SELECT PermissionsExportReport
            FROM PermissionSet
            WHERE IsOwnedByProfile = TRUE AND ProfileId = :holder.ProfileId
        ]
        .PermissionsExportReport;
        GridConfig.Definition required;
        GridConfig.Definition requiredWithout;
        GridConfig.Definition open;
        System.runAs(holder) {
            required = GridConfig.forUser('Consignment_Exports');
        }
        System.runAs(without) {
            System.assertEquals(false, GridSecurity.canExportReports(), 'Minimum Access does not grant it.');
            requiredWithout = GridConfig.forUser('Consignment_Exports');
            open = GridConfig.forUser('Consignment_Charges');
        }
        System.assertEquals(true, GridConfig.load('Consignment_Exports').requireExportReports);
        System.assertEquals(false, GridConfig.load('Consignment_Charges').requireExportReports, 'Unset: not required.');
        System.assertEquals(standardUserExports, required.allowCsvExport, 'Export for a user who holds it.');
        System.assertEquals(false, requiredWithout.allowCsvExport, 'No Export without Export Reports.');
        System.assertEquals(true, open.allowCsvExport, 'A grid that does not require it: Export for every user.');
        System.assertEquals('Wendell Cote', requiredWithout.userName, 'Generated by: the user\'s full name.');
    }

    @IsTest
    static void showRowNumbersIsPassedOn() {
        GridConfig.Definition def = GridConfig.build(
            new Grid_Configuration__mdt(
                DeveloperName = 'Dispatch_Board',
                MasterLabel = 'Dispatch Board',
                Object_API_Name__c = 'Consignment__c',
                Show_Row_Numbers__c = false
            ),
            new List<Grid_Column__mdt>{
                new Grid_Column__mdt(
                    DeveloperName = 'Dispatch_Board_Name',
                    Field_API_Name__c = 'Name',
                    Sort_Order__c = 10
                )
            },
            new List<Grid_Display_Rule__mdt>(),
            new List<Grid_Child_Table__mdt>(),
            new List<Grid_Action__mdt>()
        );
        System.assertEquals(false, def.showRowNumbers, 'Unchecked: no row numbers.');
    }

    @IsTest
    static void pageSizeAndFrozenColumnsSetInSetupAreKeptWithinWhatTheGridUses() {
        GridConfig.Definition def = GridConfig.build(
            new Grid_Configuration__mdt(
                DeveloperName = 'Dispatch_Board',
                MasterLabel = 'Dispatch Board',
                Object_API_Name__c = 'Consignment__c',
                Page_Size__c = 5000,
                Frozen_Columns__c = 8
            ),
            new List<Grid_Column__mdt>{
                new Grid_Column__mdt(
                    DeveloperName = 'Dispatch_Board_Name',
                    Field_API_Name__c = 'Name',
                    Sort_Order__c = 10
                )
            },
            new List<Grid_Display_Rule__mdt>(),
            new List<Grid_Child_Table__mdt>(),
            new List<Grid_Action__mdt>()
        );
        System.assertEquals(GridDataService.MAX_PAGE_SIZE, def.pageSize, 'Setup takes 5,000; a page holds 2,000.');
        System.assertEquals(GridConfig.MAX_FROZEN, def.frozenColumns, 'Setup takes 8; the grid freezes 5.');
        String warnings = String.join(def.warnings, ' | ');
        System.assert(warnings.contains('Page Size: 5,000 is more than 2,000'), warnings);
        System.assert(warnings.contains('Frozen Columns: 8 is more than 5, so the grid freezes 5.'), warnings);

        List<String> none = new List<String>();
        System.assertEquals(GridDataService.DEFAULT_PAGE_SIZE, GridConfig.pageSizeOf(0, none), 'Zero: the default.');
        System.assertEquals(
            GridDataService.DEFAULT_PAGE_SIZE,
            GridConfig.pageSizeOf(null, none),
            'Blank: the default.'
        );
        System.assertEquals(150, GridConfig.pageSizeOf(150, none));
        System.assertEquals(0, GridConfig.frozenColumnsOf(-2, none));
        System.assertEquals(3, GridConfig.frozenColumnsOf(3, none));
        System.assertEquals(1, none.size(), 'Only the zero page size warns: ' + none);
    }

    @IsTest
    static void lookupsOwnersAndPicklistDependenciesAreDescribed() {
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : GridConfig.load('Consignments').columns) {
            byField.put(c.field, c);
        }
        System.assertEquals('reference', byField.get('Shipper__c').type);
        System.assertEquals(new List<String>{ 'Account' }, byField.get('Shipper__c').referenceTo);
        System.assertEquals('owner', byField.get('OwnerId').type, 'OwnerId is an owner, not a plain lookup.');
        System.assert(byField.get('OwnerId').referenceTo.contains('User'));
        System.assertEquals('multipicklist', byField.get('Handling__c').type);
        System.assertEquals(5, byField.get('Handling__c').options.size());
        for (String f : new List<String>{ 'Shipper__c', 'OwnerId', 'Handling__c', 'Equipment__c' }) {
            System.assertEquals(true, byField.get(f).editable, f + ' has an editor now.');
        }

        GridConfig.Column dependent = byField.get('Equipment__c');
        System.assertEquals('Mode__c', dependent.dependentOn);
        Map<String, Object> validFor = new Map<String, Object>();
        for (Map<String, Object> o : dependent.options) {
            validFor.put((String) o.get('value'), o.get('validFor'));
        }
        System.assertEquals(new List<String>{ 'Truckload' }, validFor.get('Dry Van'));
        System.assertEquals(new List<String>{ 'Truckload' }, validFor.get('Reefer'));
        System.assertEquals(new List<String>{ 'LTL' }, validFor.get('Pallet'));
        System.assertEquals(null, byField.get('Mode__c').dependentOn);
        System.assertEquals(
            null,
            byField.get('Service_Level__c').options[0].get('validFor'),
            'Only dependent values carry validFor.'
        );
    }

    @IsTest
    static void eachColumnSaysWhetherSearchLooksInIt() {
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : GridConfig.load('Consignments').columns) {
            byField.put(GridTestUsers.plain(c.field), c);
        }
        System.assertEquals(true, byField.get('Name').searchable, 'Text: searched.');
        System.assertEquals(true, byField.get('Shipper__c').searchable, 'A lookup: searched by its record\'s name.');
        System.assertEquals(false, byField.get('Pallet_Positions__c').searchable, 'A number: not searched.');
        System.assertEquals(false, byField.get('Ship_Date__c').searchable, 'A date: not searched.');
    }

    @IsTest
    static void validForReadsOneBitPerControllingValueMostSignificantFirst() {
        List<String> nine = new List<String>{
            'Truckload',
            'LTL',
            'Parcel',
            'Intermodal',
            'Flatbed',
            'Drayage',
            'Rail',
            'Air',
            'Ocean'
        };
        System.assertEquals(
            new List<String>{ 'Truckload' },
            GridDescribe.validFor('gAAA', nine),
            '0x80: the first value.'
        );
        System.assertEquals(new List<String>{ 'LTL' }, GridDescribe.validFor('QAAA', nine), '0x40: the second.');
        System.assertEquals(new List<String>{ 'Truckload', 'LTL' }, GridDescribe.validFor('wAAA', nine), '0xC0: both.');
        System.assertEquals(
            new List<String>{ 'Ocean' },
            GridDescribe.validFor('AIAA', nine),
            'The ninth is in the second byte.'
        );
        System.assertEquals(new List<String>(), GridDescribe.validFor(null, nine));
    }

    @IsTest
    static void theControllingFieldIsReadOnceEvenWhenItIsAColumn() {
        List<String> names = GridConfig.load('Consignments').fieldNames();
        Integer count = 0;
        for (String n : names) {
            if (n == 'Mode__c')
                count++;
        }
        System.assertEquals(1, count, String.valueOf(names));
    }

    @IsTest
    static void theAllowListIsTheAdminsEditableColumns() {
        Set<String> allowed = GridConfig.load('Consignment_Charges').editableFields();
        System.assertEquals(new Set<String>{ 'consignee__c', 'carrier_code__c', 'delivery_notes__c' }, allowed);
        System.assert(
            !allowed.contains('freight_charge__c'),
            'Not a column of Consignment_Charges, so never writable through it.'
        );
    }

    @IsTest
    static void longTextIsEditableSinceItsEditorReadsTheWholeText() {
        // TC-055 still shortens long text in the rows; its editor
        // reads the whole value first (GridController.fetchFullText), so the
        // shortened copy is never what is saved, and the column is offered.
        GridConfig.Column longText;
        for (GridConfig.Column c : GridConfig.load('Consignment_Charges').columns) {
            if (c.field == 'Delivery_Notes__c')
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
        System.assertEquals('Owner', GridConfig.defaultLabel(Consignment__c.OwnerId.getDescribe()));
        System.assertEquals(
            'Shipper',
            GridConfig.defaultLabel(Consignment__c.Shipper__c.getDescribe()),
            'A custom lookup has no " ID" to drop.'
        );
        System.assertEquals('Pieces', GridConfig.defaultLabel(Consignment__c.Pieces__c.getDescribe()));
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : GridConfig.load('Consignments').columns) {
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
            GridConfig.load('Consignment_Rerate');
            System.assert(false, 'Expected an exception.');
        } catch (GridException e) {
            System.assert(e.getMessage().contains('Consignment_Rerate'), e.getMessage());
        }
    }

    @IsTest
    static void forUserDropsUnreadableColumnsAndNarrowsEditing() {
        User limited = GridTestUsers.limitedUser();
        GridConfig.Definition def;
        System.runAs(limited) {
            def = GridConfig.forUser('Consignments');
        }
        Set<String> fields = new Set<String>();
        for (GridConfig.Column c : def.columns) {
            fields.add(c.field);
            if (c.field == 'Carrier_Code__c') {
                System.assertEquals(false, c.editable, 'Readable but not editable for this user.');
            }
            if (c.field == 'Consignee__c') {
                System.assertEquals(true, c.editable);
            }
        }
        System.assert(
            !fields.contains('Pallet_Positions__c'),
            'Invisible to the limited user, so not a column at all.'
        );
        System.assert(
            !fields.contains('Consignment_Number__c'),
            'Invisible to the limited user, so not a column at all.'
        );
        System.assert(fields.contains('Freight_Charge__c'));
        System.assert(!fields.contains('Shipper__c'), 'Invisible to the limited user.');
        System.assert(!fields.contains('Equipment__c'), 'Invisible to the limited user.');
    }
}
