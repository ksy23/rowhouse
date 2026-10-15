/**
 * GridAdminTransfer — export grids to a file, and plan importing a file, for
 * the Grid Admin tab: a demo or trial org set up in a minute, a grid taken to
 * an org a change set cannot reach.
 *
 * EXPORT
 * exportGrids is given grids by API name. Each is read as the Grid Admin tab
 * reads it (a draft, turned-off records included), with every grid it shows
 * as a child table, and theirs, so a file is complete on its own. Child grids
 * come before the grids that show them: the order an import saves them in.
 * Reading needs Rowhouse Grid Admin, as opening a grid on the tab does.
 *
 * IMPORT NEVER CHANGES A GRID
 * planImport is given a file's drafts and says, for each, what importing it
 * would do in this org. It saves nothing.
 *   new   no grid here has its API name: it is imported under that name.
 *   skip  a grid here has its API name: that grid is left as it is, and any
 *         grid in the file that shows it as a child table shows this org's.
 *   copy  as skip, when the admin chooses copies: imported as a new grid,
 *         "Copy of" its title, under a free API name.
 * Nothing here can deploy a record of an existing grid.
 *
 * Each grid to import is made ready to save: a new grid, not archived,
 * renamed when it is a copy; its child tables showing the grids the import
 * makes or the ones this org has; its records keeping the file's API names
 * where this org has no record of that name, so a grid keeps its names from
 * org to org, and otherwise named by the save from the grid's name. Child
 * tables are named here instead, so a child total column can follow its own.
 * Then it is checked as the Grid Admin tab checks a draft (GridAdmin.check):
 * errors keep that grid out, and every grid that shows it as a child table;
 * warnings say what the grid would leave out here, such as a field or a flow
 * this org does not have. A child table that shows a grid the import has yet
 * to make is left out of that check: it is checked when its grid is saved.
 *
 * TRUST
 * A file is untrusted input. Nothing here saves: the page saves each ready
 * draft with GridAdminController.saveDraft, which checks it again in full and
 * needs Customize Application. A file can do nothing an admin could not do by
 * typing on the Grid Admin tab.
 */
public with sharing class GridAdminTransfer {
    /** Grids in one file, exported or imported. */
    public static final Integer MAX_GRIDS = 50;

    public static final String NEW_GRID = 'new';
    public static final String SKIP = 'skip';
    public static final String COPY = 'copy';

    /** One grid of a file, and what importing it would do. */
    public class Item {
        /** Its API name and title in the file. */
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String objectApiName;
        /** The object's plural label here, or the API name and "(not in this org)". */
        @AuraEnabled
        public String objectLabel;
        /** new, skip or copy. */
        @AuraEnabled
        public String action;
        /** The API name and title it is imported under: the file's, or a copy's. */
        @AuraEnabled
        public String importName;
        @AuraEnabled
        public String importLabel;
        /** skip and copy: the object of the grid this org has by that API name. */
        @AuraEnabled
        public String existingObjectLabel;
        /** What keeps it out of the import. */
        @AuraEnabled
        public List<String> errors = new List<String>();
        /** What the grid would leave out in this org. */
        @AuraEnabled
        public List<String> warnings = new List<String>();
        /** Ready to save, for new and copy without errors; otherwise null. */
        @AuraEnabled
        public GridAdmin.Draft draft;
        /** skip and copy: this org's grid shows the same object. Not sent to the page. */
        public Boolean sameObject = true;
    }

    // ---------------------------------------------------------------- export

    /**
     * The grids named, each as a draft, with the grids they show as child
     * tables; child grids first, every grid once.
     */
    public static List<GridAdmin.Draft> exportGrids(List<String> configNames) {
        GridAdmin.requireAdmin();
        if (configNames == null || configNames.isEmpty()) {
            throw new GridException('Choose the grids to export.');
        }
        List<GridAdmin.Draft> out = new List<GridAdmin.Draft>();
        Set<String> done = new Set<String>();
        Set<String> under = new Set<String>();
        for (String name : configNames) {
            addWithChildren(name, out, done, under);
        }
        return out;
    }

    private static void addWithChildren(String name, List<GridAdmin.Draft> out, Set<String> done, Set<String> under) {
        if (String.isBlank(name)) {
            return;
        }
        String key = name.trim().toLowerCase();
        if (done.contains(key) || under.contains(key)) {
            return; // each grid once, also when child tables show each other
        }
        under.add(key);
        GridAdmin.Draft d = GridAdmin.draftNamed(name.trim());
        for (GridAdmin.ChildDraft ch : d.children) {
            addWithChildren(ch.childConfig, out, done, under);
        }
        under.remove(key);
        done.add(key);
        if (out.size() >= MAX_GRIDS) {
            throw new GridException(
                'That is more than ' +
                    MAX_GRIDS +
                    ' grids, with the grids they show as child tables. Export fewer at a time.'
            );
        }
        out.add(d);
    }

    // ---------------------------------------------------------------- import

    /**
     * What importing these drafts would do in this org, in the order to save
     * them (child grids first). `asCopies`: a grid this org already has is
     * imported as a copy rather than left out.
     */
    public static List<Item> planImport(List<GridAdmin.Draft> drafts, Boolean asCopies) {
        GridAdmin.requireAdmin();
        if (drafts == null || drafts.isEmpty()) {
            throw new GridException('The file has no grids.');
        }
        if (drafts.size() > MAX_GRIDS) {
            throw new GridException(
                'The file has ' + drafts.size() + ' grids. Import at most ' + MAX_GRIDS + ' at a time.'
            );
        }
        Map<String, Grid_Configuration__mdt> org = new Map<String, Grid_Configuration__mdt>();
        for (Grid_Configuration__mdt cfg : Grid_Configuration__mdt.getAll().values()) {
            org.put(cfg.DeveloperName.toLowerCase(), cfg);
        }

        List<Item> items = new List<Item>();
        Map<String, Item> byName = new Map<String, Item>();
        for (Integer i = 0; i < drafts.size(); i++) {
            items.add(itemFor(drafts[i], i, org, byName, asCopies == true));
        }

        // A copy's API name: free here, and not one the file's new grids take.
        Set<String> gridNames = new Set<String>(org.keySet());
        for (Item it : items) {
            if (it.action == NEW_GRID && it.importName != null) {
                gridNames.add(it.importName.toLowerCase());
            }
        }
        for (Item it : items) {
            if (it.action == COPY) {
                it.importLabel = ('Copy of ' + it.label).left(GridAdmin.MAX_NAME).trim();
                it.importName = freeName(it.importLabel, gridNames);
                gridNames.add(it.importName.toLowerCase());
            }
        }

        List<Item> ordered = inBuildOrder(items, byName);

        Taken taken = new Taken();
        for (Item it : ordered) {
            if (it.action == SKIP || !it.errors.isEmpty() || it.draft == null) {
                continue;
            }
            prepare(it, byName, org, taken);
        }
        keepOutWhatNeedsAGridLeftOut(ordered);
        for (Item it : ordered) {
            if (it.action == SKIP || !it.errors.isEmpty()) {
                it.draft = null;
            }
        }
        return ordered;
    }

    /** One draft as an item: what it is called, and new, skip or copy. */
    private static Item itemFor(
        GridAdmin.Draft d,
        Integer index,
        Map<String, Grid_Configuration__mdt> org,
        Map<String, Item> byName,
        Boolean asCopies
    ) {
        Item it = new Item();
        it.action = NEW_GRID;
        if (d == null || d.config == null || String.isBlank(d.config.name)) {
            it.label = 'Grid ' + (index + 1);
            it.errors.add('Grid ' + (index + 1) + ' in the file has no API name.');
            return it;
        }
        it.name = d.config.name.trim();
        it.label = String.isBlank(d.config.label) ? it.name : d.config.label.trim();
        it.objectApiName = d.config.objectApiName;
        it.objectLabel = objectLabel(d.config.objectApiName);
        String key = it.name.toLowerCase();
        if (byName.containsKey(key)) {
            it.errors.add('The file has more than one grid named ' + it.name + '.');
            return it;
        }
        byName.put(key, it);
        it.draft = withLists(d);
        Grid_Configuration__mdt existing = org.get(key);
        if (existing == null) {
            it.importName = it.name;
            it.importLabel = it.label;
        } else {
            it.action = asCopies ? COPY : SKIP;
            it.existingObjectLabel = objectLabel(existing.Object_API_Name__c);
            it.sameObject =
                String.isNotBlank(d.config.objectApiName) &&
                existing.Object_API_Name__c != null &&
                existing.Object_API_Name__c.equalsIgnoreCase(d.config.objectApiName.trim());
            if (it.action == SKIP) {
                it.importName = existing.DeveloperName;
                it.importLabel = existing.MasterLabel;
            }
        }
        return it;
    }

    /** A hand-made file may leave a list out; the checks expect every one. */
    private static GridAdmin.Draft withLists(GridAdmin.Draft d) {
        if (d.columns == null) {
            d.columns = new List<GridAdmin.ColumnDraft>();
        }
        if (d.rules == null) {
            d.rules = new List<GridAdmin.RuleDraft>();
        }
        if (d.filters == null) {
            d.filters = new List<GridAdmin.FilterDraft>();
        }
        if (d.actions == null) {
            d.actions = new List<GridAdmin.ActionDraft>();
        }
        if (d.children == null) {
            d.children = new List<GridAdmin.ChildDraft>();
        }
        return d;
    }

    /**
     * Child grids before the grids that show them, otherwise in the file's
     * order. Grids whose child tables lead back to themselves can never come
     * first: they are kept out, and said so.
     */
    private static List<Item> inBuildOrder(List<Item> items, Map<String, Item> byName) {
        Map<String, Integer> indexOf = new Map<String, Integer>();
        for (Integer i = 0; i < items.size(); i++) {
            if (items[i].name != null && byName.get(items[i].name.toLowerCase()) === items[i]) {
                indexOf.put(items[i].name.toLowerCase(), i);
            }
        }
        List<Item> out = new List<Item>();
        Set<Integer> placed = new Set<Integer>();
        Boolean progress = true;
        while (progress) {
            progress = false;
            for (Integer i = 0; i < items.size(); i++) {
                Item it = items[i];
                if (placed.contains(i)) {
                    continue;
                }
                Boolean ready = true;
                if (it.action != SKIP && it.errors.isEmpty() && it.draft != null) {
                    for (GridAdmin.ChildDraft ch : it.draft.children) {
                        Integer child = String.isBlank(ch.childConfig)
                            ? null
                            : indexOf.get(ch.childConfig.trim().toLowerCase());
                        if (child != null && child != i && !placed.contains(child)) {
                            ready = false;
                            break;
                        }
                    }
                }
                if (ready) {
                    out.add(it);
                    placed.add(i);
                    progress = true;
                }
            }
        }
        for (Integer i = 0; i < items.size(); i++) {
            Item it = items[i];
            if (!placed.contains(i)) {
                it.errors.add(
                    'Its child tables lead back to it through other grids in the file, so neither can be saved first.'
                );
                out.add(it);
            }
        }
        return out;
    }

    /** Record API names that are taken: this org's, and those the import has given out so far. */
    private class Taken {
        public Set<String> columns = lower(Grid_Column__mdt.getAll().keySet());
        public Set<String> rules = lower(Grid_Display_Rule__mdt.getAll().keySet());
        public Set<String> filters = lower(Grid_Filter__mdt.getAll().keySet());
        public Set<String> actions = lower(Grid_Action__mdt.getAll().keySet());
        public Set<String> children = lower(Grid_Child_Table__mdt.getAll().keySet());
    }

    /** Make one grid's draft ready to save as a new grid, then check it. */
    private static void prepare(
        Item it,
        Map<String, Item> byName,
        Map<String, Grid_Configuration__mdt> org,
        Taken taken
    ) {
        GridAdmin.Draft d = it.draft;
        d.config.isNew = true;
        d.config.archived = false;
        d.config.name = it.importName;
        d.config.label = it.importLabel;

        // Child tables: the grid the import makes, or the one this org has.
        Set<String> pending = new Set<String>();
        for (GridAdmin.ChildDraft ch : d.children) {
            if (String.isBlank(ch.childConfig)) {
                continue; // the check says so
            }
            String key = ch.childConfig.trim().toLowerCase();
            String tab = '"' + (String.isBlank(ch.tabLabel) ? ch.childConfig.trim() : ch.tabLabel.trim()) + '"';
            Item target = byName.get(key);
            if (target != null && target.action != SKIP) {
                ch.childConfig = target.importName;
                pending.add(target.importName.toLowerCase());
            } else if (target != null && !target.sameObject) {
                it.errors.add(
                    'Child table ' +
                        tab +
                        ' shows ' +
                        target.name +
                        ', and the grid of that API name here shows ' +
                        target.existingObjectLabel +
                        '. Import the grids as copies instead.'
                );
            } else if (org.containsKey(key)) {
                ch.childConfig = org.get(key).DeveloperName;
            } else {
                it.errors.add(
                    'Child table ' +
                        tab +
                        ' shows ' +
                        ch.childConfig.trim() +
                        ', which is not in the file or in this org.'
                );
            }
        }

        // Record names: the file's where free, otherwise the save names them.
        for (GridAdmin.ColumnDraft x : d.columns) {
            x.name = kept(x.name, taken.columns);
        }
        for (GridAdmin.RuleDraft x : d.rules) {
            x.name = kept(x.name, taken.rules);
        }
        for (GridAdmin.FilterDraft x : d.filters) {
            x.name = kept(x.name, taken.filters);
        }
        for (GridAdmin.ActionDraft x : d.actions) {
            x.name = kept(x.name, taken.actions);
        }
        nameChildTables(d, taken.children);

        if (!it.errors.isEmpty()) {
            return;
        }
        GridAdmin.Check result = GridAdmin.check(forCheck(d, pending));
        it.errors.addAll(result.errors);
        it.warnings.addAll(result.warnings);
    }

    /** The name, trimmed, if it is a good one and free; then it is taken. Otherwise null. */
    private static String kept(String name, Set<String> taken) {
        if (String.isBlank(name) || GridAdmin.nameProblem(name) != null) {
            return null;
        }
        String n = name.trim();
        if (taken.contains(n.toLowerCase())) {
            return null;
        }
        taken.add(n.toLowerCase());
        return n;
    }

    /**
     * Child tables keep the file's names where free and are named after the
     * grid otherwise, here rather than by the save, so a child total column
     * can be pointed at its own child table's new name.
     */
    private static void nameChildTables(GridAdmin.Draft d, Set<String> taken) {
        if (d.children.isEmpty() || GridAdmin.nameProblem(d.config.name) != null) {
            return;
        }
        List<String> fileNames = new List<String>();
        List<String> wanted = new List<String>();
        List<String> hints = new List<String>();
        for (GridAdmin.ChildDraft ch : d.children) {
            fileNames.add(String.isBlank(ch.name) ? null : ch.name.trim());
            wanted.add(kept(ch.name, taken));
            hints.add(String.isNotBlank(ch.tabLabel) ? ch.tabLabel : ch.childConfig);
        }
        List<String> given = GridAdmin.names(d.config.name.trim(), wanted, hints, taken);
        Map<String, String> renamed = new Map<String, String>();
        for (Integer i = 0; i < d.children.size(); i++) {
            d.children[i].name = given[i];
            taken.add(given[i].toLowerCase());
            if (fileNames[i] != null && fileNames[i] != given[i]) {
                renamed.put(fileNames[i].toLowerCase(), given[i]);
            }
        }
        for (GridAdmin.ColumnDraft col : d.columns) {
            if (String.isNotBlank(col.childTable) && renamed.containsKey(col.childTable.trim().toLowerCase())) {
                col.childTable = renamed.get(col.childTable.trim().toLowerCase());
            }
        }
    }

    /**
     * A copy of the draft for the check, without the child tables that show
     * a grid the import has yet to make, nor the child total columns on them:
     * the check needs a child table's grid to exist.
     */
    private static GridAdmin.Draft forCheck(GridAdmin.Draft d, Set<String> pending) {
        GridAdmin.Draft out = (GridAdmin.Draft) JSON.deserialize(JSON.serialize(d), GridAdmin.Draft.class);
        if (pending.isEmpty()) {
            return out;
        }
        Set<String> leftOut = new Set<String>();
        List<GridAdmin.ChildDraft> children = new List<GridAdmin.ChildDraft>();
        for (GridAdmin.ChildDraft ch : out.children) {
            if (String.isNotBlank(ch.childConfig) && pending.contains(ch.childConfig.trim().toLowerCase())) {
                if (ch.name != null) {
                    leftOut.add(ch.name.toLowerCase());
                }
            } else {
                children.add(ch);
            }
        }
        out.children = children;
        List<GridAdmin.ColumnDraft> columns = new List<GridAdmin.ColumnDraft>();
        for (GridAdmin.ColumnDraft col : out.columns) {
            if (String.isBlank(col.childTable) || !leftOut.contains(col.childTable.trim().toLowerCase())) {
                columns.add(col);
            }
        }
        out.columns = columns;
        return out;
    }

    /** A grid that shows, as a child table, a grid kept out of the import is kept out too. */
    private static void keepOutWhatNeedsAGridLeftOut(List<Item> ordered) {
        Map<String, Item> byImportName = new Map<String, Item>();
        for (Item it : ordered) {
            if (it.action != SKIP && it.importName != null) {
                byImportName.put(it.importName.toLowerCase(), it);
            }
        }
        Boolean changed = true;
        while (changed) {
            changed = false;
            for (Item it : ordered) {
                if (it.action == SKIP || !it.errors.isEmpty() || it.draft == null) {
                    continue;
                }
                for (GridAdmin.ChildDraft ch : it.draft.children) {
                    Item child = String.isBlank(ch.childConfig)
                        ? null
                        : byImportName.get(ch.childConfig.trim().toLowerCase());
                    if (child != null && child !== it && !child.errors.isEmpty()) {
                        it.errors.add(
                            'It shows ' + child.label + ' as a child table, and ' + child.label + ' cannot be imported.'
                        );
                        changed = true;
                        break;
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    /** An API name made from the title, numbered when it is taken. */
    private static String freeName(String title, Set<String> taken) {
        String base = GridAdmin.clean(title).left(GridAdmin.MAX_NAME).removeEnd('_');
        if (!taken.contains(base.toLowerCase())) {
            return base;
        }
        for (Integer n = 2; n < 10000; n++) {
            String suffix = '_' + n;
            String candidate = base.left(GridAdmin.MAX_NAME - suffix.length()).removeEnd('_') + suffix;
            if (!taken.contains(candidate.toLowerCase())) {
                return candidate;
            }
        }
        throw new GridException('No free API name for ' + title + '.');
    }

    /** The object's plural label, or its API name and "(not in this org)". */
    private static String objectLabel(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            return '';
        }
        try {
            return GridDescribe.typeFor(objectApiName.trim())
                .getDescribe(SObjectDescribeOptions.DEFERRED)
                .getLabelPlural();
        } catch (Exception e) {
            return objectApiName.trim() + ' (not in this org)';
        }
    }

    private static Set<String> lower(Set<String> names) {
        Set<String> out = new Set<String>();
        for (String n : names) {
            out.add(n.toLowerCase());
        }
        return out;
    }
}
