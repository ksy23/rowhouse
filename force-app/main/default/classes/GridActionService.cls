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
 * HOW IT RUNS (measured)
 * A flow runs as one flow interview per record (Flow.Interview), the record
 * Id as text in its input. From the installed package that is the only way
 * that reaches the org's own flows: Invocable.Action looks for them, and for
 * the org's own Apex and quick actions, in vain.
 *   An interview that fails is undone and fails alone; its error is the
 *   platform's own. Before each interview after the first there must be room
 *   in the transaction for twice what the last one used; rows not reached say
 *   so, and nothing else about them changed.
 * An Apex or quick action is one Invocable.Action call, one invocation per
 * record. The record Id goes in as text: a quick action's contextId refuses an
 * Id-typed value, and an Apex action's Id input takes text.
 *   A quick action that fails for one record fails for that record alone.
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
    /** Said of a row not reached because the request came close to the transaction's limits. */
    @TestVisible
    private static final String NOT_REACHED = 'Not run: this request came close to Salesforce\'s limits. Run the action again on this row.';

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
        Outcome done = runFirstFound(action, input, runnable);
        Map<Id, String> failures = done.failures;
        if (!done.probe && action.type == 'apex' && runnable.size() > 1 && failures.size() == runnable.size()) {
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
     * One way to reach an action. From the installed package, Invocable.Action
     * finds none of the org's own flows, Apex or quick actions, whatever
     * namespace it is given, while Flow.Interview runs the org's own flow by
     * its plain name (measured, 0.1 Beta 11 to 13). So a flow runs as a flow
     * interview; Apex and quick actions are tried each way in turn, and the
     * first that finds the action runs it. A way that found nothing ran
     * nothing, so nothing runs twice.
     */
    @TestVisible
    private class Way {
        /** invocable (Invocable.Action), interview (Flow.Interview), callable (System.Callable) or quickaction (QuickAction). */
        public String how;
        /** The name this way looks for. */
        public String name;
        public Boolean withNamespace;
        /** Blank or null for none. */
        public String namespace;
        public String label;
        Way(String how, String name, Boolean withNamespace, String namespace, String label) {
            this.how = how;
            this.name = name;
            this.withNamespace = withNamespace;
            this.namespace = namespace;
            this.label = label;
        }
    }

    /** What one way did: whether it found the action, and the records that failed. */
    @TestVisible
    private class Outcome {
        public Boolean found = true;
        /** True when this is the troubleshooting report, which kept nothing. */
        public Boolean probe = false;
        public Map<Id, String> failures = new Map<Id, String>();
        public String note = '';
    }

    /** The ways to try, in turn. */
    @TestVisible
    private static List<Way> waysFor(GridConfig.Action action) {
        String name = action.actionName;
        if (action.type == 'flow') {
            // A flow of another package: its namespace, then its own name.
            Integer cut = name.indexOf('__');
            return new List<Way>{
                cut > 0
                    ? new Way('interview', name.substring(cut + 2), true, name.left(cut), 'interview')
                    : new Way('interview', name, false, null, 'interview')
            };
        }
        List<Way> out = new List<Way>{ new Way('invocable', name, false, null, 'as written') };
        if (action.type == 'apex') {
            out.add(new Way('callable', name, true, '', 'Callable, blank namespace'));
            out.add(new Way('callable', name, true, null, 'Callable, null namespace'));
            out.add(new Way('callable', name, false, null, 'Callable'));
        }
        if (action.type == 'quickaction') {
            Boolean bare = !name.contains('.');
            if (bare) {
                out.add(new Way('invocable', 'Global.' + name, false, null, 'as Global.' + name));
            }
            out.add(new Way('quickaction', name, false, null, 'QuickAction'));
            if (bare) {
                out.add(new Way('quickaction', 'Global.' + name, false, null, 'QuickAction, Global.' + name));
            }
        }
        return out;
    }

    /**
     * Runs the action the first way that finds it. When the first way finds
     * nothing and the user holds Rowhouse Grid Diagnostics, every other way is
     * tried and undone, and the rows say what each did (probe). When no way
     * finds it, the rows say what each way was told.
     */
    @TestVisible
    private static Outcome runFirstFound(GridConfig.Action action, String input, List<Id> ids) {
        List<Way> ways = waysFor(action);
        List<String> tried = new List<String>();
        for (Integer i = 0; i < ways.size(); i++) {
            Outcome o = runWay(ways[i], action, input, ids);
            if (o.found) {
                return o;
            }
            tried.add(ways[i].label + ': ' + o.note);
            if (i == 0 && ways.size() > 1 && GridSecurity.hasCustomPermission(GridException.DIAGNOSTICS)) {
                return probe(action, input, ids, ways, tried);
            }
        }
        Outcome none = new Outcome();
        String message = 'Salesforce did not find ' + action.actionName + ' (' + String.join(tried, ' | ') + ').';
        for (Id recordId : ids) {
            none.failures.put(recordId, message);
        }
        return none;
    }

    /** Every way after the first, each undone, and what each did, as every row's error. */
    @TestVisible
    private static Outcome probe(
        GridConfig.Action action,
        String input,
        List<Id> ids,
        List<Way> ways,
        List<String> lines
    ) {
        for (Integer i = 1; i < ways.size(); i++) {
            Savepoint before = Database.setSavepoint();
            String line;
            try {
                Outcome o = runWay(ways[i], action, input, ids);
                line = !o.found
                    ? 'not found, ' + o.note
                    : o.failures.isEmpty() ? 'RAN' : 'ran, failed: ' + String.join(o.failures.values(), ' / ');
            } catch (Exception e) {
                line = 'threw ' + e.getTypeName() + ': ' + e.getMessage();
            }
            Database.rollback(before);
            lines.add(ways[i].label + ': ' + line);
        }
        Outcome out = new Outcome();
        out.probe = true;
        String report = 'Probe, nothing kept. ' + String.join(lines, ' | ');
        for (Id recordId : ids) {
            out.failures.put(recordId, report);
        }
        return out;
    }

    @TestVisible
    private static Outcome runWay(Way way, GridConfig.Action action, String input, List<Id> ids) {
        if (way.how == 'interview') {
            return interviews(way, input, ids);
        }
        if (way.how == 'callable') {
            return callable(way, input, ids);
        }
        if (way.how == 'quickaction') {
            return quickActions(way, ids);
        }
        return invocable(way, action, input, ids);
    }

    private static Outcome notFoundBecause(String note) {
        Outcome out = new Outcome();
        out.found = false;
        out.note = note;
        return out;
    }

    /** The Invocable.Action this way names; throws when Salesforce refuses to make one. */
    private static Invocable.Action invocableAt(Way way, String type) {
        return way.withNamespace
            ? Invocable.Action.createCustomAction(type, way.namespace, way.name)
            : Invocable.Action.createCustomAction(type, way.name);
    }

    /** One call, one invocation per record, the Id as text. */
    private static Outcome invocable(Way way, GridConfig.Action action, String input, List<Id> ids) {
        List<Invocable.Action.Result> results;
        try {
            Invocable.Action call = invocableAt(way, INVOCABLE_TYPE.get(action.type));
            for (Integer i = 0; i < ids.size(); i++) {
                if (i > 0) {
                    call.addInvocation();
                }
                call.setInvocationParameter(input, String.valueOf(ids[i]));
            }
            results = call.invoke();
        } catch (Exception e) {
            return notFoundBecause(e.getTypeName() + ': ' + e.getMessage()); // the call was never made
        }
        String missing = notFound(results);
        if (missing != null) {
            return notFoundBecause(missing);
        }
        Outcome out = new Outcome();
        out.failures = failuresOf(ids, results);
        return out;
    }

    /**
     * One flow interview per record, the Id as text. An interview that fails
     * is undone and fails alone. Before each interview after the first, there
     * must be room in the transaction for twice what the last one used; rows
     * not reached say so.
     */
    private static Outcome interviews(Way way, String input, List<Id> ids) {
        Outcome out = new Outcome();
        List<Integer> used = new List<Integer>{ 0, 0, 0 }; // queries, DML statements, CPU ms, of the last interview
        for (Integer i = 0; i < ids.size(); i++) {
            Id recordId = ids[i];
            if (i > 0 && !roomForTwice(used)) {
                for (Integer j = i; j < ids.size(); j++) {
                    out.failures.put(ids[j], NOT_REACHED);
                }
                break;
            }
            Map<String, Object> inputs = new Map<String, Object>{ input => String.valueOf(recordId) };
            Flow.Interview interview;
            try {
                interview = way.withNamespace
                    ? Flow.Interview.createInterview(way.namespace, way.name, inputs)
                    : Flow.Interview.createInterview(way.name, inputs);
            } catch (Exception e) {
                if (i == 0) {
                    return notFoundBecause(e.getTypeName() + ': ' + e.getMessage());
                }
                out.failures.put(recordId, e.getMessage());
                continue;
            }
            Integer queries = Limits.getQueries();
            Integer dml = Limits.getDmlStatements();
            Integer cpu = Limits.getCpuTime();
            Savepoint before = Database.setSavepoint();
            try {
                interview.start();
            } catch (Exception e) {
                Database.rollback(before);
                out.failures.put(recordId, e.getMessage());
            }
            used = new List<Integer>{
                Limits.getQueries() - queries,
                Limits.getDmlStatements() - dml,
                Limits.getCpuTime() - cpu
            };
        }
        return out;
    }

    /** Is there room for twice what one interview used (at least one query and two DML statements)? */
    private static Boolean roomForTwice(List<Integer> used) {
        return Limits.getQueries() + 2 * Math.max(used[0], 1) <= Limits.getLimitQueries() &&
            Limits.getDmlStatements() + 2 * Math.max(used[1], 2) <= Limits.getLimitDmlStatements() &&
            Limits.getCpuTime() + 2 * used[2] <= Limits.getLimitCpuTime();
    }

    /** For the probe: the org's own class, as a System.Callable, given the record Ids as text. */
    private static Outcome callable(Way way, String input, List<Id> ids) {
        Object made;
        try {
            Type t = way.withNamespace ? Type.forName(way.namespace, way.name) : Type.forName(way.name);
            if (t == null) {
                return notFoundBecause('Type.forName found nothing');
            }
            made = t.newInstance();
        } catch (Exception e) {
            return notFoundBecause(e.getTypeName() + ': ' + e.getMessage());
        }
        if (!(made instanceof Callable)) {
            return notFoundBecause('found, but not a Callable');
        }
        List<String> texts = new List<String>();
        for (Id recordId : ids) {
            texts.add(String.valueOf(recordId));
        }
        Outcome out = new Outcome();
        try {
            ((Callable) made).call('run', new Map<String, Object>{ input => texts });
        } catch (Exception e) {
            for (Id recordId : ids) {
                out.failures.put(recordId, e.getTypeName() + ': ' + e.getMessage());
            }
        }
        return out;
    }

    /** The quick action on each record, a new record of the action's target object for each. */
    private static Outcome quickActions(Way way, List<Id> ids) {
        Schema.SObjectType target;
        try {
            List<QuickAction.DescribeQuickActionResult> described = QuickAction.describeQuickActions(
                new List<String>{ way.name }
            );
            if (described.isEmpty()) {
                return notFoundBecause('describeQuickActions found nothing');
            }
            target = GridDescribe.typeFor(described[0].getTargetSobjectType());
        } catch (Exception e) {
            return notFoundBecause(e.getTypeName() + ': ' + e.getMessage());
        }
        List<QuickAction.QuickActionRequest> requests = new List<QuickAction.QuickActionRequest>();
        for (Id recordId : ids) {
            QuickAction.QuickActionRequest request = new QuickAction.QuickActionRequest();
            request.setQuickActionName(way.name);
            request.setContextId(recordId);
            request.setRecord(target.newSObject());
            requests.add(request);
        }
        Outcome out = new Outcome();
        List<QuickAction.QuickActionResult> results;
        try {
            results = QuickAction.performQuickActions(requests, false);
        } catch (Exception e) {
            for (Id recordId : ids) {
                out.failures.put(recordId, e.getTypeName() + ': ' + e.getMessage());
            }
            return out;
        }
        for (Integer i = 0; i < ids.size(); i++) {
            if (!results[i].isSuccess()) {
                List<String> messages = new List<String>();
                for (Database.Error e : results[i].getErrors()) {
                    messages.add(e.getMessage());
                }
                out.failures.put(ids[i], messages.isEmpty() ? 'The action failed.' : String.join(messages, ' '));
            }
        }
        return out;
    }

    /**
     * The input that takes the record Id: the Grid Action's Input Name, else
     * recordId for a flow and contextId for a quick action; for Apex, the
     * action's one input, found by describe. Throws in an admin's terms when
     * an Apex action has none, or several and no Input Name says which.
     */
    @TestVisible
    private static String inputFor(GridConfig.Action action) {
        if (String.isNotBlank(action.serverInput)) {
            return action.serverInput;
        }
        if (DEFAULT_INPUT.containsKey(action.type)) {
            return DEFAULT_INPUT.get(action.type);
        }
        List<Invocable.Action.DescribeResult> described;
        try {
            described = Invocable.Action.createCustomAction('apex', action.actionName).getDescribe();
        } catch (Exception e) {
            described = new List<Invocable.Action.DescribeResult>();
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

    /** "Action name not found…" when every invocation failed for want of the action, else null. */
    private static String notFound(List<Invocable.Action.Result> results) {
        if (results == null || results.isEmpty()) {
            return null;
        }
        String said;
        for (Invocable.Action.Result r : results) {
            Boolean missing = false;
            for (Invocable.Action.Error e : r.isSuccess() ? new List<Invocable.Action.Error>() : r.getErrors()) {
                if (e.getMessage() != null && e.getMessage().startsWith('Action name not found')) {
                    missing = true;
                    said = e.getMessage();
                }
            }
            if (!missing) {
                return null;
            }
        }
        return said;
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
            Map<Id, String> single = runFirstFound(action, input, new List<Id>{ recordId }).failures;
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
