/**
 * GridDeleteService — deletes the rows a user selected.
 *
 * Off unless the grid's configuration sets Allow Mass Delete. The grid asks the
 * user to confirm, then sends the selected Ids in batches of at most 200, one
 * call per batch, so each batch is one transaction with its own limits.
 *
 * Nothing about the request is trusted (HR-6). Before anything is deleted:
 *   the configuration must allow mass delete (read here, not from the client);
 *   the user must have delete permission on the object (GridSecurity);
 *   the request holds at most 200 Ids;
 *   every Id is a record of the grid's own object. One that is not refuses the
 *   whole request: the grid never sends one, so it is not a mistake to report
 *   per row but a request to refuse.
 * Then one partial delete in user mode. A record the user may not delete
 * (sharing, a subscriber's trigger, a child record that blocks it) fails alone
 * and comes back as a row error. Deleted records go to the Recycle Bin.
 *
 * In a grid that logs its changes the user must be able to write the
 * log before anything is deleted; the records' names are read first, and each
 * record deleted is logged, named as it was, in this same transaction. If the
 * log cannot be written nothing stays deleted.
 *
 * UNDO, AND EVERY MATCHING RECORD
 * Right after a delete the grid offers Undo: restoreRows puts the records it
 * deleted back from the Recycle Bin, under the same checks (the configuration
 * allows deleting, the user may delete the object, at most 200 Ids, all of the
 * grid's object), in user mode, logged as Restore. A record that is no longer
 * in the Recycle Bin, or that this user may not restore, fails alone.
 * matchingIds lists, a slice at a time, the records the grid's search and
 * filters match, beyond what is loaded, for "delete every matching record":
 * the browser deletes each slice through deleteRows as above.
 */
public with sharing class GridDeleteService {

    /** One DML statement's worth, as for a save chunk. */
    public static final Integer MAX_IDS = 200;

    /** What happened to one batch. */
    public class Result {
        @AuraEnabled public List<Id> deletedIds = new List<Id>();
        /** Row errors: recordId and message, never a field. */
        @AuraEnabled public List<GridSaveError> errors = new List<GridSaveError>();
    }

    /** What one restore did. */
    public class RestoreResult {
        @AuraEnabled public List<Id> restoredIds = new List<Id>();
        /** Row errors: recordId and message. */
        @AuraEnabled public List<GridSaveError> errors = new List<GridSaveError>();
    }

    /** Ids matchingIds lists in one call: one query page. */
    public static final Integer MATCH_SLICE = GridDataService.MAX_PAGE_SIZE;

    public static Result deleteRows(String configName, List<Id> recordIds) {
        Result result = new Result();
        if (recordIds == null || recordIds.isEmpty()) {
            return result; // nothing asked, no DML
        }
        GridConfig.Definition def = deletable(configName);
        List<Id> ids = checkedIds(def, recordIds);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridAudit.Context audit = GridAudit.start(def); // null unless the grid logs; throws if the user cannot
        Map<Id, String> names = audit == null ? null : GridAudit.namesOf(objectType, ids);
        List<Database.DeleteResult> outcomes = GridSecurity.deleteRecords(objectType, ids);
        for (Integer i = 0; i < outcomes.size(); i++) {
            Database.DeleteResult outcome = outcomes[i];
            if (outcome.isSuccess()) {
                result.deletedIds.add(ids[i]);
                continue;
            }
            List<String> messages = new List<String>();
            for (Database.Error e : outcome.getErrors()) {
                messages.add(e.getMessage());
            }
            result.errors.add(new GridSaveError(ids[i], null, String.join(messages, ' ')));
        }
        GridAudit.write(GridAudit.deletes(audit, result.deletedIds, names)); // throws, and undoes the delete, if it cannot
        return result;
    }

    /** Put deleted records back from the Recycle Bin: the grid's Undo. */
    public static RestoreResult restoreRows(String configName, List<Id> recordIds) {
        RestoreResult result = new RestoreResult();
        if (recordIds == null || recordIds.isEmpty()) {
            return result;
        }
        GridConfig.Definition def = deletable(configName);
        List<Id> ids = checkedIds(def, recordIds);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridAudit.Context audit = GridAudit.start(def);
        List<Database.UndeleteResult> outcomes = GridSecurity.undeleteRecords(objectType, ids);
        for (Integer i = 0; i < outcomes.size(); i++) {
            if (outcomes[i].isSuccess()) {
                result.restoredIds.add(ids[i]);
                continue;
            }
            List<String> messages = new List<String>();
            for (Database.Error e : outcomes[i].getErrors()) {
                messages.add(e.getMessage());
            }
            result.errors.add(new GridSaveError(ids[i], null, String.join(messages, ' ')));
        }
        // Named now they are back, so readable again.
        Map<Id, String> names = audit == null ? null : GridAudit.namesOf(objectType, result.restoredIds);
        GridAudit.write(GridAudit.restores(audit, result.restoredIds, names));
        return result;
    }

    /**
     * The next slice of the records the grid's request matches, after
     * `afterId`, for deleting every match. Only for a grid that allows
     * deleting, for a user who may delete its object.
     */
    public static List<Id> matchingIds(GridConfig.Definition def, GridRequest request, Id afterId) {
        if (def.allowMassDelete != true) {
            throw new GridException('This grid does not allow deleting records.');
        }
        GridSecurity.requireDelete(GridDescribe.typeFor(def.objectApiName));
        return GridDataService.idsMatching(request, afterId, MATCH_SLICE);
    }

    /** The configuration, when it allows deleting and this user may delete its object; throws otherwise. */
    private static GridConfig.Definition deletable(String configName) {
        GridConfig.Definition def = GridConfig.load(configName);
        if (def.allowMassDelete != true) {
            throw new GridException('This grid does not allow deleting records.');
        }
        GridSecurity.requireDelete(GridDescribe.typeFor(def.objectApiName));
        return def;
    }

    /**
     * At most MAX_IDS Ids, each a record of the grid's object, without
     * repeats. One that is not the grid's refuses the whole request: the grid
     * never sends one.
     */
    private static List<Id> checkedIds(GridConfig.Definition def, List<Id> recordIds) {
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        if (recordIds.size() > MAX_IDS) {
            throw new GridException('Delete at most ' + MAX_IDS + ' records at a time; this request has '
                + recordIds.size() + '.');
        }
        List<Id> ids = new List<Id>();
        Set<Id> seen = new Set<Id>();
        for (Id recordId : recordIds) {
            if (recordId == null || recordId.getSObjectType() != objectType) {
                throw new GridException('Record ' + recordId + ' is not a ' + GridDescribe.localName(objectType)
                    + '. Nothing was changed.');
            }
            if (seen.add(recordId)) {
                ids.add(recordId);
            }
        }
        return ids;
    }
}
