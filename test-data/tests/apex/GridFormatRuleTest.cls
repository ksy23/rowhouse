/**
 * DEVELOPMENT ONLY. Never packaged.
 * Conditional formatting rules: how a Grid_Format_Rule__mdt record is
 * checked and normalised, which rules a grid loads, and which a user gets.
 *
 * Rules are built in memory for the checks, so each case states its own
 * record; the loading tests use the fixture rules in test-data/config.
 */
@IsTest
private class GridFormatRuleTest {
    private static final Schema.SObjectType TEST_RECORD = Rowhouse_Test_Record__c.SObjectType;

    /** A row rule, so the field need not be a column; the cell cases pass 'cell'. */
    private static Grid_Format_Rule__mdt rule(String field, String operator, String value, String style) {
        return rule(field, operator, value, style, 'row');
    }

    /** Custom metadata fields cannot be assigned in Apex, so each variant is built whole. */
    private static Grid_Format_Rule__mdt rule(
        String field,
        String operator,
        String value,
        String style,
        String applyTo
    ) {
        return new Grid_Format_Rule__mdt(
            DeveloperName = 'Rule_' + field.replace('__c', ''),
            Field_API_Name__c = field,
            Operator__c = operator,
            Value__c = value,
            Style__c = style,
            Apply_To__c = applyTo,
            Active__c = true
        );
    }

    private static GridConfig.FormatRule check(Grid_Format_Rule__mdt r) {
        return GridConfig.formatRule(r, TEST_RECORD, new Map<String, GridConfig.Column>());
    }

    private static String refusal(Grid_Format_Rule__mdt r) {
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
                check(rule('Currency_Field__c', 'greater_or_equal', ' 1000 ', 'fill_green')).value
            );
            System.assertEquals('-12.50', check(rule('Percent_Field__c', 'less_than', '-12.50', 'bold')).value);
            System.assertEquals('TODAY+7', check(rule('Date_Field__c', 'less_than', 'today + 7', 'fill_amber')).value);
            System.assertEquals('2026-12-31', check(rule('Date_Field__c', 'equals', '2026-12-31', 'bold')).value);
            System.assertEquals('TODAY-30', check(rule('DateTime_Field__c', 'greater_than', 'Today-30', 'bold')).value);
            System.assertEquals('false', check(rule('Checkbox_Field__c', 'equals', 'FALSE', 'text_grey')).value);
            System.assertEquals(
                'Gamma',
                check(rule('Picklist_Field__c', 'equals', 'gamma', 'fill_purple')).value,
                'A picklist value is matched in any case and sent as its API name.'
            );
            System.assertEquals('Red;Blue', check(rule('Multi_Picklist__c', 'equals', 'red; blue', 'bold')).value);
            System.assertEquals('Green', check(rule('Multi_Picklist__c', 'contains', 'GREEN', 'bold')).value);
            System.assertEquals(
                'Gam',
                check(rule('Picklist_Field__c', 'starts_with', 'Gam', 'bold')).value,
                'A prefix is not a value of its own, so it is not matched against the list.'
            );
            System.assertEquals('$User', check(rule('OwnerId', 'equals', '$user', 'bold')).value);
            System.assertEquals(null, check(rule('Text_Field__c', 'is_blank', 'ignored', 'text_grey')).value);
        }
    }

    @IsTest
    static void takesLookupIdsOfTheRightObjectOnly() {
        System.runAs(GridTestUsers.fullUser()) {
            Account a = new Account(Name = 'Format target');
            insert a;
            String fifteen = String.valueOf(a.Id).left(15);
            System.assertEquals(
                String.valueOf(a.Id),
                check(rule('Lookup_Field__c', 'equals', fifteen, 'bold')).value,
                'A 15-character Id is sent as 18.'
            );
            System.assert(
                refusal(rule('Lookup_Field__c', 'equals', UserInfo.getUserId(), 'bold')).contains('can point to')
            );
            System.assert(refusal(rule('Lookup_Field__c', 'equals', 'Acme', 'bold')).contains('not a record Id'));
        }
    }

    @IsTest
    static void refusesRulesThatMeanNothingWithAMessageForTheAdmin() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(refusal(rule('No_Such_Field__c', 'equals', 'x', 'bold')).contains('Unknown field'));
            System.assert(
                refusal(rule('Picklist_Field__c', 'greater_than', 'Beta', 'bold')).contains('does not apply to')
            );
            System.assert(refusal(rule('Currency_Field__c', 'contains', '5', 'bold')).contains('does not apply to'));
            System.assert(
                refusal(rule('Checkbox_Field__c', 'is_blank', null, 'bold')).contains('does not apply to'),
                'A checkbox is never blank.'
            );
            System.assert(refusal(rule('Multi_Picklist__c', 'starts_with', 'R', 'bold')).contains('does not apply to'));
            System.assert(refusal(rule('Currency_Field__c', 'less_than', '1,000', 'bold')).contains('is not a number'));
            System.assert(refusal(rule('Date_Field__c', 'less_than', '31/12/2026', 'bold')).contains('is not a date'));
            System.assert(refusal(rule('Date_Field__c', 'less_than', '2026-02-30', 'bold')).contains('is not a date'));
            System.assert(refusal(rule('Checkbox_Field__c', 'equals', 'yes', 'bold')).contains('not true or false'));
            System.assert(refusal(rule('Picklist_Field__c', 'equals', 'Delta', 'bold')).contains('is not a value of'));
            System.assert(refusal(rule('Text_Field__c', 'equals', '  ', 'bold')).contains('has no Value'));
            System.assert(refusal(rule('Text_Field__c', 'equals', 'x', null)).contains('no Style'));
            System.assert(refusal(rule('Text_Field__c', 'equals', 'x', 'purple')).contains('unknown Style'));
            System.assert(refusal(rule('Text_Field__c', 'like', 'x', 'bold')).contains('unknown Operator'));
        }
    }

    @IsTest
    static void usesTheColumnsTypeWhenTheFieldIsAColumn() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Column col = new GridConfig.Column();
            col.field = 'Text_Field__c';
            col.type = 'email';
            GridConfig.FormatRule r = GridConfig.formatRule(
                rule('Text_Field__c', 'contains', '@', 'bold', 'cell'),
                TEST_RECORD,
                new Map<String, GridConfig.Column>{ 'text_field__c' => col }
            );
            System.assertEquals('email', r.type, 'The grid tests the value as the column shows it.');
            System.assertEquals('cell', r.applyTo);
        }
    }

    @IsTest
    static void aCellRuleNeedsItsFieldToBeAColumn() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(
                refusal(rule('Percent_Field__c', 'greater_than', '50', 'bold', 'cell'))
                    .contains('is not a column of this grid'),
                'A cell rule on a field the grid does not show would never show.'
            );
            System.assert(
                refusal(rule('Percent_Field__c', 'greater_than', '50', 'bold', null))
                    .contains('is not a column of this grid'),
                'Blank Apply To means Cell.'
            );
        }
    }

    @IsTest
    static void loadsTheActiveFixtureRulesInSortOrder() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.load('Test_Records');
            List<String> names = new List<String>();
            for (GridConfig.FormatRule r : def.formatRules) {
                names.add(r.name);
            }
            System.assertEquals(
                new List<String>{
                    'Test_Records_Negative_Amount',
                    'Test_Records_Large_Amount',
                    'Test_Records_Past_Date',
                    'Test_Records_Gamma_Row',
                    'Test_Records_Half_Percent'
                },
                names,
                'Active rules only, lowest Sort Order first; Switched_Off is inactive.'
            );
            System.assertEquals('row', def.formatRules[3].applyTo);
            System.assertEquals('Gamma', def.formatRules[3].value);
            System.assertEquals('fill_purple', def.formatRules[3].style);
            System.assertEquals('Gamma stage', def.formatRules[3].label, 'The rule\'s Label: what the legend says.');
            System.assertEquals(new List<String>(), def.warnings);
            System.assert(
                def.fieldNames().contains('Percent_Field__c'),
                'A rule field that is not a column is still read, so the grid can test it.'
            );
        }
    }

    @IsTest
    static void thereIsNoBlueFillBecauseABlueRowLooksSelected() {
        System.assertEquals('fill_purple', check(rule('Picklist_Field__c', 'equals', 'gamma', 'FILL_PURPLE')).style);
        System.assert(
            refusal(rule('Picklist_Field__c', 'equals', 'gamma', 'fill_blue')).contains('unknown Style'),
            'Purple is the fill for highlighting a row; blue is what a selected row looks like.'
        );
    }

    @IsTest
    static void aRuleWithoutALabelIsNamedByItsDeveloperName() {
        System.assertEquals('Rule_Picklist_Field', check(rule('Picklist_Field__c', 'equals', 'gamma', 'bold')).label);
    }

    @IsTest
    static void aUserGetsOnlyRulesOnFieldsTheyCanRead() {
        Set<String> full = new Set<String>();
        Set<String> limited = new Set<String>();
        System.runAs(GridTestUsers.fullUser()) {
            for (GridConfig.FormatRule r : GridConfig.forUser('Test_Records').formatRules) {
                full.add(r.field);
            }
        }
        System.runAs(GridTestUsers.limitedUser()) {
            GridConfig.Definition def = GridConfig.forUser('Test_Records');
            for (GridConfig.FormatRule r : def.formatRules) {
                limited.add(r.field);
            }
            System.assert(!def.fieldNames().contains('Percent_Field__c'));
        }
        System.assert(full.contains('Percent_Field__c'));
        System.assert(
            !limited.contains('Percent_Field__c'),
            'Rowhouse_Test_Limited cannot read Percent_Field__c, so a bold row would reveal it.'
        );
        System.assert(limited.contains('Currency_Field__c'));
    }

    @IsTest
    static void configurationWarningsReachOnlyDiagnosticsUsers() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = (GridConfig.Definition) GridController.getGridConfig('Test_Records')
                .get('definition');
            System.assertEquals(0, def.warnings.size(), 'Without Rowhouse_Diagnostics, no warnings are sent.');
        }
    }
}
