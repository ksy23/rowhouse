/**
 * One chunk of a save, in its own transaction with its own limits.
 *
 * The finalizer is attached before any work, so even an uncatchable failure — a
 * CPU or heap limit in a subscriber's trigger — still produces a result row, and
 * the grid never waits on a chunk that silently vanished.
 *
 * In a grid that logs its changes the chunk reads the records' current
 * values before it writes, then logs every field that changed on every record
 * that saved, in this same transaction. If the log cannot be written the chunk
 * throws, its update is undone, and the finalizer reports each record as not
 * saved, with the reason.
 */
public with sharing class GridSaveChunk implements Queueable {
    private final String saveId;
    private final Integer chunkIndex;
    private final Integer chunkCount;
    private final List<SObject> records;
    /** Null unless the grid logs its changes. */
    private final GridAudit.Context audit;

    public GridSaveChunk(String saveId, Integer chunkIndex, Integer chunkCount, List<SObject> records) {
        this(saveId, chunkIndex, chunkCount, records, null);
    }

    public GridSaveChunk(
        String saveId,
        Integer chunkIndex,
        Integer chunkCount,
        List<SObject> records,
        GridAudit.Context audit
    ) {
        this.saveId = saveId;
        this.chunkIndex = chunkIndex;
        this.chunkCount = chunkCount;
        this.records = records;
        this.audit = audit;
    }

    public void execute(QueueableContext context) {
        List<Id> ids = new List<Id>();
        for (SObject r : records) {
            ids.add(r.Id);
        }
        System.attachFinalizer(new GridSaveFinalizer(saveId, chunkIndex, chunkCount, ids));

        Schema.SObjectType objectType = records.isEmpty() ? null : records[0].getSObjectType();
        Map<Id, SObject> before = audit == null || objectType == null ? null : GridAudit.before(objectType, records);
        List<Database.SaveResult> results = GridSecurity.updateRecords(records); // one DML statement
        if (audit != null && objectType != null) {
            GridAudit.write(GridAudit.updates(audit, objectType, records, results, before)); // throws: the update is undone
        }
        Integer successCount = 0;
        List<GridSaveError> errors = new List<GridSaveError>();
        for (Integer i = 0; i < results.size(); i++) {
            if (results[i].isSuccess()) {
                successCount++;
                continue;
            }
            for (Database.Error e : results[i].getErrors()) {
                List<String> fields = e.getFields();
                if (fields == null || fields.isEmpty()) {
                    errors.add(new GridSaveError(records[i].Id, null, e.getMessage()));
                }
                for (String f : fields == null ? new List<String>() : fields) {
                    errors.add(new GridSaveError(records[i].Id, localFieldName(records[i], f), e.getMessage()));
                }
            }
        }
        if (chunkIndex == 0) {
            purgeStale();
        }
        GridSecurity.insertOwnRecords(
            new List<SObject>{ GridSaveFinalizer.report(saveId, chunkIndex, chunkCount, successCount, errors) }
        );
    }

    /** HR-4: report the LOCAL name, whichever build this is. */
    private static String localFieldName(SObject record, String fieldName) {
        try {
            return GridDescribe.localName(GridDescribe.field(record.getSObjectType(), fieldName));
        } catch (GridException e) {
            return fieldName;
        }
    }

    /** Results nobody collected (a closed tab, say) are removed after a day. */
    private static void purgeStale() {
        List<SObject> stale = GridSecurity.query(
            'SELECT Id FROM Grid_Save_Result__c WHERE OwnerId = :ownerId AND CreatedDate < :cutoff LIMIT 2000',
            new Map<String, Object>{ 'ownerId' => UserInfo.getUserId(), 'cutoff' => Datetime.now().addDays(-1) }
        );
        GridSecurity.deleteOwnRecords(stale);
    }
}
