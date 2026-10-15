/**
 * GridActions — the actions a grid offers on a row or on the selection.
 *
 * A Grid Action record names a screen flow, an autolaunched flow or a quick
 * action, and where the grid offers it: each row's menu, the selection bar,
 * or both. Each is checked here against what can be checked without running
 * it: a known type, a well-formed name and input, and for an object's quick
 * action, the grid's own object. One an admin got wrong is left out with a
 * warning, as for format rules and child tables. Whether the flow or quick
 * action exists is not asked here: a describe for every action on every page
 * load is not free, and running one that is not there says so.
 *
 * Invocable Apex is not a type of its own. From the installed package Apex
 * cannot reach the org's own Apex classes or quick actions at all (measured):
 * an admin runs Apex from an autolaunched flow. A quick action opens in
 * Salesforce's own window, in the browser, one row at a time; so it is
 * offered in each row's menu only.
 *
 * An autolaunched flow must name a Required Permission. Started from Apex, it
 * runs with the access the flow gives it: the platform does not check the
 * user's access to it, and a flow in its default mode ran in system context,
 * writing a field the user could not edit (measured). So one without a
 * permission is skipped, and only users who hold the permission the admin
 * chose see it or can run it. A screen flow runs in the browser under the
 * user's own access, and a quick action in Salesforce's own window; for those
 * the permission is optional.
 *
 * GridActionService runs autolaunched flows; screen flows and quick actions
 * run in the browser.
 */
public with sharing class GridActions {
    /** The Action Type picklist's values, lower-cased, as the grid names them. */
    public static final Set<String> TYPES = new Set<String>{ 'screenflow', 'flow', 'quickaction' };

    /** Why an autolaunched flow without a Required Permission is not offered. */
    public static final String PERMISSION_NEEDED =
        'an autolaunched flow needs a Required Permission: it runs with the access the flow gives it, ' +
        'which can be more than the user\'s own.';

    /** Why an Apex action is not offered. */
    public static final String NO_APEX = 'Rowhouse does not run Apex on its own: call the Apex from an autolaunched flow and choose the flow here.';

    /** Why a quick action is not offered on the selection. */
    public static final String QUICK_ACTION_ON_ROW = 'a quick action opens in Salesforce\'s own window, for one row at a time: set Show In to Row.';

    /** A flow's or class's API name, with an optional namespace: Name, ns__Name. */
    private static final Pattern API_NAME = Pattern.compile('^[A-Za-z][A-Za-z0-9_]{0,254}$');
    /** A quick action: Object.ActionName for an object's own, ActionName for a global one. */
    private static final Pattern QUICK_ACTION = Pattern.compile(
        '^(?:([A-Za-z][A-Za-z0-9_]*)\\.)?([A-Za-z][A-Za-z0-9_]*)$'
    );

    /** Every Grid Action record of a configuration, turned off or not, in no particular order. */
    public static List<Grid_Action__mdt> recordsOf(Grid_Configuration__mdt cfg) {
        List<Grid_Action__mdt> out = new List<Grid_Action__mdt>();
        for (Grid_Action__mdt a : Grid_Action__mdt.getAll().values()) {
            if (GridConfig.belongsTo(a.Grid_Configuration__c, cfg)) {
                out.add(a);
            }
        }
        return out;
    }

    /**
     * The actions from these records (the org's, or a draft on the Grid
     * Admin tab), in Sort Order, leaving out any marked Inactive; one
     * that cannot work is skipped with a warning.
     */
    public static List<GridConfig.Action> actionsFrom(
        List<Grid_Action__mdt> all,
        Schema.SObjectType objectType,
        List<String> warnings
    ) {
        List<Grid_Action__mdt> records = new List<Grid_Action__mdt>();
        for (Grid_Action__mdt a : all) {
            if (a.Inactive__c != true) {
                records.add(a);
            }
        }
        records.sort(new InOrder());
        List<GridConfig.Action> out = new List<GridConfig.Action>();
        for (Grid_Action__mdt a : records) {
            try {
                out.add(action(a, objectType));
            } catch (GridException e) {
                warnings.add('Grid Action ' + a.DeveloperName + ' was skipped: ' + e.getMessage());
            }
        }
        return out;
    }

    /** May this user run the action? Only its custom permission, if it names one, decides here (GridSecurity). */
    public static Boolean canRun(GridConfig.Action a) {
        return GridSecurity.hasCustomPermission(a.requiredPermission);
    }

    /** The configuration's action of this name. Throws if the grid has none: the browser never asks for one. */
    public static GridConfig.Action find(GridConfig.Definition def, String name) {
        if (String.isNotBlank(name)) {
            for (GridConfig.Action a : def.actions) {
                if (a.name == name.trim()) {
                    return a;
                }
            }
        }
        throw new GridException('The grid ' + def.name + ' has no action named "' + name + '".');
    }

    // ---------------------------------------------------------------- helpers

    @TestVisible
    private static GridConfig.Action action(Grid_Action__mdt r, Schema.SObjectType objectType) {
        GridConfig.Action a = new GridConfig.Action();
        a.name = r.DeveloperName;
        a.label = String.isNotBlank(r.MasterLabel) ? r.MasterLabel.trim() : r.DeveloperName;
        if (String.isBlank(r.Action_Type__c)) {
            throw new GridException('it has no Action Type.');
        }
        a.type = r.Action_Type__c.trim().toLowerCase();
        if (a.type == 'apex') {
            throw new GridException(NO_APEX);
        }
        if (!TYPES.contains(a.type)) {
            throw new GridException('unknown Action Type "' + r.Action_Type__c + '".');
        }
        a.actionName = String.isBlank(r.Action_Name__c) ? null : r.Action_Name__c.trim();
        if (a.actionName == null) {
            throw new GridException('it has no Action Name.');
        }
        if (a.type == 'quickaction') {
            requireQuickAction(a.actionName, objectType);
        } else if (!API_NAME.matcher(a.actionName).matches()) {
            throw new GridException('"' + a.actionName + '" is not an API name.');
        }
        String input = String.isBlank(r.Input_Name__c) ? null : r.Input_Name__c.trim();
        if (input != null && !API_NAME.matcher(input).matches()) {
            throw new GridException('Input Name "' + input + '" is not an API name.');
        }
        String showIn = String.isBlank(r.Show_In__c) ? 'both' : r.Show_In__c.trim().toLowerCase();
        if (showIn != 'both' && showIn != 'row' && showIn != 'selection') {
            throw new GridException('unknown Show In "' + r.Show_In__c + '".');
        }
        if (a.type == 'quickaction' && showIn == 'selection') {
            throw new GridException(QUICK_ACTION_ON_ROW);
        }
        a.onRow = showIn != 'selection';
        a.onSelection = showIn != 'row' && a.type != 'quickaction'; // a quick action: the row's menu only
        a.confirmation = String.isBlank(r.Confirmation__c) ? null : r.Confirmation__c.trim();
        String permission = String.isBlank(r.Required_Permission__c) ? null : r.Required_Permission__c.trim();
        if (permission != null && !API_NAME.matcher(permission).matches()) {
            throw new GridException('Required Permission "' + permission + '" is not an API name.');
        }
        a.requiredPermission = permission;
        if (permission == null && a.type == 'flow') {
            throw new GridException(PERMISSION_NEEDED);
        }
        if (a.type == 'screenflow') {
            // The browser runs a screen flow (lightning-flow), so it needs both.
            a.flowName = a.actionName;
            a.inputName = input == null ? 'recordId' : input;
        } else if (a.type == 'quickaction') {
            // The browser opens Salesforce's window for it: Global.Name for a global action.
            a.quickActionName = a.actionName.contains('.') ? a.actionName : 'Global.' + a.actionName;
        } else {
            a.serverInput = input;
        }
        return a;
    }

    /** An object's quick action must be one of the grid's own object; a global one fits any. */
    private static void requireQuickAction(String name, Schema.SObjectType objectType) {
        Matcher m = QUICK_ACTION.matcher(name);
        if (!m.matches()) {
            throw new GridException(
                '"' + name + '" is not a quick action name. Write Object.ActionName, or a global action\'s name.'
            );
        }
        String objectName = m.group(1);
        if (
            objectName != null &&
            !objectName.equalsIgnoreCase(GridDescribe.apiName(objectType)) &&
            !objectName.equalsIgnoreCase(GridDescribe.localName(objectType))
        ) {
            throw new GridException(
                '"' +
                    name +
                    '" is a quick action of ' +
                    objectName +
                    ', not of ' +
                    GridDescribe.localName(objectType) +
                    ', the object this grid shows.'
            );
        }
    }

    private class InOrder implements Comparator<Grid_Action__mdt> {
        public Integer compare(Grid_Action__mdt a, Grid_Action__mdt b) {
            Decimal x = a.Sort_Order__c == null ? 9999 : a.Sort_Order__c;
            Decimal y = b.Sort_Order__c == null ? 9999 : b.Sort_Order__c;
            if (x != y) {
                return x < y ? -1 : 1;
            }
            return a.DeveloperName.compareTo(b.DeveloperName);
        }
    }
}
