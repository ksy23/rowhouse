/**
 * DEVELOPMENT ONLY. Never packaged.
 * Conditional formatting rules: how a Grid_Display_Rule__mdt record is
 * checked and normalised, which rules a grid loads, and which a user gets.
 *
 * Rules are built in memory for the checks, so each case states its own
 * record; the loading tests use the fixture rules in test-data/config.
 */
@IsTest
private class GridDisplayRuleTest {
    private static final Schema.SObjectType TEST_RECORD = Consignment__c.SObjectType;

    /** A row rule, so the field need not be a column; the cell cases pass 'cell'. */
    private static Grid_Display_Rule__mdt rule(String field, String operator, String value, String style) {
        return rule(field, operator, value, style, 'row');
    }

    /** Custom metadata fields cannot be assigned in Apex, so each variant is built whole. */
    private static Grid_Display_Rule__mdt rule(
        String field,
        String operator,
        String value,
        String style,
        String applyTo
    ) {
        return new Grid_Display_Rule__mdt(
            DeveloperName = 'Rule_' + field.replace('__c', ''),
            Field_API_Name__c = field,
            Operator__c = operator,
            Value__c = value,
            Style__c = style,
            Apply_To__c = applyTo,
            Active__c = true
        );
    }

    private static GridConfig.DisplayRule check(Grid_Display_Rule__mdt r) {
        return GridConfig.displayRule(r, TEST_RECORD, new Map<String, GridConfig.Column>());
    }

    private static String refusal(Grid_Display_Rule__mdt r) {
        try {
            check(r);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void normalisesValuesForTheFieldsType() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                '1000',
                check(rule('Freight_Charge__c', 'greater_or_equal', ' 1000 ', 'fill_green')).value
            );
            System.assertEquals('-12.50', check(rule('Fuel_Surcharge__c', 'less_than', '-12.50', 'bold')).value);
            System.assertEquals('TODAY+7', check(rule('Ship_Date__c', 'less_than', 'today + 7', 'fill_amber')).value);
            System.assertEquals('2026-12-31', check(rule('Ship_Date__c', 'equals', '2026-12-31', 'bold')).value);
            System.assertEquals('TODAY-30', check(rule('Picked_Up__c', 'greater_than', 'Today-30', 'bold')).value);
            System.assertEquals('false', check(rule('Delivered__c', 'equals', 'FALSE', 'text_grey')).value);
            System.assertEquals(
                'Express',
                check(rule('Service_Level__c', 'equals', 'express', 'fill_purple')).value,
                'A picklist value is matched in any case and sent as its API name.'
            );
            System.assertEquals(
                'Fragile;Inside Delivery',
                check(rule('Handling__c', 'equals', 'fragile; inside delivery', 'bold')).value
            );
            System.assertEquals('Liftgate', check(rule('Handling__c', 'contains', 'LIFTGATE', 'bold')).value);
            System.assertEquals(
                'Exp',
                check(rule('Service_Level__c', 'starts_with', 'Exp', 'bold')).value,
                'A prefix is not a value of its own, so it is not matched against the list.'
            );
            System.assertEquals(
                'Stand',
                check(rule('Service_Level__c', 'not_contains', 'Stand', 'bold')).value,
                'Nor is part of a value: contains and does not contain match it as text.'
            );
            System.assertEquals('$User', check(rule('OwnerId', 'equals', '$user', 'bold')).value);
            System.assertEquals(null, check(rule('Consignee__c', 'is_blank', 'ignored', 'text_grey')).value);
        }
    }

    @IsTest
    static void takesLookupIdsOfTheRightObjectOnly() {
        System.runAs(GridTestUsers.fullUser()) {
            Account a = new Account(Name = 'Casco Bay Marine');
            insert a;
            String fifteen = String.valueOf(a.Id).left(15);
            System.assertEquals(
                String.valueOf(a.Id),
                check(rule('Shipper__c', 'equals', fifteen, 'bold')).value,
                'A 15-character Id is sent as 18.'
            );
            System.assert(refusal(rule('Shipper__c', 'equals', UserInfo.getUserId(), 'bold')).contains('can point to'));
            System.assert(refusal(rule('Shipper__c', 'equals', 'Wachusett Paper', 'bold')).contains('not a record Id'));
        }
    }

    @IsTest
    static void refusesRulesThatMeanNothingWithAMessageForTheAdmin() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(refusal(rule('Customs_Broker__c', 'equals', 'Portland', 'bold')).contains('Unknown field'));
            System.assert(
                refusal(rule('Service_Level__c', 'greater_than', 'Standard', 'bold')).contains('does not apply to')
            );
            System.assert(refusal(rule('Freight_Charge__c', 'contains', '5', 'bold')).contains('does not apply to'));
            System.assert(
                refusal(rule('Delivered__c', 'is_blank', null, 'bold')).contains('does not apply to'),
                'A checkbox is never blank.'
            );
            System.assert(refusal(rule('Handling__c', 'starts_with', 'Frag', 'bold')).contains('does not apply to'));
            System.assert(refusal(rule('Freight_Charge__c', 'less_than', '1,000', 'bold')).contains('is not a number'));
            System.assert(refusal(rule('Ship_Date__c', 'less_than', '31/12/2026', 'bold')).contains('is not a date'));
            System.assert(refusal(rule('Ship_Date__c', 'less_than', '2026-02-30', 'bold')).contains('is not a date'));
            System.assert(refusal(rule('Delivered__c', 'equals', 'yes', 'bold')).contains('not true or false'));
            System.assert(
                refusal(rule('Service_Level__c', 'equals', 'Overnight', 'bold')).contains('is not a value of')
            );
            System.assert(refusal(rule('Consignee__c', 'equals', '  ', 'bold')).contains('has no Value'));
            System.assert(refusal(rule('Consignee__c', 'equals', 'Kennebec Lumber', null)).contains('no Style'));
            System.assert(
                refusal(rule('Consignee__c', 'equals', 'Kennebec Lumber', 'purple')).contains('unknown Style')
            );
            System.assert(
                refusal(rule('Consignee__c', 'like', 'Kennebec Lumber', 'bold')).contains('unknown Operator')
            );
        }
    }

    @IsTest
    static void usesTheColumnsTypeWhenTheFieldIsAColumn() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Column col = new GridConfig.Column();
            col.field = 'Consignee__c';
            col.type = 'email';
            GridConfig.DisplayRule r = GridConfig.displayRule(
                rule('Consignee__c', 'contains', '@', 'bold', 'cell'),
                TEST_RECORD,
                new Map<String, GridConfig.Column>{ 'consignee__c' => col }
            );
            System.assertEquals('email', r.type, 'The grid tests the value as the column shows it.');
            System.assertEquals('cell', r.applyTo);
        }
    }

    @IsTest
    static void aCellRuleNeedsItsFieldToBeAColumn() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(
                refusal(rule('Fuel_Surcharge__c', 'greater_than', '50', 'bold', 'cell'))
                    .contains('is not a column of this grid'),
                'A cell rule on a field the grid does not show would never show.'
            );
            System.assert(
                refusal(rule('Fuel_Surcharge__c', 'greater_than', '50', 'bold', null))
                    .contains('is not a column of this grid'),
                'Blank Apply To means Cell.'
            );
        }
    }

    @IsTest
    static void loadsTheActiveFixtureRulesInSortOrder() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.load('Consignments');
            List<String> names = new List<String>();
            for (GridConfig.DisplayRule r : def.displayRules) {
                names.add(r.name);
            }
            System.assertEquals(
                new List<String>{
                    'Consignments_Negative_Amount',
                    'Consignments_Large_Amount',
                    'Consignments_Past_Date',
                    'Consignments_Express_Row',
                    'Consignments_Half_Percent'
                },
                names,
                'Active rules only, lowest Sort Order first; Switched_Off is inactive.'
            );
            System.assertEquals('row', def.displayRules[3].applyTo);
            System.assertEquals('Express', def.displayRules[3].value);
            System.assertEquals('fill_purple', def.displayRules[3].style);
            System.assertEquals(
                'Express service',
                def.displayRules[3].label,
                'The rule\'s Label: what the legend says.'
            );
            System.assertEquals(new List<String>(), def.warnings);
            System.assert(
                def.fieldNames().contains('Fuel_Surcharge__c'),
                'A rule field that is not a column is still read, so the grid can test it.'
            );
        }
    }

    @IsTest
    static void thereIsNoBlueFillBecauseABlueRowLooksSelected() {
        System.assertEquals('fill_purple', check(rule('Service_Level__c', 'equals', 'express', 'FILL_PURPLE')).style);
        System.assert(
            refusal(rule('Service_Level__c', 'equals', 'express', 'fill_blue')).contains('unknown Style'),
            'Purple is the fill for highlighting a row; blue is what a selected row looks like.'
        );
    }

    @IsTest
    static void aRuleWithoutALabelIsNamedByItsDeveloperName() {
        System.assertEquals('Rule_Service_Level', check(rule('Service_Level__c', 'equals', 'express', 'bold')).label);
    }

    @IsTest
    static void aUserGetsOnlyRulesOnFieldsTheyCanRead() {
        Set<String> full = new Set<String>();
        Set<String> limited = new Set<String>();
        System.runAs(GridTestUsers.fullUser()) {
            for (GridConfig.DisplayRule r : GridConfig.forUser('Consignments').displayRules) {
                full.add(r.field);
            }
        }
        System.runAs(GridTestUsers.limitedUser()) {
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            for (GridConfig.DisplayRule r : def.displayRules) {
                limited.add(r.field);
            }
            System.assert(!def.fieldNames().contains('Fuel_Surcharge__c'));
        }
        System.assert(full.contains('Fuel_Surcharge__c'));
        System.assert(
            !limited.contains('Fuel_Surcharge__c'),
            'Freight_Limited_Access cannot read Fuel_Surcharge__c, so a bold row would reveal it.'
        );
        System.assert(limited.contains('Freight_Charge__c'));
    }

    @IsTest
    static void configurationWarningsReachOnlyDiagnosticsUsers() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = (GridConfig.Definition) GridController.openGrid(
                    'Consignments',
                    null,
                    null,
                    null,
                    null
                )
                .get('definition');
            System.assertEquals(0, def.warnings.size(), 'Without Rowhouse_Diagnostics, no warnings are sent.');
        }
    }
}
