/**
 * GridActionService — runs a grid action on the server: an
 * autolaunched flow, an invocable Apex action or a quick action, on one row or
 * on up to MAX_IDS selected rows per call. A screen flow is not run here: the
 * platform runs screen flows only in the browser, in lightning-flow.
 *
 * Nothing about the request is trusted (HR-6). Before anything runs:
 *   the action must be one of the grid's own Grid Actions, found by name in
 *   the configuration read here, never taken from the browser;
 *   it must be a kind that runs on the server, and offered for a selection if
 *   the request holds more than one record;
 *   the user must be able to read the object, and hold the action's custom
 *   permission (GridSecurity), which an autolaunched flow or Apex action
 *   always names (GridActions);
 *   the request holds at most MAX_IDS Ids, every one a record of the grid's
 *   object. One that is not refuses the whole request, as for a delete.
 * Records the user cannot see (sharing), or that were deleted, are not run and
 * come back as row errors.
 *
 * HOW IT RUNS (measured in a Developer Edition org)
 * One Invocable.Action call, one invocation per record, so a flow or an Apex
 * action gets the batch in bulk. The record Id goes in as text: a flow's Text
 * input and a quick action's contextId refuse an Id-typed value, and an Apex
 * action's Id input takes text.
 *   A flow or a quick action that fails for one record fails for that record
 *   alone. A flow's error is the platform's own ("An error occurred when
 *   executing a flow interview."); its fault path cannot say more here.
 *   An Apex action that throws fails the whole call, every record with the
 *   same message, and the platform undoes the work the call had done. So a
 *   failed Apex call on several records is run again one record at a time:
 *   the records that were not the problem then succeed, and none is run
 *   twice. Retries stop while the transaction still has at least half of its
 *   CPU time, DML statements and queries left; records not retried keep the
 *   first error.
 *
 * ACCESS
 * The action runs with the access its own settings give it. From Apex the
 * platform does not check the user's access to the flow or the Apex class,
 * and a flow in its default run mode ran in system context: it wrote a field
 * the user could not edit (measured). So an autolaunched flow or Apex action
 * must name a Required Permission (GridActions skips one that does not), and
 * runs only for users who hold it; a quick action may. Rowhouse checks the
 * object, the records and that permission.
 *
 * AUDIT TRAIL
 * In a grid that logs its changes the user must be able to write the log
 * before the action runs, and each record it ran on is logged, naming the
 * action, in this same transaction. What the action itself changed is not:
 * the grid cannot see inside a flow or Apex. A screen flow runs in the
 * browser, so it is not logged at all.
 */
public with sharing class GridActionService {
    /** Records per call. Small, so a heavy flow or a retried Apex action stays within one transaction's limits. */
    public static final Integer MAX_IDS = 50;

    /** The Invocable.Action type for each server kind. */
    private static final Map<String, String> INVOCABLE_TYPE = new Map<String, String>{
        'flow' => 'flow',
        'apex' => 'apex',
        'quickaction' => 'quickAction'
    };
    /** The input that takes the record Id when the Grid Action names none; Apex's is found by describe. */
    private static final Map<String, String> DEFAULT_INPUT = new Map<String, String>{
        'flow' => 'recordId',
        'quickaction' => 'contextId'
    };

    /** What happened to one batch. */
    public class Result {
        @AuraEnabled
        public List<Id> succeededIds = new List<Id>();
        /** Row errors: recordId and message, never a field. */
        @AuraEnabled
        public List<GridSaveError> errors = new List<GridSaveError>();
    }

    public static Result run(String configName, String actionName, List<Id> recordIds) {
        Result result = new Result();
        if (recordIds == null || recordIds.isEmpty()) {
            return result; // nothing asked, nothing run
        }
        GridConfig.Definition def = GridConfig.load(configName);
        GridConfig.Action action = GridActions.find(def, actionName);
        if (!INVOCABLE_TYPE.containsKey(action.type)) {
            throw new GridException(action.label + ' is a screen flow: it runs in the browser, not on the server.');
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridSecurity.requireRead(objectType);
        if (!GridActions.canRun(action)) {
            throw new GridException('You do not have permission to run ' + action.label + '.');
        }
        if (recordIds.size() > MAX_IDS) {
            throw new GridException(
                'Run an action on at most ' + MAX_IDS + ' records at a time; this request has ' + recordIds.size() + '.'
            );
        }
        List<Id> ids = new List<Id>();
        Set<Id> seen = new Set<Id>();
        for (Id recordId : recordIds) {
            if (recordId == null || recordId.getSObjectType() != objectType) {
                throw new GridException(
                    'Record ' + recordId + ' is not a ' + GridDescribe.localName(objectType) + '. Nothing was run.'
                );
            }
            if (seen.add(recordId)) {
                ids.add(recordId);
            }
        }
        if (ids.size() > 1 && action.onSelection != true) {
            throw new GridException(action.label + ' runs on one row at a time. Nothing was run.');
        }
        Set<Id> visible = GridSecurity.visibleIds(objectType, ids);
        List<Id> runnable = new List<Id>();
        for (Id recordId : ids) {
            if (visible.contains(recordId)) {
                runnable.add(recordId);
            } else {
                result.errors.add(
                    new GridSaveError(recordId, null, 'You do not have access to this record, or it was deleted.')
                );
            }
        }
        if (runnable.isEmpty()) {
            return result;
        }
        GridAudit.Context audit = GridAudit.start(def); // null unless the grid logs; throws if the user cannot
        Map<Id, String> names = audit == null ? null : GridAudit.namesOf(objectType, runnable);
        String input = inputFor(action);
        List<Invocable.Action.Result> outcomes = invoke(action, input, runnable);
        Map<Id, String> failures = failuresOf(runnable, outcomes);
        if (action.type == 'apex' && runnable.size() > 1 && failures.size() == runnable.size()) {
            failures = retryOneByOne(action, input, runnable, failures);
        }
        for (Id recordId : runnable) {
            if (failures.containsKey(recordId)) {
                result.errors.add(new GridSaveError(recordId, null, failures.get(recordId)));
            } else {
                result.succeededIds.add(recordId);
            }
        }
        GridAudit.write(GridAudit.actions(audit, action, result.succeededIds, names)); // throws, and undoes the run, if it cannot
        return result;
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Where to look for an action's name, in turn. From the installed package
     * a name without a namespace is looked for in Rowhouse's own: the org's own
     * flows, its Apex and even Salesforce's global Log a Call came back "Action
     * name not found: rowhouse__…" (measured, 0.1 Beta 11). So a plain name is
     * tried as written, then with an empty namespace given both ways, then in
     * this package's namespace (where the package build's own test flows
     * live). A name with a namespace of its own is tried as written. A call
     * that found no action ran nothing, so nothing runs twice.
     */
    @TestVisible
    private static List<Place> placesFor(String actionName) {
        List<Place> out = new List<Place>{ new Place(false, null) };
        if (!actionName.contains('__')) {
            out.add(new Place(true, ''));
            out.add(new Place(true, null));
            if (String.isNotBlank(GridDescribe.NAMESPACE)) {
                out.add(new Place(true, GridDescribe.NAMESPACE));
            }
        }
        return out;
    }

    /** One way to name an action: as written, or in a namespace (blank or null for none). */
    @TestVisible
    private class Place {
        public Boolean withNamespace;
        public String namespace;
        Place(Boolean withNamespace, String namespace) {
            this.withNamespace = withNamespace;
            this.namespace = namespace;
        }
    }

    /** The action named this way, or null when Salesforce refuses to make one. */
    private static Invocable.Action actionAt(Place w, String type, String name) {
        try {
            return w.withNamespace
                ? Invocable.Action.createCustomAction(type, w.namespace, name)
                : Invocable.Action.createCustomAction(type, name);
        } catch (Exception e) {
            return null; // nothing was made, so nothing ran
        }
    }

    /**
     * The input that takes the record Id: the Grid Action's Input Name, else
     * recordId for a flow and contextId for a quick action; for Apex, the
     * action's one input, found by describe wherever the name is found
     * (placesFor). Throws in an admin's terms when an Apex action has none, or
     * several and no Input Name says which.
     */
    @TestVisible
    private static String inputFor(GridConfig.Action action) {
        if (String.isNotBlank(action.serverInput)) {
            return action.serverInput;
        }
        if (DEFAULT_INPUT.containsKey(action.type)) {
            return DEFAULT_INPUT.get(action.type);
        }
        List<Invocable.Action.DescribeResult> described = new List<Invocable.Action.DescribeResult>();
        for (Place w : placesFor(action.actionName)) {
            Invocable.Action found = actionAt(w, 'apex', action.actionName);
            try {
                described = found == null ? described : found.getDescribe();
            } catch (Exception e) {
                described = new List<Invocable.Action.DescribeResult>(); // not here; look in the next place
            }
            if (!described.isEmpty()) {
                break;
            }
        }
        if (described.isEmpty()) {
            throw new GridException(
                'There is no invocable Apex action named "' + action.actionName + '" (Grid Action ' + action.name + ').'
            );
        }
        List<Invocable.Action.InputParameter> inputs = described[0].getInputs();
        if (inputs.size() != 1) {
            throw new GridException(
                'The Apex action ' +
                    action.actionName +
                    ' has ' +
                    inputs.size() +
                    ' inputs; set Input Name on Grid Action ' +
                    action.name +
                    ' to the one that takes the record Id.'
            );
        }
        return inputs[0].getName();
    }

    /**
     * One call, one invocation per record, the Id as text, in the first place
     * (placesFor) where Salesforce finds the action. When none finds it, the
     * last place's "Action name not found" is what the rows say.
     */
    private static List<Invocable.Action.Result> invoke(GridConfig.Action action, String input, List<Id> ids) {
        List<Invocable.Action.Result> results;
        for (Place w : placesFor(action.actionName)) {
            Invocable.Action call = actionAt(w, INVOCABLE_TYPE.get(action.type), action.actionName);
            if (call == null) {
                continue;
            }
            for (Integer i = 0; i < ids.size(); i++) {
                if (i > 0) {
                    call.addInvocation();
                }
                call.setInvocationParameter(input, String.valueOf(ids[i]));
            }
            results = call.invoke();
            if (!notFound(results)) {
                return results;
            }
        }
        return results == null ? new List<Invocable.Action.Result>() : results;
    }

    /** Did every invocation fail because no action by that name was found? */
    private static Boolean notFound(List<Invocable.Action.Result> results) {
        if (results == null || results.isEmpty()) {
            return false;
        }
        for (Invocable.Action.Result r : results) {
            Boolean missing = false;
            for (Invocable.Action.Error e : r.isSuccess() ? new List<Invocable.Action.Error>() : r.getErrors()) {
                missing = missing || (e.getMessage() != null && e.getMessage().startsWith('Action name not found'));
            }
            if (!missing) {
                return false;
            }
        }
        return true;
    }

    /** { recordId: message } for every record whose invocation failed. Results come back in the order sent. */
    private static Map<Id, String> failuresOf(List<Id> ids, List<Invocable.Action.Result> outcomes) {
        Map<Id, String> out = new Map<Id, String>();
        for (Integer i = 0; i < ids.size(); i++) {
            Invocable.Action.Result outcome = i < outcomes.size() ? outcomes[i] : null;
            if (outcome == null) {
                out.put(ids[i], 'The action did not report a result for this record.');
            } else if (!outcome.isSuccess()) {
                out.put(ids[i], messageOf(outcome));
            }
        }
        return out;
    }

    private static String messageOf(Invocable.Action.Result outcome) {
        List<String> messages = new List<String>();
        for (Invocable.Action.Error e : outcome.getErrors()) {
            if (String.isNotBlank(e.getMessage())) {
                messages.add(e.getMessage());
            }
        }
        return messages.isEmpty() ? 'The action failed.' : String.join(messages, ' ');
    }

    /**
     * An Apex action that threw failed every record of the call, and its work
     * was undone (measured). Run each record on its own, while the transaction
     * has room; a record not reached keeps the first error.
     */
    private static Map<Id, String> retryOneByOne(
        GridConfig.Action action,
        String input,
        List<Id> ids,
        Map<Id, String> firstFailures
    ) {
        Map<Id, String> out = new Map<Id, String>(firstFailures);
        for (Id recordId : ids) {
            if (!roomToRetry()) {
                break;
            }
            Map<Id, String> single = failuresOf(
                new List<Id>{ recordId },
                invoke(action, input, new List<Id>{ recordId })
            );
            if (single.containsKey(recordId)) {
                out.put(recordId, single.get(recordId));
            } else {
                out.remove(recordId);
            }
        }
        return out;
    }

    @TestVisible
    private static Boolean roomToRetry() {
        return Limits.getCpuTime() * 2 < Limits.getLimitCpuTime() &&
            Limits.getDmlStatements() * 2 < Limits.getLimitDmlStatements() &&
            Limits.getQueries() * 2 < Limits.getLimitQueries();
    }
}
