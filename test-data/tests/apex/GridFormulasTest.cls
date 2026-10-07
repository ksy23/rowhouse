/**
 * DEVELOPMENT ONLY. Never packaged.
 * Formula columns and formula display rules: built once, read
 * with the rows, worked out per row, and kept from users who cannot read
 * what they read. Configurations are built in memory with GridConfig.build,
 * as the Grid Admin tab checks a draft.
 */
@IsTest
private class GridFormulasTest {
    private static final Schema.SObjectType TEST_RECORD = Rowhouse_Test_Record__c.SObjectType;

    @TestSetup
    static void setup() {
        System.runAs(GridTestUsers.fullUser()) {
            Account corp = new Account(Name = 'Formula Corp');
            insert corp;
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(
                    Name = 'Fx A',
                    Number_Field__c = 4,
                    Decimal_Field__c = 2,
                    Lookup_Field__c = corp.Id
                ),
                new Rowhouse_Test_Record__c(Name = 'Fx B', Number_Field__c = 0, Decimal_Field__c = 2)
            };
        }
    }

    private static Grid_Configuration__mdt cfg() {
        return new Grid_Configuration__mdt(
            DeveloperName = 'Fx_Test',
            MasterLabel = 'Fx Test',
            Object_API_Name__c = 'Rowhouse_Test_Record__c'
        );
    }

    private static Grid_Column__mdt column(String field, Integer order) {
        return new Grid_Column__mdt(
            DeveloperName = 'Fx_Test_' + field.removeEnd('__c'),
            Field_API_Name__c = field,
            Sort_Order__c = order
        );
    }

    private static Grid_Column__mdt formula(String name, String label, String text, String type, Integer order) {
        return new Grid_Column__mdt(
            DeveloperName = name,
            Column_Label__c = label,
            Formula__c = text,
            Formula_Type__c = type,
            Sort_Order__c = order
        );
    }

    private static GridConfig.Definition build(List<Grid_Column__mdt> columns, List<Grid_Format_Rule__mdt> rules) {
        return GridConfig.build(
            cfg(),
            columns,
            rules,
            new List<Grid_Child__mdt>(),
            new List<Grid_Action__mdt>(),
            new List<Grid_Filter__mdt>()
        );
    }

    /** The rows as the browser gets them, by Name. */
    private static Map<String, Map<String, Object>> rowsOf(GridConfig.Definition def) {
        GridRequest request = new GridRequest(def.objectApiName, def.fieldNames(), null, 200);
        request.reading(def.formulaPaths());
        request.orderBy('Name', 'asc');
        Map<String, Map<String, Object>> out = new Map<String, Map<String, Object>>();
        for (Map<String, Object> row : GridController.toClientRows(GridDataService.fetchPage(request), def)) {
            out.put((String) row.get('Name'), row);
        }
        return out;
    }

    @IsTest
    static void aFormulaColumnIsWorkedOutForEachRow() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = build(
                new List<Grid_Column__mdt>{
                    column('Name', 10),
                    formula('Fx_Double', 'Double', 'Number_Field__c * 2', 'number', 20),
                    formula('Fx_Account', 'Account', 'Lookup_Field__r.Name', 'text', 30),
                    formula('Fx_Ratio', 'Ratio', 'Decimal_Field__c / Number_Field__c', 'number', 40)
                },
                new List<Grid_Format_Rule__mdt>()
            );
            System.assertEquals(new List<String>(), def.warnings);
            GridConfig.Column doubled = def.columns[1];
            System.assertEquals('_fx_Fx_Double', doubled.field, 'A formula column\'s key cannot be a field\'s.');
            System.assert(
                doubled.isFormula &&
                    !doubled.editable &&
                    !doubled.sortable &&
                    !doubled.groupable &&
                    !doubled.filterable,
                'Read only, and nothing the server would have to do with its value.'
            );
            System.assertEquals(2, doubled.scale, 'A number shows two places unless told otherwise.');
            System.assertEquals(
                new List<String>{ 'Name' },
                def.fieldNames(),
                'A formula column is not a field to query.'
            );
            Set<String> paths = new Set<String>(def.formulaPaths());
            System.assert(
                paths.containsAll(new Set<String>{ 'Number_Field__c', 'Lookup_Field__r.Name', 'Decimal_Field__c' }),
                String.valueOf(paths)
            );

            Map<String, Map<String, Object>> rows = rowsOf(def);
            System.assert(
                rows.get('Fx A').get('_fx_Fx_Double') instanceof String,
                'Numbers travel as decimal strings.'
            );
            System.assertEquals(8, Decimal.valueOf((String) rows.get('Fx A').get('_fx_Fx_Double')));
            System.assertEquals(
                'Formula Corp',
                rows.get('Fx A').get('_fx_Fx_Account'),
                'A formula reads through a lookup.'
            );
            System.assertEquals(0.5, Decimal.valueOf((String) rows.get('Fx A').get('_fx_Fx_Ratio')));
            System.assertEquals(
                null,
                rows.get('Fx B').get('_fx_Fx_Ratio'),
                'A division by zero is a blank cell, not a failed page.'
            );
            System.assert(
                !rows.get('Fx A').containsKey('Number_Field__c'),
                'What a formula reads is not sent as a column.'
            );
        }
    }

    @IsTest
    static void aPercentFormulaShowsAsThePercentFieldsDo() {
        System.runAs(GridTestUsers.fullUser()) {
            // A formula works out 25% as 0.25 (measured in a Developer Edition org); a
            // percent field reaches the grid as 25, and so must a percent formula.
            GridConfig.Definition def = build(
                new List<Grid_Column__mdt>{
                    column('Name', 10),
                    formula('Fx_Share', 'Share', 'Number_Field__c / 16', 'percent', 20)
                },
                new List<Grid_Format_Rule__mdt>()
            );
            Map<String, Map<String, Object>> rows = rowsOf(def);
            System.assertEquals(
                25,
                Decimal.valueOf((String) rows.get('Fx A').get('_fx_Fx_Share')),
                'Fx A: 4 / 16 is 25%.'
            );
            System.assertEquals(0, Decimal.valueOf((String) rows.get('Fx B').get('_fx_Fx_Share')));
        }
    }

    @IsTest
    static void aFormulaThatCannotBeBuiltIsSkippedWithAWarning() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = build(
                new List<Grid_Column__mdt>{
                    column('Name', 10),
                    formula('Fx_Bad', 'Bad', 'Number_Field__c * ', 'number', 20),
                    formula('Fx_No_Label', null, 'Number_Field__c', 'number', 30),
                    formula('Fx_No_Type', 'Odd', 'Number_Field__c', 'color', 40)
                },
                new List<Grid_Format_Rule__mdt>()
            );
            System.assertEquals(1, def.columns.size());
            String warnings = String.join(def.warnings, ' | ');
            System.assert(warnings.contains('Formula column Fx_Bad was skipped: the formula does not work'), warnings);
            System.assert(warnings.contains('needs a Column Label'), warnings);
            System.assert(warnings.contains('unknown Formula Type'), warnings);
        }
    }

    @IsTest
    static void aGridHasAtMostTenFormulas() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Grid_Column__mdt> columns = new List<Grid_Column__mdt>{ column('Name', 1) };
            for (Integer i = 0; i <= GridFormulas.MAX_FORMULAS; i++) {
                columns.add(formula('Fx_' + i, 'F' + i, 'Number_Field__c + ' + i, 'number', 10 + i));
            }
            GridConfig.Definition def = build(columns, new List<Grid_Format_Rule__mdt>());
            System.assertEquals(GridFormulas.MAX_FORMULAS + 1, def.columns.size());
            System.assert(
                String.join(def.warnings, ' ').contains('at most ' + GridFormulas.MAX_FORMULAS + ' formulas')
            );
        }
    }

    @IsTest
    static void aFormulaRuleMarksTheRowsItMeets() {
        System.runAs(GridTestUsers.fullUser()) {
            Grid_Format_Rule__mdt r = new Grid_Format_Rule__mdt(
                DeveloperName = 'Fx_Rule',
                MasterLabel = 'Big',
                Field_API_Name__c = 'Name',
                Formula__c = 'Number_Field__c > 3',
                Style__c = 'icon_warning',
                Apply_To__c = 'cell',
                Active__c = true
            );
            GridConfig.Definition def = build(
                new List<Grid_Column__mdt>{ column('Name', 10) },
                new List<Grid_Format_Rule__mdt>{ r }
            );
            System.assertEquals(1, def.formatRules.size(), String.valueOf(def.warnings));
            GridConfig.FormatRule rule = def.formatRules[0];
            System.assert(rule.isFormula, 'Tested on the server.');
            System.assertEquals('Name', rule.field, 'Its Field is the cell it colors.');
            Map<String, Map<String, Object>> rows = rowsOf(def);
            System.assertEquals(new List<String>{ 'Fx_Rule' }, rows.get('Fx A').get('_rules'));
            System.assert(!rows.get('Fx B').containsKey('_rules'), 'A row that does not meet it carries nothing.');
        }
    }

    @IsTest
    static void newRuleOptionsAreChecked() {
        Map<String, GridConfig.Column> noColumns = new Map<String, GridConfig.Column>();
        // Between
        GridConfig.FormatRule between = GridConfig.formatRule(
            new Grid_Format_Rule__mdt(
                DeveloperName = 'B',
                Field_API_Name__c = 'Number_Field__c',
                Operator__c = 'between',
                Value__c = '1',
                Value_To__c = '9',
                Style__c = 'fill_green',
                Apply_To__c = 'row'
            ),
            TEST_RECORD,
            noColumns
        );
        System.assertEquals('9', between.valueTo);
        // Two fields
        GridConfig.FormatRule two = GridConfig.formatRule(
            new Grid_Format_Rule__mdt(
                DeveloperName = 'T',
                Field_API_Name__c = 'Number_Field__c',
                Operator__c = 'greater_than',
                Compare_Field__c = 'currency_field__c',
                Style__c = 'bold',
                Apply_To__c = 'row'
            ),
            TEST_RECORD,
            noColumns
        );
        System.assertEquals('Currency_Field__c', two.compareField, 'The compare field, as describe spells it.');
        System.assertEquals(null, two.value);
        // Refusals, in an admin's terms.
        List<String> refusals = new List<String>();
        for (
            Grid_Format_Rule__mdt bad : new List<Grid_Format_Rule__mdt>{
                new Grid_Format_Rule__mdt(
                    DeveloperName = 'X1',
                    Field_API_Name__c = 'Number_Field__c',
                    Operator__c = 'between',
                    Value__c = '1',
                    Style__c = 'bold',
                    Apply_To__c = 'row'
                ),
                new Grid_Format_Rule__mdt(
                    DeveloperName = 'X2',
                    Field_API_Name__c = 'Number_Field__c',
                    Operator__c = 'equals',
                    Compare_Field__c = 'Text_Field__c',
                    Style__c = 'bold',
                    Apply_To__c = 'row'
                ),
                new Grid_Format_Rule__mdt(
                    DeveloperName = 'X3',
                    Field_API_Name__c = 'Text_Field__c',
                    Operator__c = 'is_not_blank',
                    Style__c = 'data_bar',
                    Apply_To__c = 'row'
                ),
                new Grid_Format_Rule__mdt(
                    DeveloperName = 'X4',
                    Field_API_Name__c = 'Number_Field__c',
                    Operator__c = 'equals',
                    Value__c = '1',
                    Compare_Field__c = 'Currency_Field__c',
                    Style__c = 'bold',
                    Apply_To__c = 'row'
                ),
                new Grid_Format_Rule__mdt(
                    DeveloperName = 'X5',
                    Formula__c = 'true',
                    Style__c = 'bold',
                    Apply_To__c = 'cell'
                )
            }
        ) {
            try {
                GridConfig.formatRule(bad, TEST_RECORD, noColumns);
                refusals.add('accepted');
            } catch (GridException e) {
                refusals.add(e.getMessage());
            }
        }
        System.assert(refusals[0].contains('Value To'), refusals[0]);
        System.assert(refusals[1].contains('not the same kind'), refusals[1]);
        System.assert(refusals[2].contains('a data bar shows a number'), refusals[2]);
        System.assert(refusals[3].contains('both a Value and a Compare Field'), refusals[3]);
        System.assert(refusals[4].contains('needs the Field of that cell'), refusals[4]);
    }

    @IsTest
    static void aPathIsReadableOnlyWhenEveryStepIs() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(GridFormulas.canRead(TEST_RECORD, 'Lookup_Field__r.Name'));
            System.assert(!GridFormulas.canRead(TEST_RECORD, 'No_Such__r.Name'));
        }
        System.runAs(GridTestUsers.limitedUser()) {
            System.assert(GridFormulas.canRead(TEST_RECORD, 'Number_Field__c'));
            System.assert(
                !GridFormulas.canRead(TEST_RECORD, 'Lookup_Field__r.Name'),
                'Rowhouse_Test_Limited cannot read the lookup.'
            );
            System.assert(
                !GridFormulas.canReadAll(TEST_RECORD, new List<String>{ 'Number_Field__c', 'Percent_Field__c' })
            );
        }
    }

    @IsTest
    static void columnsReadTheSameWhoeverReadsThem() {
        // By SOQL for a user who may query the type, by getAll() for one who may
        // not: the same columns. Only the first can read a formula longer
        // than getAll() hands back whole; the other keeps its first 255
        // characters, as everyone did before, and the formula is skipped.
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance('Feature_Test');
        Map<String, String> byQuery = new Map<String, String>();
        Map<String, String> byCache = new Map<String, String>();
        System.runAs(GridTestUsers.fullUser()) {
            for (Grid_Column__mdt c : GridConfig.columnsOf(cfg)) {
                byQuery.put(c.DeveloperName, c.Formula__c);
            }
        }
        System.runAs(GridTestUsers.noLogUser()) {
            for (Grid_Column__mdt c : GridConfig.columnsOf(cfg)) {
                byCache.put(c.DeveloperName, c.Formula__c);
            }
        }
        System.assert(!byQuery.isEmpty());
        System.assertEquals(byQuery.keySet(), byCache.keySet());
        for (String name : byQuery.keySet()) {
            String whole = byQuery.get(name);
            String read = byCache.get(name);
            System.assert(
                read == whole || (whole.length() > GridConfig.CACHED_TEXT_LIMIT && whole.startsWith(read)),
                name
            );
        }
        System.assert(
            byQuery.get('Feature_Test_Size_Band').length() > GridConfig.CACHED_TEXT_LIMIT,
            'Read whole by SOQL.'
        );
    }

    @IsTest
    static void aFormulaLongerThan255CharactersIsReadWhole() {
        // getAll() returns only the first 255 characters of a Long Text Area field.
        // The fixture Feature_Test_Size_Band (test-data/config) has a longer formula.
        String formula;
        System.runAs(GridTestUsers.fullUser()) {
            for (Grid_Column__mdt c : GridConfig.columnsOf(Grid_Configuration__mdt.getInstance('Feature_Test'))) {
                if (c.DeveloperName == 'Feature_Test_Size_Band') {
                    formula = c.Formula__c;
                }
            }
            System.assert(formula != null && formula.length() > GridConfig.CACHED_TEXT_LIMIT, String.valueOf(formula));
            System.assert(formula.endsWith(')))))))'), formula);
            Boolean shown = false;
            for (GridConfig.Column c : GridConfig.load('Feature_Test').columns) {
                shown |= c.field == '_fx_Feature_Test_Size_Band';
            }
            System.assert(shown, 'The whole formula builds, so the column is not skipped.');
        }
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Feature_Test').get('draft');
            for (GridAdmin.ColumnDraft col : d.columns) {
                if (col.name == 'Feature_Test_Size_Band') {
                    System.assertEquals(
                        formula,
                        col.formula,
                        'The Grid Admin tab reads, and so saves back, the whole formula.'
                    );
                }
            }
        }
    }

    @IsTest
    static void aPolymorphicPathIsRefused() {
        try {
            GridFormulas.compile(TEST_RECORD, 'Owner:User.FirstName', FormulaEval.FormulaReturnType.STRING);
            System.assert(false, 'SOQL cannot read through a lookup to more than one object without TYPEOF.');
        } catch (GridException e) {
            System.assert(e.getMessage().length() > 0);
        }
    }
}
