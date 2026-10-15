/**
 * DEVELOPMENT ONLY. Never packaged.
 * Formula columns and formula display rules: built once, read
 * with the rows, worked out per row, and kept from users who cannot read
 * what they read. Configurations are built in memory with GridConfig.build,
 * as the Grid Admin tab checks a draft.
 */
@IsTest
private class GridFormulasTest {
    private static final Schema.SObjectType TEST_RECORD = Consignment__c.SObjectType;

    @TestSetup
    static void setup() {
        System.runAs(GridTestUsers.fullUser()) {
            Account corp = new Account(Name = 'Casco Bay Marine');
            insert corp;
            insert new List<Consignment__c>{
                new Consignment__c(
                    Name = 'Boat fittings, Rockland',
                    Pieces__c = 4,
                    Weight__c = 2,
                    Shipper__c = corp.Id
                ),
                new Consignment__c(Name = 'Empty trailer, Portland', Pieces__c = 0, Weight__c = 2)
            };
        }
    }

    private static Grid_Configuration__mdt cfg() {
        return new Grid_Configuration__mdt(
            DeveloperName = 'Consignment_Formulas',
            MasterLabel = 'Consignment Formulas',
            Object_API_Name__c = 'Consignment__c'
        );
    }

    private static Grid_Column__mdt column(String field, Integer order) {
        return new Grid_Column__mdt(
            DeveloperName = 'Consignment_Formulas_' + field.removeEnd('__c'),
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

    private static GridConfig.Definition build(List<Grid_Column__mdt> columns, List<Grid_Display_Rule__mdt> rules) {
        return GridConfig.build(
            cfg(),
            columns,
            rules,
            new List<Grid_Child_Table__mdt>(),
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
                    formula('Fx_Double', 'Cartons', 'Pieces__c * 2', 'number', 20),
                    formula('Fx_Account', 'Shipper name', 'Shipper__r.Name', 'text', 30),
                    formula('Fx_Ratio', 'Weight per piece', 'Weight__c / Pieces__c', 'number', 40)
                },
                new List<Grid_Display_Rule__mdt>()
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
                paths.containsAll(new Set<String>{ 'Pieces__c', 'Shipper__r.Name', 'Weight__c' }),
                String.valueOf(paths)
            );

            Map<String, Map<String, Object>> rows = rowsOf(def);
            System.assert(
                rows.get('Boat fittings, Rockland').get('_fx_Fx_Double') instanceof String,
                'Numbers travel as decimal strings.'
            );
            System.assertEquals(8, Decimal.valueOf((String) rows.get('Boat fittings, Rockland').get('_fx_Fx_Double')));
            System.assertEquals(
                'Casco Bay Marine',
                rows.get('Boat fittings, Rockland').get('_fx_Fx_Account'),
                'A formula reads through a lookup.'
            );
            System.assertEquals(0.5, Decimal.valueOf((String) rows.get('Boat fittings, Rockland').get('_fx_Fx_Ratio')));
            System.assertEquals(
                null,
                rows.get('Empty trailer, Portland').get('_fx_Fx_Ratio'),
                'A division by zero is a blank cell, not a failed page.'
            );
            System.assert(
                !rows.get('Boat fittings, Rockland').containsKey('Pieces__c'),
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
                    formula('Fx_Share', 'Share', 'Pieces__c / 16', 'percent', 20)
                },
                new List<Grid_Display_Rule__mdt>()
            );
            Map<String, Map<String, Object>> rows = rowsOf(def);
            System.assertEquals(
                25,
                Decimal.valueOf((String) rows.get('Boat fittings, Rockland').get('_fx_Fx_Share')),
                'Four pieces: 4 / 16 is 25%.'
            );
            System.assertEquals(0, Decimal.valueOf((String) rows.get('Empty trailer, Portland').get('_fx_Fx_Share')));
        }
    }

    @IsTest
    static void aFormulaThatCannotBeBuiltIsSkippedWithAWarning() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = build(
                new List<Grid_Column__mdt>{
                    column('Name', 10),
                    formula('Fx_Bad', 'Cartons', 'Pieces__c * ', 'number', 20),
                    formula('Fx_No_Label', null, 'Pieces__c', 'number', 30),
                    formula('Fx_No_Type', 'Piece count', 'Pieces__c', 'color', 40)
                },
                new List<Grid_Display_Rule__mdt>()
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
                columns.add(formula('Fx_' + i, 'Pieces plus ' + i, 'Pieces__c + ' + i, 'number', 10 + i));
            }
            GridConfig.Definition def = build(columns, new List<Grid_Display_Rule__mdt>());
            System.assertEquals(GridFormulas.MAX_FORMULAS + 1, def.columns.size());
            System.assert(
                String.join(def.warnings, ' ').contains('at most ' + GridFormulas.MAX_FORMULAS + ' formulas')
            );
        }
    }

    @IsTest
    static void aFormulaRuleMarksTheRowsItMeets() {
        System.runAs(GridTestUsers.fullUser()) {
            Grid_Display_Rule__mdt r = new Grid_Display_Rule__mdt(
                DeveloperName = 'Fx_Rule',
                MasterLabel = 'Large consignment',
                Field_API_Name__c = 'Name',
                Formula__c = 'Pieces__c > 3',
                Style__c = 'icon_warning',
                Apply_To__c = 'cell',
                Inactive__c = false
            );
            GridConfig.Definition def = build(
                new List<Grid_Column__mdt>{ column('Name', 10) },
                new List<Grid_Display_Rule__mdt>{ r }
            );
            System.assertEquals(1, def.displayRules.size(), String.valueOf(def.warnings));
            GridConfig.DisplayRule rule = def.displayRules[0];
            System.assert(rule.isFormula, 'Tested on the server.');
            System.assertEquals('Name', rule.field, 'Its Field is the cell it colors.');
            Map<String, Map<String, Object>> rows = rowsOf(def);
            System.assertEquals(new List<String>{ 'Fx_Rule' }, rows.get('Boat fittings, Rockland').get('_rules'));
            System.assert(
                !rows.get('Empty trailer, Portland').containsKey('_rules'),
                'A row that does not meet it carries nothing.'
            );
        }
    }

    @IsTest
    static void newRuleOptionsAreChecked() {
        Map<String, GridConfig.Column> noColumns = new Map<String, GridConfig.Column>();
        // Between
        GridConfig.DisplayRule between = GridConfig.displayRule(
            new Grid_Display_Rule__mdt(
                DeveloperName = 'Pieces_Between',
                Field_API_Name__c = 'Pieces__c',
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
        GridConfig.DisplayRule two = GridConfig.displayRule(
            new Grid_Display_Rule__mdt(
                DeveloperName = 'Pieces_Over_Charge',
                Field_API_Name__c = 'Pieces__c',
                Operator__c = 'greater_than',
                Compare_Field__c = 'freight_charge__c',
                Style__c = 'bold',
                Apply_To__c = 'row'
            ),
            TEST_RECORD,
            noColumns
        );
        System.assertEquals('Freight_Charge__c', two.compareField, 'The compare field, as describe spells it.');
        System.assertEquals(null, two.value);
        // Refusals, in an admin's terms.
        List<String> refusals = new List<String>();
        for (
            Grid_Display_Rule__mdt bad : new List<Grid_Display_Rule__mdt>{
                new Grid_Display_Rule__mdt(
                    DeveloperName = 'Pieces_Between_No_End',
                    Field_API_Name__c = 'Pieces__c',
                    Operator__c = 'between',
                    Value__c = '1',
                    Style__c = 'bold',
                    Apply_To__c = 'row'
                ),
                new Grid_Display_Rule__mdt(
                    DeveloperName = 'Pieces_Equal_Consignee',
                    Field_API_Name__c = 'Pieces__c',
                    Operator__c = 'equals',
                    Compare_Field__c = 'Consignee__c',
                    Style__c = 'bold',
                    Apply_To__c = 'row'
                ),
                new Grid_Display_Rule__mdt(
                    DeveloperName = 'Consignee_Data_Bar',
                    Field_API_Name__c = 'Consignee__c',
                    Operator__c = 'is_not_blank',
                    Style__c = 'data_bar',
                    Apply_To__c = 'row'
                ),
                new Grid_Display_Rule__mdt(
                    DeveloperName = 'Pieces_Value_And_Charge',
                    Field_API_Name__c = 'Pieces__c',
                    Operator__c = 'equals',
                    Value__c = '1',
                    Compare_Field__c = 'Freight_Charge__c',
                    Style__c = 'bold',
                    Apply_To__c = 'row'
                ),
                new Grid_Display_Rule__mdt(
                    DeveloperName = 'Every_Row_Bold',
                    Formula__c = 'true',
                    Style__c = 'bold',
                    Apply_To__c = 'cell'
                )
            }
        ) {
            try {
                GridConfig.displayRule(bad, TEST_RECORD, noColumns);
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
            System.assert(GridFormulas.canRead(TEST_RECORD, 'Shipper__r.Name'));
            System.assert(!GridFormulas.canRead(TEST_RECORD, 'Trailer__r.Name'));
        }
        System.runAs(GridTestUsers.limitedUser()) {
            System.assert(GridFormulas.canRead(TEST_RECORD, 'Pieces__c'));
            System.assert(
                !GridFormulas.canRead(TEST_RECORD, 'Shipper__r.Name'),
                'Freight_Limited_Access cannot read the lookup.'
            );
            System.assert(!GridFormulas.canReadAll(TEST_RECORD, new List<String>{ 'Pieces__c', 'Fuel_Surcharge__c' }));
        }
    }

    @IsTest
    static void aPathReachesTheQueryOnlyAsDescribeNamesIt() {
        String path = GridFormulas.qualified(TEST_RECORD, 'shipper__r.name');
        System.assert(path.endsWith('Shipper__r.Name'), 'Full API names from describe: ' + path);
        for (String bad : new List<String>{ 'Trailer__r.Name', 'Consignee__c.Name', 'Trailer_Number__c' }) {
            String refusal;
            try {
                GridFormulas.qualified(TEST_RECORD, bad);
            } catch (GridException e) {
                refusal = e.getMessage();
            }
            System.assertNotEquals(null, refusal, bad + ' is not sent to the query as written.');
        }
    }

    @IsTest
    static void columnsReadTheSameWhoeverReadsThem() {
        // By SOQL for a user who may query the type, by getAll() for one who may
        // not: the same columns. Only the first can read a formula longer
        // than getAll() hands back whole; the other keeps its first 255
        // characters, as everyone did before, and the formula is skipped.
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance('Consignment_Review');
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
            byQuery.get('Consignment_Review_Size_Band').length() > GridConfig.CACHED_TEXT_LIMIT,
            'Read whole by SOQL.'
        );
    }

    @IsTest
    static void aFormulaLongerThan255CharactersIsReadWhole() {
        // getAll() returns only the first 255 characters of a Long Text Area field.
        // The fixture Consignment_Review_Size_Band (test-data/config) has a longer formula.
        String formula;
        System.runAs(GridTestUsers.fullUser()) {
            for (Grid_Column__mdt c : GridConfig.columnsOf(Grid_Configuration__mdt.getInstance('Consignment_Review'))) {
                if (c.DeveloperName == 'Consignment_Review_Size_Band') {
                    formula = c.Formula__c;
                }
            }
            System.assert(formula != null && formula.length() > GridConfig.CACHED_TEXT_LIMIT, String.valueOf(formula));
            System.assert(formula.endsWith(')))))))'), formula);
            Boolean shown = false;
            for (GridConfig.Column c : GridConfig.load('Consignment_Review').columns) {
                shown |= c.field == '_fx_Consignment_Review_Size_Band';
            }
            System.assert(shown, 'The whole formula builds, so the column is not skipped.');
        }
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Consignment_Review').get('draft');
            for (GridAdmin.ColumnDraft col : d.columns) {
                if (col.name == 'Consignment_Review_Size_Band') {
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
