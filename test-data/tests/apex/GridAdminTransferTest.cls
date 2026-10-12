/**
 * DEVELOPMENT ONLY. Never packaged.
 * Exporting grids to a file and planning an import of one: what a file holds
 * and in what order, who may do it, and that an import never changes a grid
 * this org has: it leaves it as it is, or imports a copy under new names.
 * A test cannot deploy metadata, so saving is a stand-in that keeps what it
 * was given.
 */
@IsTest
private class GridAdminTransferTest {
    private class Kept implements GridAdmin.Deployer {
        public Metadata.DeployContainer container;
        public Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback) {
            this.container = container;
            return UserInfo.getUserId();
        }
    }

    private static List<String> namesOf(List<GridAdmin.Draft> drafts) {
        List<String> out = new List<String>();
        for (GridAdmin.Draft d : drafts) {
            out.add(d.config.name);
        }
        return out;
    }

    private static Map<String, GridAdminTransfer.Item> byName(List<GridAdminTransfer.Item> items) {
        Map<String, GridAdminTransfer.Item> out = new Map<String, GridAdminTransfer.Item>();
        for (GridAdminTransfer.Item it : items) {
            out.put(it.name, it);
        }
        return out;
    }

    private static Set<String> orgRecordNames() {
        Set<String> out = new Set<String>();
        for (String n : Grid_Column__mdt.getAll().keySet()) {
            out.add(n.toLowerCase());
        }
        for (String n : Grid_Format_Rule__mdt.getAll().keySet()) {
            out.add(n.toLowerCase());
        }
        for (String n : Grid_Filter__mdt.getAll().keySet()) {
            out.add(n.toLowerCase());
        }
        for (String n : Grid_Action__mdt.getAll().keySet()) {
            out.add(n.toLowerCase());
        }
        for (String n : Grid_Child__mdt.getAll().keySet()) {
            out.add(n.toLowerCase());
        }
        return out;
    }

    private static GridAdmin.Draft gridOn(String name, String objectApiName) {
        GridAdmin.Draft d = new GridAdmin.Draft();
        d.config.name = name;
        d.config.label = name.replace('_', ' ');
        d.config.objectApiName = objectApiName;
        GridAdmin.ColumnDraft col = new GridAdmin.ColumnDraft();
        col.field = 'Name';
        d.columns.add(col);
        return d;
    }

    private static GridAdmin.ChildDraft childTable(String childConfig, String relationshipField) {
        GridAdmin.ChildDraft ch = new GridAdmin.ChildDraft();
        ch.childConfig = childConfig;
        ch.relationshipField = relationshipField;
        ch.tabLabel = childConfig.replace('_', ' ');
        return ch;
    }

    @IsTest
    static void anExportHoldsEveryChildGridFirstAndEachGridOnce() {
        System.runAs(GridTestUsers.adminUser()) {
            List<GridAdmin.Draft> file = GridAdminTransfer.exportGrids(
                new List<String>{ 'Nest_Accounts', 'Consignment_Items' }
            );
            List<String> names = namesOf(file);
            System.assertEquals(new Set<String>(names).size(), names.size(), 'Each grid once: ' + names);
            System.assertEquals('Nest_Accounts', names[names.size() - 1], 'Its child grids come before it: ' + names);
            System.assert(names.contains('Nest_Contacts'), String.valueOf(names));
            System.assert(
                names.indexOf('Consignment_Items') < names.indexOf('Consignments'),
                'A child grid of a child grid comes first too: ' + names
            );
            GridAdmin.Draft accounts = file[file.size() - 1];
            System.assertEquals(2, accounts.children.size());
            System.assertEquals('Account', accounts.config.objectApiName);
            System.assert(!accounts.columns.isEmpty(), 'With its columns.');
        }
    }

    @IsTest
    static void exportAndImportNeedRowhouseGridAdmin() {
        List<GridAdmin.Draft> file;
        System.runAs(GridTestUsers.adminViewer()) {
            // Reading and planning save nothing: Customize Application is not needed.
            file = GridAdminTransfer.exportGrids(new List<String>{ 'Consignments' });
            System.assertEquals(2, file.size());
            System.assertEquals(2, GridAdminTransfer.planImport(file, false).size());
        }
        System.runAs(GridTestUsers.fullUser()) {
            for (Integer i = 0; i < 2; i++) {
                try {
                    if (i == 0)
                        GridAdminTransfer.exportGrids(new List<String>{ 'Consignments' });
                    if (i == 1)
                        GridAdminTransfer.planImport(file, false);
                    System.assert(false, 'Call ' + i + ' needs Rowhouse Grid Admin.');
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
                }
            }
        }
    }

    @IsTest
    static void aGridThisOrgHasIsLeftAsItIs() {
        System.runAs(GridTestUsers.adminUser()) {
            List<GridAdmin.Draft> file = GridAdminTransfer.exportGrids(new List<String>{ 'Consignments' });
            List<GridAdminTransfer.Item> plan = GridAdminTransfer.planImport(file, false);
            System.assertEquals(2, plan.size());
            for (GridAdminTransfer.Item it : plan) {
                System.assertEquals('skip', it.action, it.name);
                System.assertEquals(null, it.draft, 'Nothing to save for ' + it.name);
                System.assertEquals(it.name, it.importName, 'It stays the grid this org has.');
                System.assertEquals(new List<String>(), it.errors, it.name);
            }
        }
    }

    @IsTest
    static void copiesGetFreeNamesAndShowEachOtherAsChildTables() {
        System.runAs(GridTestUsers.adminUser()) {
            List<GridAdmin.Draft> file = GridAdminTransfer.exportGrids(new List<String>{ 'Nest_Accounts' });
            List<GridAdminTransfer.Item> plan = GridAdminTransfer.planImport(file, true);
            Map<String, GridAdminTransfer.Item> items = byName(plan);
            Set<String> orgRecords = orgRecordNames();
            for (GridAdminTransfer.Item it : plan) {
                System.assertEquals('copy', it.action, it.name);
                System.assertEquals(new List<String>(), it.errors, it.name + ': ' + it.errors);
                System.assert(it.importLabel.startsWith('Copy of '), it.importLabel);
                System.assertEquals(
                    null,
                    Grid_Configuration__mdt.getInstance(it.importName),
                    'A free API name: ' + it.importName
                );
                System.assertEquals(true, it.draft.config.isNew);
                System.assertEquals(it.importName, it.draft.config.name);
                for (GridAdmin.ColumnDraft c : it.draft.columns) {
                    System.assert(c.name == null || !orgRecords.contains(c.name.toLowerCase()), c.name);
                }
                for (GridAdmin.RuleDraft r : it.draft.rules) {
                    System.assert(r.name == null || !orgRecords.contains(r.name.toLowerCase()), r.name);
                }
                for (GridAdmin.ChildDraft ch : it.draft.children) {
                    System.assert(!orgRecords.contains(ch.name.toLowerCase()), 'Never an existing record: ' + ch.name);
                }
            }
            GridAdminTransfer.Item accounts = items.get('Nest_Accounts');
            System.assertEquals('Copy of Nest Accounts', accounts.importLabel);
            System.assertEquals('Copy_of_Nest_Accounts', accounts.importName);
            Set<String> shown = new Set<String>();
            Set<String> links = new Set<String>();
            for (GridAdmin.ChildDraft ch : accounts.draft.children) {
                shown.add(ch.childConfig);
                links.add(ch.name);
                System.assert(ch.name.startsWith('Copy_of_Nest_Accounts_'), ch.name);
            }
            System.assertEquals(
                new Set<String>{ items.get('Consignments').importName, items.get('Nest_Contacts').importName },
                shown,
                'The copy shows the copies, not the originals.'
            );
            Integer totals = 0;
            for (GridAdmin.ColumnDraft c : accounts.draft.columns) {
                if (String.isNotBlank(c.childTable)) {
                    totals++;
                    System.assert(
                        links.contains(c.childTable),
                        'Its own child table: ' + c.childTable + ' in ' + links
                    );
                }
            }
            System.assertEquals(2, totals, 'Both child total columns follow.');
            List<String> order = new List<String>();
            for (GridAdminTransfer.Item it : plan) {
                order.add(it.name);
            }
            System.assert(order.indexOf('Consignment_Items') < order.indexOf('Consignments'), String.valueOf(order));
            System.assertEquals('Nest_Accounts', order[order.size() - 1], String.valueOf(order));

            // A grid with no child tables is ready to save as it is.
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(items.get('Consignment_Items').draft);
            for (Metadata.Metadata m : spy.container.getMetadata()) {
                String recordName = GridTestUsers.plain(m.fullName).substringAfter('.');
                System.assert(!orgRecords.contains(recordName.toLowerCase()), 'Only new records: ' + recordName);
            }
        }
    }

    @IsTest
    static void aNewGridKeepsTheFilesRecordNamesWhereFree() {
        System.runAs(GridTestUsers.adminUser()) {
            List<GridAdmin.Draft> file = GridAdminTransfer.exportGrids(new List<String>{ 'Consignments' });
            GridAdmin.Draft d = file[1]; // Consignments, as another org would have it
            System.assertEquals('Consignments', d.config.name);
            d.config.name = 'Harbor_Consignments';
            d.config.label = 'Harbor Consignments';
            String takenName = d.columns[1].name;
            d.columns[0].name = 'Harbor_Consignments_Bill';
            List<GridAdminTransfer.Item> plan = GridAdminTransfer.planImport(new List<GridAdmin.Draft>{ d }, false);
            System.assertEquals(1, plan.size());
            GridAdminTransfer.Item it = plan[0];
            System.assertEquals('new', it.action);
            System.assertEquals(new List<String>(), it.errors, String.valueOf(it.errors));
            System.assertEquals('Harbor_Consignments', it.importName);
            System.assertEquals('Harbor_Consignments_Bill', it.draft.columns[0].name, 'Free here: kept.');
            System.assertNotEquals(null, takenName);
            System.assertEquals(null, it.draft.columns[1].name, 'Taken here by another grid: the save names it.');
            System.assertEquals(1, it.draft.children.size());
            System.assertEquals(
                'Consignment_Items',
                it.draft.children[0].childConfig,
                'Not in the file, but in this org: it shows this org\'s grid.'
            );
            System.assert(it.draft.children[0].name.startsWith('Harbor_Consignments_'), it.draft.children[0].name);
        }
    }

    @IsTest
    static void whatCannotWorkHereKeepsAGridOutAndTheGridsThatShowIt() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft lacking = gridOn('Harbor_Freight', 'Consignment__c');
            GridAdmin.ColumnDraft hull = new GridAdmin.ColumnDraft();
            hull.field = 'Hull_Number__c';
            lacking.columns.add(hull);
            GridAdmin.Draft summed = gridOn('Harbor_Totals', 'Consignment__c');
            summed.columns[0].subtotal = 'sum'; // a sum of a name: skipped by the grid
            GridAdmin.Draft vessels = gridOn('Harbor_Vessels', 'Vessel__c');
            GridAdmin.Draft fleet = gridOn('Harbor_Fleet', 'Account');
            fleet.children.add(childTable('Harbor_Vessels', 'AccountId'));

            List<GridAdminTransfer.Item> plan = GridAdminTransfer.planImport(
                new List<GridAdmin.Draft>{ fleet, vessels, lacking, summed },
                false
            );
            Map<String, GridAdminTransfer.Item> items = byName(plan);
            System.assert(
                String.join(items.get('Harbor_Freight').errors, ' ').contains('Hull_Number__c'),
                'A field this org lacks: ' + items.get('Harbor_Freight').errors
            );
            System.assertEquals(null, items.get('Harbor_Freight').draft, 'Not to be saved.');
            System.assert(!items.get('Harbor_Vessels').errors.isEmpty(), 'An object this org lacks.');
            System.assert(
                String.join(items.get('Harbor_Fleet').errors, ' ').contains('cannot be imported'),
                'It shows a grid that cannot be imported: ' + items.get('Harbor_Fleet').errors
            );
            GridAdminTransfer.Item totals = items.get('Harbor_Totals');
            System.assertEquals(new List<String>(), totals.errors);
            System.assert(!totals.warnings.isEmpty(), 'What the grid would skip is a warning.');
            System.assertNotEquals(null, totals.draft, 'Ready to save.');
        }
    }

    @IsTest
    static void aFileThatCannotBeImportedSaysWhy() {
        System.runAs(GridTestUsers.adminUser()) {
            try {
                GridAdminTransfer.planImport(new List<GridAdmin.Draft>(), false);
                System.assert(false, 'No grids.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('no grids'), e.getMessage());
            }
            List<GridAdmin.Draft> many = new List<GridAdmin.Draft>();
            for (Integer i = 0; i <= GridAdminTransfer.MAX_GRIDS; i++) {
                many.add(gridOn('Harbor_' + i, 'Account'));
            }
            try {
                GridAdminTransfer.planImport(many, false);
                System.assert(false, 'Too many.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('at most ' + GridAdminTransfer.MAX_GRIDS), e.getMessage());
            }

            GridAdmin.Draft first = gridOn('Harbor_Accounts', 'Account');
            GridAdmin.Draft twin = gridOn('harbor_accounts', 'Account');
            GridAdmin.Draft orphan = gridOn('Harbor_Parents', 'Account');
            orphan.children.add(childTable('Harbor_Missing', 'ParentId'));
            GridAdmin.Draft north = gridOn('Harbor_North', 'Account');
            GridAdmin.Draft south = gridOn('Harbor_South', 'Account');
            north.children.add(childTable('Harbor_South', 'ParentId'));
            south.children.add(childTable('Harbor_North', 'ParentId'));
            GridAdmin.Draft nameless = gridOn('Harbor_Nameless', 'Account');
            nameless.config.name = null;
            List<GridAdminTransfer.Item> plan = GridAdminTransfer.planImport(
                new List<GridAdmin.Draft>{ first, twin, orphan, north, south, nameless },
                false
            );
            System.assertEquals(6, plan.size());
            String all = '';
            for (GridAdminTransfer.Item it : plan) {
                all += it.label + ': ' + String.join(it.errors, ' ') + ' | ';
            }
            System.assert(all.contains('more than one grid named harbor_accounts'), all);
            System.assert(all.contains('Harbor_Missing, which is not in the file or in this org'), all);
            System.assert(all.contains('in the file has no API name'), all);
            Map<String, GridAdminTransfer.Item> items = byName(plan);
            System.assertEquals(
                new List<String>(),
                items.get('Harbor_Accounts').errors,
                'The first of the two is fine.'
            );
            for (String loopName : new List<String>{ 'Harbor_North', 'Harbor_South' }) {
                System.assert(
                    String.join(items.get(loopName).errors, ' ').contains('lead back to it'),
                    loopName + ': ' + items.get(loopName).errors
                );
            }
        }
    }

    @IsTest
    static void aGridOfTheSameNameOnAnotherObjectIsNotShownByMistake() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft other = gridOn('Consignment_Items', 'Account'); // this org's shows Consignment Items
            GridAdmin.Draft parents = gridOn('Harbor_Parents', 'Account');
            parents.children.add(childTable('Consignment_Items', 'ParentId'));
            Map<String, GridAdminTransfer.Item> items = byName(
                GridAdminTransfer.planImport(new List<GridAdmin.Draft>{ other, parents }, false)
            );
            System.assertEquals('skip', items.get('Consignment_Items').action);
            System.assert(
                String.join(items.get('Harbor_Parents').errors, ' ').contains('Import the grids as copies instead'),
                String.valueOf(items.get('Harbor_Parents').errors)
            );
            // As copies, both are new, and one shows the other.
            items = byName(GridAdminTransfer.planImport(new List<GridAdmin.Draft>{ other, parents }, true));
            System.assertEquals('copy', items.get('Consignment_Items').action);
            System.assertEquals('new', items.get('Harbor_Parents').action);
            System.assertEquals(
                items.get('Consignment_Items').importName,
                items.get('Harbor_Parents').draft.children[0].childConfig
            );
        }
    }

    @IsTest
    static void thePageCallsThroughTheController() {
        System.runAs(GridTestUsers.adminUser()) {
            List<GridAdmin.Draft> file = GridAdminController.exportGrids(new List<String>{ 'Consignment_Items' });
            System.assertEquals(1, file.size());
            List<GridAdminTransfer.Item> plan = GridAdminController.planImport(JSON.serialize(file), true);
            System.assertEquals('copy', plan[0].action);
            for (String bad : new List<String>{ '', 'not a file', '{"config":1}' }) {
                try {
                    GridAdminController.planImport(bad, false);
                    System.assert(false, 'Refused: ' + bad);
                } catch (AuraHandledException e) {
                    System.assert(
                        e.getMessage().contains('no grids') || e.getMessage().contains('could not be read'),
                        bad + ' -> ' + e.getMessage()
                    );
                }
            }
        }
    }
}
