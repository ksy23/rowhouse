/**
 * DEVELOPMENT ONLY. Never packaged.
 * The Grid Admin tab's server: who may use it, reading a
 * configuration as a draft, checking a draft with the grid's own code, and
 * what a save deploys. A test cannot deploy metadata, so the deploy is a
 * stand-in that keeps what it was given.
 */
@IsTest
private class GridAdminTest {
    private class Kept implements GridAdmin.Deployer {
        public Metadata.DeployContainer container;
        public Metadata.DeployCallback callback;
        public Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback) {
            this.container = container;
            this.callback = callback;
            return UserInfo.getUserId(); // any Id: the page only hands it back
        }
    }

    private static Map<String, Metadata.CustomMetadata> byName(Metadata.DeployContainer container) {
        Map<String, Metadata.CustomMetadata> out = new Map<String, Metadata.CustomMetadata>();
        for (Metadata.Metadata m : container.getMetadata()) {
            out.put(m.fullName, (Metadata.CustomMetadata) m);
        }
        return out;
    }

    private static Object valueOf(Metadata.CustomMetadata record, String field) {
        for (Metadata.CustomMetadataValue v : record.values) {
            if (v.field == field) {
                return v.value;
            }
        }
        return 'not sent';
    }

    private static GridAdmin.Draft newDraft(String name) {
        GridAdmin.Draft d = new GridAdmin.Draft();
        d.config.name = name;
        d.config.label = 'New Grid';
        d.config.isNew = true;
        d.config.objectApiName = 'Rowhouse_Test_Record__c';
        GridAdmin.ColumnDraft nameCol = new GridAdmin.ColumnDraft();
        nameCol.field = 'Name';
        d.columns.add(nameCol);
        GridAdmin.ColumnDraft amount = new GridAdmin.ColumnDraft();
        amount.field = 'Currency_Field__c';
        amount.columnLabel = 'Amount';
        amount.editable = true;
        amount.subtotal = 'sum';
        d.columns.add(amount);
        return d;
    }

    @IsTest
    static void everythingNeedsTheRowhouseAdminPermission() {
        System.runAs(GridTestUsers.fullUser()) {
            for (Integer i = 0; i < 3; i++) {
                try {
                    if (i == 0)
                        GridAdmin.listConfigs();
                    if (i == 1)
                        GridAdmin.readConfig('Test_Records');
                    if (i == 2)
                        GridAdmin.save(newDraft('Not_Allowed'));
                    System.assert(false, 'Call ' + i + ' should have been refused.');
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
                }
            }
            System.assertEquals(
                false,
                GridController.getGridConfig('Test_Records').get('canConfigure'),
                'No gear without Rowhouse Grid Admin.'
            );
        }
    }

    @IsTest
    static void anAdminWithoutCustomizeApplicationMayReadButNotSave() {
        System.runAs(GridTestUsers.adminViewer()) {
            Map<String, Object> read = GridAdmin.readConfig('Test_Records');
            System.assertEquals(false, read.get('canSave'));
            System.assertEquals(
                true,
                GridController.getGridConfig('Test_Records').get('canConfigure'),
                'The gear shows.'
            );
            GridAdmin.deployWith = new Kept();
            try {
                GridAdmin.save((GridAdmin.Draft) read.get('draft'));
                System.assert(false, 'Saving needs Customize Application.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Customize Application'), e.getMessage());
            }
            System.assertEquals(null, ((Kept) GridAdmin.deployWith).container, 'Nothing was deployed.');
        }
    }

    @IsTest
    static void aConfigurationReadsBackAsADraftInOrderAndChecksClean() {
        System.runAs(GridTestUsers.adminUser()) {
            Map<String, Object> read = GridAdmin.readConfig('Test_Records');
            System.assertEquals(true, read.get('canSave'), 'A System Administrator may save.');
            GridAdmin.Draft d = (GridAdmin.Draft) read.get('draft');
            System.assertEquals('Test_Records', d.config.name);
            System.assertEquals('Rowhouse_Test_Record__c', d.config.objectApiName);
            System.assertEquals(false, d.config.isNew);
            System.assertEquals(true, d.config.showRowNumbers, 'Show Row Numbers reads back.');
            GridConfig.Definition def = GridConfig.load('Test_Records');
            System.assertEquals(def.columns.size(), d.columns.size());
            for (Integer i = 0; i < d.columns.size(); i++) {
                System.assertEquals(
                    def.columns[i].field.toLowerCase(),
                    d.columns[i].field.toLowerCase(),
                    'Column ' + i
                );
                System.assertEquals(
                    def.columns[i].alwaysShown,
                    d.columns[i].alwaysShown,
                    'Always Shown reads back: ' + def.columns[i].field
                );
            }
            Boolean switchedOff = false;
            for (GridAdmin.RuleDraft r : d.rules) {
                if (r.active == false)
                    switchedOff = true;
            }
            System.assert(switchedOff, 'A rule that is off is in the draft, so it can be turned back on.');
            System.assertEquals(1, d.children.size());
            System.assertEquals('Test_Children', d.children[0].childConfig, 'A child table names its grid.');

            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals(def.warnings, result.warnings, 'The draft is checked by the grid\'s own code.');
        }
    }

    @IsTest
    static void aTurnedOffColumnIsLeftOutOfTheGrid() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Off_Test');
            d.columns[1].inactive = true;
            GridAdmin.deployWith = new Kept();
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(((Kept) GridAdmin.deployWith).container);
            System.assertEquals(
                true,
                valueOf(sent.get('Grid_Column__mdt.Off_Test_Currency_Field'), 'Inactive__c'),
                'A turned-off column is saved off, not left out: Apex cannot delete it.'
            );

            GridConfig.Definition def = GridConfig.build(
                GridAdmin.configRecord(d),
                GridAdmin.columnRecords(d),
                new List<Grid_Format_Rule__mdt>(),
                new List<Grid_Child__mdt>(),
                new List<Grid_Action__mdt>()
            );
            System.assertEquals(1, def.columns.size(), 'The grid leaves the turned-off column out.');
            System.assertEquals('Name', def.columns[0].field);
        }
    }

    @IsTest
    static void aDraftThatCannotWorkIsRefusedWithReasons() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft taken = newDraft('Test_Records');
            System.assert(String.join(GridAdmin.check(taken).errors, ' ').contains('already exists'));

            GridAdmin.Draft badName = newDraft('2_Bad__Name_');
            System.assert(String.join(GridAdmin.check(badName).errors, ' ').contains('must start with a letter'));

            GridAdmin.Draft noTitle = newDraft('No_Title');
            noTitle.config.label = ' ';
            System.assert(String.join(GridAdmin.check(noTitle).errors, ' ').contains('title'));

            GridAdmin.Draft noObject = newDraft('No_Object');
            noObject.config.objectApiName = 'Not_An_Object__c';
            System.assert(String.join(GridAdmin.check(noObject).errors, ' ').contains('Not_An_Object__c'));

            GridAdmin.Draft badField = newDraft('Bad_Field');
            badField.columns[1].field = 'Not_A_Field__c';
            System.assert(String.join(GridAdmin.check(badField).errors, ' ').contains('Not_A_Field__c'));

            GridAdmin.Draft twice = newDraft('Twice');
            twice.columns[1].field = 'Name';
            System.assert(String.join(GridAdmin.check(twice).errors, ' ').contains('twice'));

            GridAdmin.Draft allOff = newDraft('All_Off');
            allOff.columns[0].inactive = true;
            allOff.columns[1].inactive = true;
            System.assert(String.join(GridAdmin.check(allOff).errors, ' ').contains('at least one column'));

            GridAdmin.Draft badSort = newDraft('Bad_Sort');
            badSort.config.sortField = 'Nope__c';
            System.assert(String.join(GridAdmin.check(badSort).errors, ' ').contains('Default sort'));

            GridAdmin.Draft ruleWithoutMeaning = newDraft('Rule_Test');
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.field = 'Currency_Field__c';
            r.operator = 'greater_than';
            r.value = '100';
            r.style = 'fill_green';
            ruleWithoutMeaning.rules.add(r);
            System.assert(String.join(GridAdmin.check(ruleWithoutMeaning).errors, ' ').contains('meaning'));

            GridAdmin.Draft ownChild = newDraft('Test_Children');
            ownChild.config.isNew = false;
            ownChild.config.objectApiName = 'Rowhouse_Test_Child__c';
            ownChild.columns.remove(1);
            GridAdmin.ChildDraft child = new GridAdmin.ChildDraft();
            child.childConfig = 'Test_Children';
            child.relationshipField = 'Parent__c';
            ownChild.children.add(child);
            System.assert(String.join(GridAdmin.check(ownChild).errors, ' ').contains('itself'));

            GridAdmin.Draft moved = (GridAdmin.Draft) GridAdmin.readConfig('Test_Records').get('draft');
            moved.config.objectApiName = 'Account';
            System.assert(String.join(GridAdmin.check(moved).errors, ' ').contains('cannot be changed'));
        }
    }

    @IsTest
    static void whatTheGridWouldSkipIsAWarningNotAnError() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Warn_Test');
            d.columns[0].subtotal = 'sum'; // a sum of a name
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.label = 'Big';
            r.field = 'Currency_Field__c';
            r.operator = 'contains';
            r.value = '1';
            r.style = 'fill_green';
            d.rules.add(r);
            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals(2, result.warnings.size(), String.join(result.warnings, ' | '));
        }
    }

    @IsTest
    static void aSaveDeploysEveryRecordWithEveryFieldNamedAfterTheGrid() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Brand_New');
            d.columns[0].alwaysShown = true;
            d.columns[0].allowGrouping = true;
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.label = 'Big amount';
            r.field = 'Currency_Field__c';
            r.operator = 'greater_than';
            r.value = '1000';
            r.style = 'fill_green';
            d.rules.add(r);
            GridAdmin.ActionDraft a = new GridAdmin.ActionDraft();
            a.label = 'Add a note';
            a.type = 'Apex';
            a.actionName = 'RowhouseTestAddNote';
            a.showIn = 'Both';
            d.actions.add(a);
            GridAdmin.ChildDraft child = new GridAdmin.ChildDraft();
            child.childConfig = 'Test_Children';
            child.relationshipField = 'Parent__c';
            child.tabLabel = 'Children';
            child.height = 300;
            d.children.add(child);
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;

            String jobId = GridAdmin.save(d);

            System.assertEquals(String.valueOf(UserInfo.getUserId()), jobId);
            System.assert(spy.callback instanceof GridAdminDeploy);
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            System.assertEquals(6, sent.size(), String.valueOf(sent.keySet()));
            Metadata.CustomMetadata cfg = sent.get('Grid_Configuration__mdt.Brand_New');
            System.assertEquals('New Grid', cfg.label);
            System.assertEquals('Rowhouse_Test_Record__c', valueOf(cfg, 'Object_API_Name__c'));
            System.assertEquals(true, valueOf(cfg, 'Allow_Inline_Edit__c'));
            System.assertEquals(null, valueOf(cfg, 'Height_Px__c'), 'Every field is sent, blank ones as null.');
            System.assertEquals(true, valueOf(cfg, 'Show_Row_Numbers__c'), 'A new grid numbers its rows.');

            Metadata.CustomMetadata nameCol = sent.get('Grid_Column__mdt.Brand_New_Name');
            System.assertEquals(
                'Brand_New',
                valueOf(nameCol, 'Grid_Configuration__c'),
                'Linked by the grid\'s API name.'
            );
            System.assertEquals(Decimal.valueOf(10), valueOf(nameCol, 'Sort_Order__c'));
            System.assertEquals(false, valueOf(nameCol, 'Inactive__c'));
            System.assertEquals(true, valueOf(nameCol, 'Always_Shown__c'), 'Always Shown is saved.');
            System.assertEquals(true, valueOf(nameCol, 'Allow_Grouping__c'), 'Allow Grouping is saved.');
            Metadata.CustomMetadata amount = sent.get('Grid_Column__mdt.Brand_New_Currency_Field');
            System.assertEquals('Amount', amount.label, 'A new column is labelled with its header.');
            System.assertEquals(Decimal.valueOf(20), valueOf(amount, 'Sort_Order__c'));
            System.assertEquals('sum', valueOf(amount, 'Subtotal__c'));
            System.assertEquals(true, valueOf(amount, 'Editable__c'));
            System.assertEquals(false, valueOf(amount, 'Always_Shown__c'), 'Unticked unless the admin ticks it.');
            System.assertEquals(false, valueOf(amount, 'Allow_Grouping__c'), 'Unticked unless the admin ticks it.');

            Metadata.CustomMetadata rule = sent.get('Grid_Format_Rule__mdt.Brand_New_Big_amount');
            System.assertEquals('Big amount', rule.label);
            System.assertEquals(true, valueOf(rule, 'Active__c'));
            Metadata.CustomMetadata action = sent.get('Grid_Action__mdt.Brand_New_Add_a_note');
            System.assertEquals('Add a note', action.label);
            Metadata.CustomMetadata link = sent.get('Grid_Child__mdt.Brand_New_Children');
            System.assertEquals('Test_Children', valueOf(link, 'Child_Configuration__c'));
            System.assertEquals('Brand_New', valueOf(link, 'Grid_Configuration__c'));
            System.assertEquals(
                Decimal.valueOf(300),
                valueOf(link, 'Height_Px__c'),
                'A child table\'s Height is saved.'
            );
        }
    }

    @IsTest
    static void anExistingRecordKeepsItsNameAndLabel() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Test_Records').get('draft');
            GridAdmin.ColumnDraft first = d.columns.remove(0);
            d.columns.add(first); // moved to the end
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            Metadata.CustomMetadata moved = sent.get('Grid_Column__mdt.' + first.name);
            System.assertNotEquals(null, moved, 'Saved under its own name: ' + first.name);
            System.assertEquals(Grid_Column__mdt.getInstance(first.name).MasterLabel, moved.label);
            System.assertEquals(Decimal.valueOf(d.columns.size() * 10), valueOf(moved, 'Sort_Order__c'), 'Now last.');
        }
    }

    @IsTest
    static void newRecordNamesAreCleanUniqueAndShort() {
        List<String> names = GridAdmin.names(
            'Pipeline',
            new List<String>{ null, null, 'Kept_Name', null },
            new List<String>{ 'Amount', 'Amount', 'x', 'A very long field label that will not fit in forty' },
            new Set<String>{ 'Pipeline_Amount' }
        );
        System.assertEquals('Pipeline_Amount_2', names[0], 'Taken in the org.');
        System.assertEquals('Pipeline_Amount_3', names[1], 'Taken in the draft.');
        System.assertEquals('Kept_Name', names[2]);
        System.assert(names[3].length() <= 40, names[3]);
        System.assert(!names[3].endsWith('_'), names[3]);
        System.assertEquals('Close_Date', GridAdmin.clean('Close Date__c'.removeEndIgnoreCase('__c')));
        System.assertEquals('X2_Day_Total', GridAdmin.clean('2-Day  Total'));
        System.assertEquals(null, GridAdmin.nameProblem('Good_Name_1'));
        System.assertNotEquals(null, GridAdmin.nameProblem('Two__Underscores'));
        System.assertNotEquals(null, GridAdmin.nameProblem('Ends_'));
        System.assertNotEquals(null, GridAdmin.nameProblem('A'.repeat(41)));
    }

    @IsTest
    static void theDeployOutcomeIsKeptForThePageAndReadOnce() {
        User admin = GridTestUsers.adminUser();
        System.runAs(admin) {
            // A deployment's Id is an Id (measured: 'job-ok' is refused), prefix 0Af.
            Metadata.DeployResult ok = new Metadata.DeployResult();
            ok.id = '0Afhk0000000001';
            ok.status = Metadata.DeployStatus.Succeeded;
            new GridAdminDeploy(admin.Id).handleResult(ok, null);

            Metadata.DeployResult failed = new Metadata.DeployResult();
            failed.id = '0Afhk0000000002';
            failed.status = Metadata.DeployStatus.Failed;
            Metadata.DeployMessage m = new Metadata.DeployMessage();
            m.fullName = 'Grid_Column__mdt.X';
            m.problem = 'Something went wrong';
            failed.details = new Metadata.DeployDetails();
            failed.details.componentFailures = new List<Metadata.DeployMessage>{ m };
            new GridAdminDeploy(admin.Id).handleResult(failed, null);

            System.assertEquals('pending', GridAdmin.saveStatus('0Afhk0000000003').get('status'));
            Map<String, Object> first = GridAdmin.saveStatus(String.valueOf(ok.id));
            System.assertEquals('Succeeded', first.get('status'));
            System.assertEquals(
                'pending',
                GridAdmin.saveStatus(String.valueOf(ok.id)).get('status'),
                'Read once, then gone.'
            );
            Map<String, Object> second = GridAdmin.saveStatus(String.valueOf(failed.id));
            System.assertEquals('Failed', second.get('status'));
            System.assertEquals(new List<String>{ 'Grid_Column__mdt.X: Something went wrong' }, second.get('messages'));
        }
    }

    @IsTest
    static void theObjectsAndFieldsOnOffer() {
        System.runAs(GridTestUsers.adminUser()) {
            Set<String> objects = new Set<String>();
            for (Map<String, String> o : GridAdmin.listObjects()) {
                objects.add(o.get('name'));
            }
            System.assert(objects.contains('Account'));
            System.assert(objects.contains('Rowhouse_Test_Record__c'));
            System.assert(!objects.contains('Grid_Configuration__mdt'), 'Not Rowhouse\'s own metadata.');

            Map<String, Object> described = GridAdmin.describeObject('Rowhouse_Test_Record__c');
            Map<String, Map<String, Object>> fields = new Map<String, Map<String, Object>>();
            for (Map<String, Object> f : (List<Map<String, Object>>) described.get('fields')) {
                fields.put((String) f.get('name'), f);
            }
            System.assertEquals('currency', fields.get('Currency_Field__c').get('type'));
            System.assert(((List<String>) fields.get('Currency_Field__c').get('subtotals')).contains('sum'));
            System.assertEquals(false, fields.get('Formula_Number__c').get('editable'), 'A formula never is.');
            System.assertEquals(true, fields.get('Name').get('isName'));
            Boolean childOffered = false;
            for (Map<String, Object> c : (List<Map<String, Object>>) described.get('children')) {
                if (c.get('config') == 'Test_Children') {
                    childOffered = ((List<String>) c.get('fields')).contains('Parent__c');
                }
            }
            System.assert(childOffered, 'Test_Children can be a child table: its Parent__c points here.');

            Set<String> configs = new Set<String>();
            for (Map<String, Object> c : GridAdmin.listConfigs()) {
                configs.add((String) c.get('name'));
                if (c.get('name') == 'Test_Records') {
                    // The Grid Admin tab's stat cards: its child table, and that it does not log.
                    System.assertEquals(1, c.get('childTables'), 'Test Records has one child table.');
                    System.assertEquals(false, c.get('logChanges'));
                }
                if (c.get('name') == 'Audit_Test') {
                    System.assertEquals(true, c.get('logChanges'), 'Audit Test logs every change.');
                }
            }
            System.assert(configs.contains('Test_Records'));
        }
    }

    @IsTest
    static void filtersFormulasAndTheRecordPageAreCheckedAndSaved() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('New_Settings');
            d.config.recordPageField = 'Lookup_Field__c';
            GridAdmin.FilterDraft filter = new GridAdmin.FilterDraft();
            filter.field = 'Number_Field__c';
            filter.operator = 'greater_than';
            filter.value = '10';
            d.filters.add(filter);
            GridAdmin.ColumnDraft fx = new GridAdmin.ColumnDraft();
            fx.columnLabel = 'Double';
            fx.formula = 'Number_Field__c * 2';
            fx.formulaType = 'number';
            fx.decimalPlaces = 1;
            d.columns.add(fx);
            GridAdmin.RuleDraft between = new GridAdmin.RuleDraft();
            between.label = 'Mid';
            between.field = 'Currency_Field__c';
            between.operator = 'between';
            between.value = '1';
            between.valueTo = '9';
            between.style = 'data_bar';
            between.applyTo = 'cell';
            d.rules.add(between);
            GridAdmin.RuleDraft formulaRule = new GridAdmin.RuleDraft();
            formulaRule.label = 'Big';
            formulaRule.formula = 'Number_Field__c > 100';
            formulaRule.style = 'icon_warning';
            formulaRule.applyTo = 'row';
            d.rules.add(formulaRule);

            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals(new List<String>(), result.warnings);

            GridAdmin.deployWith = new Kept();
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(((Kept) GridAdmin.deployWith).container);
            System.assertEquals(
                'Lookup_Field__c',
                valueOf(sent.get('Grid_Configuration__mdt.New_Settings'), 'Record_Page_Field__c')
            );
            Metadata.CustomMetadata savedFilter = sent.get('Grid_Filter__mdt.New_Settings_Number_Field');
            System.assertNotEquals(null, savedFilter, String.valueOf(sent.keySet()));
            System.assertEquals('greater_than', valueOf(savedFilter, 'Operator__c'));
            System.assertEquals('New_Settings', valueOf(savedFilter, 'Grid_Configuration__c'));
            Metadata.CustomMetadata savedFx = sent.get('Grid_Column__mdt.New_Settings_Double');
            System.assertNotEquals(null, savedFx, String.valueOf(sent.keySet()));
            System.assertEquals('Number_Field__c * 2', valueOf(savedFx, 'Formula__c'));
            System.assertEquals(null, valueOf(savedFx, 'Field_API_Name__c'), 'A formula column has no field.');
            System.assertEquals('9', valueOf(sent.get('Grid_Format_Rule__mdt.New_Settings_Mid'), 'Value_To__c'));
        }
    }

    @IsTest
    static void whatTheMetadataCannotHoldIsRefusedBeforeSave() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Too_Long');
            GridAdmin.ColumnDraft fx = new GridAdmin.ColumnDraft();
            fx.columnLabel = 'L'.repeat(81);
            fx.formula = 'Number_Field__c' + ' + 0'.repeat(1000);
            fx.formulaType = 'number';
            fx.decimalPlaces = 12;
            d.columns.add(fx);
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.label = 'Long';
            r.field = 'Text_Field__c';
            r.operator = 'equals';
            r.value = 'v'.repeat(256);
            r.style = 'bold';
            r.applyTo = 'row';
            d.rules.add(r);
            GridAdmin.FilterDraft f = new GridAdmin.FilterDraft();
            f.field = 'Text_Field__c';
            f.operator = 'equals';
            f.value = 'w'.repeat(256);
            d.filters.add(f);
            String errors = String.join(GridAdmin.check(d).errors, ' | ');
            System.assert(errors.contains('the column label is 81 characters; 80 at most'), errors);
            System.assert(errors.contains('the formula is 4015 characters; 3900 at most'), errors);
            System.assert(errors.contains('decimal places are 0 to 9'), errors);
            System.assert(errors.contains('Display rule "Long": its value is 256 characters; 255 at most'), errors);
            System.assert(errors.contains('Filter 1: its value is 256 characters; 255 at most'), errors);
        }
    }

    @IsTest
    static void aFilterOrFormulaThatCannotWorkKeepsSaveOff() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft badFilter = newDraft('Bad_Filter');
            GridAdmin.FilterDraft filter = new GridAdmin.FilterDraft();
            filter.field = 'Number_Field__c';
            filter.operator = 'contains';
            filter.value = '1';
            badFilter.filters.add(filter);
            String errors = String.join(GridAdmin.check(badFilter).errors, ' ');
            System.assert(errors.contains('Grid Filter') && errors.contains('does not apply'), errors);

            GridAdmin.Draft badFormula = newDraft('Bad_Formula');
            GridAdmin.ColumnDraft fx = new GridAdmin.ColumnDraft();
            fx.columnLabel = 'Broken';
            fx.formula = 'Number_Field__c * ';
            fx.formulaType = 'number';
            badFormula.columns.add(fx);
            errors = String.join(GridAdmin.check(badFormula).errors, ' ');
            System.assert(errors.contains('Broken: the formula does not work'), errors);

            // Added with Add formula column and not written yet: said in the editor's
            // own words, and not as a column without a field.
            GridAdmin.Draft unwritten = newDraft('Unwritten');
            GridAdmin.ColumnDraft blank = new GridAdmin.ColumnDraft();
            blank.formula = '';
            blank.formulaType = 'number';
            unwritten.columns.add(blank);
            errors = String.join(GridAdmin.check(unwritten).errors, ' | ');
            System.assert(errors.contains('Formula column 3: write its formula.'), errors);
            System.assert(errors.contains('Formula column 3: give it a header.'), errors);
            System.assert(!errors.contains('needs a field'), errors);

            GridAdmin.Draft badPage = newDraft('Bad_Page');
            badPage.config.recordPageField = 'Text_Field__c';
            errors = String.join(GridAdmin.check(badPage).errors, ' ');
            System.assert(errors.contains('is not a lookup'), errors);
        }
    }

    @IsTest
    static void aChildTotalColumnIsCheckedAndSavedWithItsChildTable() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Test_Records').get('draft');
            GridAdmin.ColumnDraft total = new GridAdmin.ColumnDraft();
            total.childTable = 'Test_Records_Children';
            total.childTotal = 'sum';
            total.childField = 'Amount__c';
            d.columns.add(total);
            GridAdmin.Check ok = GridAdmin.check(d);
            System.assertEquals(new List<String>(), ok.errors, 'A child total of a child table of the grid.');

            total.childField = null;
            GridAdmin.Check missing = GridAdmin.check(d);
            System.assert(
                String.join(missing.errors, ' | ').contains('a sum needs the Child Field to work out.'),
                String.join(missing.errors, ' | ')
            );
            total.childField = 'Amount__c';
            total.childTable = null;
            total.childTotal = 'sum';
            System.assert(String.join(GridAdmin.check(d).errors, ' | ').contains('choose the child table it totals.'));
            total.childTable = 'Test_Records_Children';

            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            Metadata.CustomMetadata sent = null;
            for (Metadata.CustomMetadata m : byName(spy.container).values()) {
                if (valueOf(m, 'Child_Table__c') == 'Test_Records_Children') {
                    sent = m;
                }
            }
            System.assertNotEquals(null, sent, 'The child total column is deployed.');
            System.assertEquals('sum', valueOf(sent, 'Child_Total__c'));
            System.assertEquals('Amount__c', valueOf(sent, 'Child_Field__c'));
            System.assertEquals(null, valueOf(sent, 'Field_API_Name__c'), 'It has no field of its own.');
        }
    }

    // ------------------------------------------------------------ row actions

    @IsTest
    static void anArchivedGridIsListedAsArchivedAndKeptOutOfUse() {
        System.runAs(GridTestUsers.adminUser()) {
            Map<String, Object> archived = null;
            for (Map<String, Object> c : GridAdmin.listConfigs()) {
                if (c.get('name') == 'Test_Archived') {
                    archived = c;
                }
                if (c.get('name') == 'Test_Children') {
                    System.assert(
                        ((List<String>) c.get('usedBy')).contains('Test Records'),
                        'Test Records shows Test Children as a child table: ' + c.get('usedBy')
                    );
                }
                if (c.get('name') == 'Test_Records') {
                    System.assertEquals(false, c.get('archived'));
                }
            }
            System.assertNotEquals(null, archived, 'An archived grid is still listed, for the Archived view.');
            System.assertEquals(true, archived.get('archived'));
            try {
                GridConfig.load('Test_Archived');
                System.assert(false, 'A page cannot open an archived grid.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Test Archived is archived'), e.getMessage());
            }
            System.assertEquals(
                'Rowhouse_Test_Child__c',
                GridConfig.load('Test_Archived', true).objectApiName,
                'A parent grid\'s child total still reads it.'
            );
            System.assert(
                !GridLogRetention.loggingGrids().contains('Test Archived'),
                'An archived grid writes nothing to the edit log.'
            );
            for (
                Map<String, Object> c : (List<Map<String, Object>>) GridAdmin.describeObject('Rowhouse_Test_Record__c')
                    .get('children')
            ) {
                System.assertNotEquals('Test_Archived', c.get('config'), 'Not offered as a new child table.');
            }
            // A child table that shows it is skipped, with a warning that says why.
            Map<String, Object> m = new Map<String, Object>{
                'DeveloperName' => 'X_Archived_Tab',
                'MasterLabel' => 'X',
                GridDescribe.apiName(Grid_Child__mdt.Relationship_Field__c) => 'Parent__c',
                GridDescribe.apiName(Grid_Child__mdt.Child_Configuration__c) => Grid_Configuration__mdt.getInstance(
                        'Test_Archived'
                    )
                    .Id
            };
            Grid_Child__mdt link = (Grid_Child__mdt) JSON.deserialize(JSON.serialize(m), Grid_Child__mdt.class);
            List<String> warnings = new List<String>();
            List<GridConfig.Child> tabs = GridNesting.childrenFrom(
                new List<Grid_Child__mdt>{ link },
                Rowhouse_Test_Record__c.SObjectType,
                warnings
            );
            System.assertEquals(0, tabs.size(), 'The tab is hidden.');
            System.assert(String.join(warnings, ' ').contains('Test_Archived is archived'), String.join(warnings, ' '));
        }
    }

    @IsTest
    static void archiveAndRestoreDeployTheConfigurationAlone() {
        System.runAs(GridTestUsers.adminUser()) {
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.setArchived('Test_Records', true);
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            System.assertEquals(
                new Set<String>{ 'Grid_Configuration__mdt.Test_Records' },
                sent.keySet(),
                'Its columns and the rest are untouched.'
            );
            Metadata.CustomMetadata cfg = sent.get('Grid_Configuration__mdt.Test_Records');
            System.assertEquals(true, valueOf(cfg, 'Archived__c'));
            System.assertEquals(
                'Rowhouse_Test_Record__c',
                valueOf(cfg, 'Object_API_Name__c'),
                'Every field, as the org has it.'
            );
            System.assertEquals('Test Records', cfg.label);
            System.assert(spy.callback instanceof GridAdminDeploy, 'Its outcome is read like a save\'s.');

            GridAdmin.setArchived('Test_Archived', false);
            System.assertEquals(
                false,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Test_Archived'), 'Archived__c'),
                'Restored.'
            );
            System.assertEquals(
                true,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Test_Archived'), 'Log_Changes__c'),
                'The rest as it was.'
            );
            System.assertEquals(
                false,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Test_Archived'), 'Show_Row_Numbers__c'),
                'Show Row Numbers as it was.'
            );
        }
    }

    @IsTest
    static void aSaveKeepsArchivedAsTheOrgHasIt() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Test_Records').get('draft');
            System.assertEquals(false, d.config.archived);
            d.config.archived = true;
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            System.assertEquals(
                false,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Test_Records'), 'Archived__c'),
                'Only archive changes it.'
            );

            GridAdmin.Draft archived = (GridAdmin.Draft) GridAdmin.readConfig('Test_Archived').get('draft');
            System.assertEquals(true, archived.config.archived);
            System.assertEquals(false, archived.config.showRowNumbers, 'Show Row Numbers reads back unchecked.');
            archived.config.showRowNumbers = true;
            archived.config.archived = false;
            GridAdmin.save(archived);
            System.assertEquals(
                true,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Test_Archived'), 'Archived__c'),
                'Saving an archived grid keeps it archived.'
            );
            System.assertEquals(
                true,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Test_Archived'), 'Show_Row_Numbers__c'),
                'Checking Show Row Numbers is saved.'
            );
        }
    }

    @IsTest
    static void aCloneCopiesEveryRecordUnderNewNames() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft source = (GridAdmin.Draft) GridAdmin.readConfig('Nest_Accounts').get('draft');
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.cloneConfig('Nest_Accounts', 'Copy of Nest Accounts', 'Copy_of_Nest_Accounts');
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            Integer records =
                1 +
                source.columns.size() +
                source.rules.size() +
                source.filters.size() +
                source.actions.size() +
                source.children.size();
            System.assertEquals(records, sent.size(), String.valueOf(sent.keySet()));
            Metadata.CustomMetadata cfg = sent.get('Grid_Configuration__mdt.Copy_of_Nest_Accounts');
            System.assertEquals('Copy of Nest Accounts', cfg.label);
            System.assertEquals('Account', valueOf(cfg, 'Object_API_Name__c'));
            System.assertEquals(false, valueOf(cfg, 'Archived__c'));
            Set<String> links = new Set<String>();
            for (String fullName : sent.keySet()) {
                if (fullName == 'Grid_Configuration__mdt.Copy_of_Nest_Accounts') {
                    continue;
                }
                System.assert(
                    fullName.substringAfter('.').startsWith('Copy_of_Nest_Accounts_'),
                    'A new record, named after the copy: ' + fullName
                );
                System.assertEquals('Copy_of_Nest_Accounts', valueOf(sent.get(fullName), 'Grid_Configuration__c'));
                if (fullName.startsWith('Grid_Child__mdt.')) {
                    links.add(fullName.substringAfter('.'));
                }
            }
            Integer totals = 0;
            for (String fullName : sent.keySet()) {
                Object table = fullName.startsWith('Grid_Column__mdt.')
                    ? valueOf(sent.get(fullName), 'Child_Table__c')
                    : null;
                if (table != null) {
                    totals++;
                    System.assert(
                        links.contains((String) table),
                        'A child total column totals the copy\'s child table: ' + table + ' in ' + links
                    );
                }
            }
            System.assertEquals(2, totals, 'Both child total columns are copied.');

            try {
                GridAdmin.cloneConfig('Nest_Accounts', 'Again', 'Test_Records');
                System.assert(false, 'A clone cannot take an existing grid\'s API name.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('A grid named Test_Records already exists'), e.getMessage());
            }
            try {
                GridAdmin.cloneConfig('Nest_Accounts', '', 'Untitled_Copy');
                System.assert(false, 'A clone needs a title.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Give the grid a title'), e.getMessage());
            }
        }
    }

    @IsTest
    static void rowActionsThatDeployNeedCustomizeApplication() {
        System.runAs(GridTestUsers.adminViewer()) {
            GridAdmin.deployWith = new Kept();
            for (Integer i = 0; i < 2; i++) {
                try {
                    if (i == 0)
                        GridAdmin.setArchived('Test_Records', true);
                    if (i == 1)
                        GridAdmin.cloneConfig('Test_Records', 'Copy', 'Copy_Records');
                    System.assert(false, 'Call ' + i + ' needs Customize Application.');
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('Customize Application'), e.getMessage());
                }
            }
            System.assertEquals(null, ((Kept) GridAdmin.deployWith).container, 'Nothing was deployed.');
            System.assert(
                !GridAdmin.setupRecords('Test_Records').isEmpty(),
                'Seeing what to delete needs only Rowhouse Grid Admin.'
            );
        }
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridAdmin.setupRecords('Test_Records');
                System.assert(false, 'Not without Rowhouse Grid Admin.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
        }
    }

    @IsTest
    static void setupListsEveryRecordToDeleteWithTheGridLast() {
        System.runAs(GridTestUsers.adminUser()) {
            List<Map<String, String>> items = GridAdmin.setupRecords('Test_Children');
            Integer firstOwn = null;
            Set<String> others = new Set<String>();
            Set<String> columns = new Set<String>();
            for (Integer i = 0; i < items.size(); i++) {
                Map<String, String> item = items[i];
                System.assert(
                    item.get('url').startsWith('/lightning/setup/CustomMetadata/page?address=%2F'),
                    item.get('url')
                );
                if (item.get('note') != null && item.get('note').startsWith('A child table of')) {
                    System.assertEquals(null, firstOwn, 'Other grids\' child tables come before its own records.');
                    others.add(item.get('name'));
                } else if (firstOwn == null) {
                    firstOwn = i;
                }
                if (item.get('kind') == 'Grid Column') {
                    columns.add(item.get('name'));
                }
            }
            System.assert(others.contains('Test_Records_Children'), 'Test Records\' child table shows it: ' + others);
            System.assert(
                columns.contains('Test_Children_Name') && columns.contains('Test_Children_Amount'),
                String.valueOf(columns)
            );
            Map<String, String> last = items[items.size() - 1];
            System.assertEquals('Test_Children', last.get('name'), 'The grid itself is last.');
            System.assertEquals('Grid Configuration', last.get('kind'));
            System.assert(
                last.get('url').endsWith(String.valueOf(Grid_Configuration__mdt.getInstance('Test_Children').Id)),
                last.get('url')
            );
        }
    }
}
