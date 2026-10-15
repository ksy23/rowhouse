/**
 * GridActionService — runs a grid's autolaunched flow on the server, on one
 * row or on up to MAX_IDS selected rows per call. A screen flow and a quick
 * action are not run here: they open in the browser, the screen flow in
 * lightning-flow and the quick action in Salesforce's own window.
 *
 * Nothing about the request is trusted (HR-6). Before anything runs:
 *   the action must be one of the grid's own Grid Actions, found by name in
 *   the configuration read here, never taken from the browser;
 *   it must be an autolaunched flow, and offered for a selection if the
 *   request holds more than one record;
 *   the user must be able to read the object, and hold the action's custom
 *   permission (GridSecurity), which an autolaunched flow always names
 *   (GridActions);
 *   the request holds at most MAX_IDS Ids, every one a record of the grid's
 *   object. One that is not refuses the whole request, as for a delete.
 * Records the user cannot see (sharing), or that were deleted, are not run and
 * come back as row errors.
 *
 * HOW IT RUNS (measured)
 * One flow interview per record (Flow.Interview), the record Id as text in its
 * input (recordId unless the action names another). From the installed
 * package that is the only way that reaches the org's own flows:
 * Invocable.Action looks for them in vain.
 *   An interview that fails is undone and fails alone; its error is the
 *   platform's own. Before each interview after the first there must be room
 *   in the transaction for twice what the last one used; rows not reached say
 *   so, and nothing about them changed.
 *
 * ACCESS
 * The flow runs with the access its own settings give it. From Apex the
 * platform does not check the user's access to the flow, and a flow in its
 * default run mode ran in system context: it wrote a field the user could not
 * edit (measured). So an autolaunched flow must name a Required Permission
 * (GridActions skips one that does not), and runs only for users who hold it.
 * Rowhouse checks the object, the records and that permission.
 *
 * AUDIT TRAIL
 * In a grid that logs its changes the user must be able to write the log
 * before the flow runs, and each record it ran on is logged, naming the
 * action, in this same transaction. What the flow itself changed is not: the
 * grid cannot see inside a flow. A screen flow or a quick action runs in the
 * browser, so it is not logged at all.
 */
public with sharing class GridActionService {
    /** Records per call. Small, so a heavy flow stays within one transaction's limits. */
    public static final Integer MAX_IDS = 50;
    /** Said of a row not reached because the request came close to the transaction's limits. */
    @TestVisible
    private static final String NOT_REACHED = 'Not run: this request came close to Salesforce\'s limits. Run the action again on this row.';

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
        if (action.type == 'screenflow') {
            throw new GridException(action.label + ' is a screen flow: it runs in the browser, not on the server.');
        }
        if (action.type != 'flow') {
            throw new GridException(
                action.label + ' is a quick action: it opens in Salesforce\'s own window, not on the server.'
            );
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
        Map<Id, String> failures = interviews(action, runnable);
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
     * A flow's namespace and its own name: { null, Name } for the org's own
     * flow, { ns, Name } for ns__Name, a flow of an installed package.
     */
    @TestVisible
    private static List<String> namespaceAndName(String apiName) {
        Integer cut = apiName.indexOf('__');
        return cut > 0
            ? new List<String>{ apiName.left(cut), apiName.substring(cut + 2) }
            : new List<String>{ null, apiName };
    }

    /**
     * One flow interview per record, the Id as text; { recordId: message } for
     * every record whose interview failed or was not reached. An interview
     * that fails is undone and fails alone. Before each interview after the
     * first, there must be room in the transaction for twice what the last
     * one used.
     */
    @TestVisible
    private static Map<Id, String> interviews(GridConfig.Action action, List<Id> ids) {
        String input = String.isNotBlank(action.serverInput) ? action.serverInput : 'recordId';
        List<String> parts = namespaceAndName(action.actionName);
        Map<Id, String> failures = new Map<Id, String>();
        List<Integer> used = new List<Integer>{ 0, 0, 0 }; // queries, DML statements, CPU ms, of the last interview
        for (Integer i = 0; i < ids.size(); i++) {
            Id recordId = ids[i];
            if (i > 0 && !roomForTwice(used)) {
                for (Integer j = i; j < ids.size(); j++) {
                    failures.put(ids[j], NOT_REACHED);
                }
                break;
            }
            Map<String, Object> inputs = new Map<String, Object>{ input => String.valueOf(recordId) };
            Flow.Interview interview;
            try {
                interview = parts[0] == null
                    ? Flow.Interview.createInterview(parts[1], inputs)
                    : Flow.Interview.createInterview(parts[0], parts[1], inputs);
            } catch (Exception e) {
                String missing =
                    'There is no autolaunched flow named "' +
                    action.actionName +
                    '" (Grid Action ' +
                    action.name +
                    ').';
                for (Id each : ids) {
                    failures.put(each, missing);
                }
                return failures;
            }
            Integer queries = Limits.getQueries();
            Integer dml = Limits.getDmlStatements();
            Integer cpu = Limits.getCpuTime();
            Savepoint before = Database.setSavepoint();
            try {
                interview.start();
            } catch (Exception e) {
                Database.rollback(before);
                String said = e.getMessage();
                failures.put(recordId, String.isBlank(said) ? 'The flow failed.' : said.normalizeSpace()); // the platform's words, without its doubled spaces
            }
            used = new List<Integer>{
                Limits.getQueries() - queries,
                Limits.getDmlStatements() - dml,
                Limits.getCpuTime() - cpu
            };
        }
        return failures;
    }

    /** Is there room for twice what one interview used (at least one query and two DML statements)? */
    @TestVisible
    private static Boolean roomForTwice(List<Integer> used) {
        return Limits.getQueries() + 2 * Math.max(used[0], 1) <= Limits.getLimitQueries() &&
            Limits.getDmlStatements() + 2 * Math.max(used[1], 2) <= Limits.getLimitDmlStatements() &&
            Limits.getCpuTime() + 2 * used[2] <= Limits.getLimitCpuTime();
    }
}
