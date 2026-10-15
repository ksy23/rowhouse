/**
 * GridOwnerService — Change Owner, from a row's menu, as a list view has it.
 *
 * The new owner is saved at once, as Salesforce's Change Owner does, not
 * held as an unsaved edit. Offered only where GridConfig.forUser() sets
 * canChangeOwner: a grid that edits cells, on an object with an owner, for a
 * user who may edit the object and its owner. Read here again, not from the
 * client (HR-6).
 *
 * Before anything is changed:
 *   the grid must offer Change Owner to this user (canChangeOwner);
 *   the request holds at most MAX_IDS Ids, each a record of the grid's object
 *   (one that is not refuses the whole request: the grid never sends one);
 *   the new owner is one the record can have: an active standard or partner
 *   user, or a queue that accepts the object, as the owner search offers.
 * Then one partial update in user mode (GridSecurity): sharing and the
 * platform's own rules (Transfer Record, a validation rule, a trigger) decide
 * each record, and a record that cannot change owner fails alone, with
 * Salesforce's message.
 *
 * In a grid that logs its changes, the user must be able to write the log
 * before anything is changed, and each record whose owner changed is logged
 * as an Update of Owner, with the old and new owner, in this same transaction.
 * If the log cannot be written, no owner stays changed.
 */
public with sharing class GridOwnerService {
    /** One DML statement's worth, as for a delete. */
    public static final Integer MAX_IDS = 200;

    /** What one Change Owner did. */
    public class Result {
        @AuraEnabled
        public List<Id> changedIds = new List<Id>();
        /** Row errors: recordId and message. */
        @AuraEnabled
        public List<GridSaveError> errors = new List<GridSaveError>();
    }

    /** Users and queues a record of this grid can be given to, for Change Owner's search. */
    public static List<Map<String, String>> searchOwners(String configName, String term) {
        GridConfig.Definition def = changeable(configName);
        String contains =
            '%' +
            GridDataService.escapeLike(term == null ? '' : term.trim().left(GridLookup.MAX_TERM)) +
            '%';
        return GridLookup.owners(GridDescribe.typeFor(def.objectApiName), contains);
    }

    public static Result changeOwner(String configName, List<Id> recordIds, Id ownerId) {
        Result result = new Result();
        if (recordIds == null || recordIds.isEmpty()) {
            return result; // nothing asked, no DML
        }
        GridConfig.Definition def = changeable(configName);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        List<Id> ids = checkedIds(objectType, recordIds);
        requireOwner(objectType, ownerId);

        List<SObject> records = new List<SObject>();
        for (Id recordId : ids) {
            SObject r = objectType.newSObject(recordId);
            r.put('OwnerId', ownerId);
            records.add(r);
        }
        GridEditLog.Context audit = GridEditLog.start(def); // null unless the grid logs; throws if the user cannot
        Map<Id, SObject> before = audit == null ? null : GridEditLog.before(objectType, records);
        Savepoint beforeUpdate = audit == null ? null : Database.setSavepoint();
        List<Database.SaveResult> outcomes = GridSecurity.updateRecords(records);
        if (audit != null) {
            try {
                GridEditLog.write(GridEditLog.updates(audit, objectType, records, outcomes, before));
            } catch (GridException e) {
                Database.rollback(beforeUpdate); // no owner stays changed without its entry
                throw e;
            }
        }
        for (Integer i = 0; i < outcomes.size(); i++) {
            if (outcomes[i].isSuccess()) {
                result.changedIds.add(ids[i]);
                continue;
            }
            List<String> messages = new List<String>();
            for (Database.Error e : outcomes[i].getErrors()) {
                messages.add(e.getMessage());
            }
            result.errors.add(new GridSaveError(ids[i], null, String.join(messages, ' ')));
        }
        return result;
    }

    /** The grid, for a user it offers Change Owner to; refused otherwise. */
    private static GridConfig.Definition changeable(String configName) {
        GridConfig.Definition def = GridConfig.forUser(configName);
        if (def.canChangeOwner != true) {
            throw new GridException('You cannot change the owner of records in this grid.');
        }
        return def;
    }

    /** At most MAX_IDS Ids, each a record of the grid's object, without repeats. */
    private static List<Id> checkedIds(Schema.SObjectType objectType, List<Id> recordIds) {
        if (recordIds.size() > MAX_IDS) {
            throw new GridException(
                'Change the owner of at most ' +
                    MAX_IDS +
                    ' records at a time; this request has ' +
                    recordIds.size() +
                    '.'
            );
        }
        List<Id> ids = new List<Id>();
        Set<Id> seen = new Set<Id>();
        for (Id recordId : recordIds) {
            if (recordId == null || recordId.getSObjectType() != objectType) {
                throw new GridException(
                    'Record ' + recordId + ' is not a ' + GridDescribe.localName(objectType) + '. Nothing was changed.'
                );
            }
            if (seen.add(recordId)) {
                ids.add(recordId);
            }
        }
        return ids;
    }

    /**
     * The new owner must be one the search offers: an active standard or
     * partner user, or a queue that accepts this object. Read in user mode.
     */
    private static void requireOwner(Schema.SObjectType objectType, Id ownerId) {
        Boolean allowed = false;
        if (ownerId != null && ownerId.getSObjectType() == User.SObjectType) {
            allowed = !GridSecurity.query(
                    'SELECT Id FROM User WHERE Id = :ownerId AND IsActive = true' +
                    ' AND UserType IN (\'Standard\', \'PowerPartner\')',
                    new Map<String, Object>{ 'ownerId' => ownerId }
                )
                .isEmpty();
        } else if (ownerId != null && ownerId.getSObjectType() == Group.SObjectType) {
            allowed = !GridSecurity.query(
                    'SELECT Id FROM Group WHERE Id = :ownerId AND Type = \'Queue\'' +
                    ' AND Id IN (SELECT QueueId FROM QueueSobject WHERE SobjectType = :objectName)',
                    new Map<String, Object>{ 'ownerId' => ownerId, 'objectName' => GridDescribe.apiName(objectType) }
                )
                .isEmpty();
        }
        if (!allowed) {
            throw new GridException(
                'That owner cannot own ' +
                    objectType.getDescribe(SObjectDescribeOptions.DEFERRED).getLabelPlural() +
                    ': choose an active user, or a queue that holds them. Nothing was changed.'
            );
        }
    }
}
