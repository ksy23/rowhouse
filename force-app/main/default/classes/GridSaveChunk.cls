/**
 * One chunk of a save, in its own transaction with its own limits.
 *
 * The finalizer is attached before any work, so even an uncatchable failure — a
 * CPU or heap limit in a subscriber's trigger — still produces a result row, and
 * the grid never waits on a chunk that silently vanished.
 *
 * A chunk of parent records (a column on a parent record, GridPaths) reports
 * as the grid's rows: each holder's outcome goes to every row cell whose edit
 * it carries (`reportAs`), since the grid knows the edit by its row.
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
    private final GridEditLog.Context audit;
    /** For parent records: holder Id to the row cells it saves, [[rowId, path], ...]; null for the grid's own records. */
    private final Map<Id, List<List<String>>> reportAs;

    public GridSaveChunk(String saveId, Integer chunkIndex, Integer chunkCount, List<SObject> records) {
        this(saveId, chunkIndex, chunkCount, records, null);
    }

    public GridSaveChunk(
        String saveId,
        Integer chunkIndex,
        Integer chunkCount,
        List<SObject> records,
        GridEditLog.Context audit
    ) {
        this(saveId, chunkIndex, chunkCount, records, audit, null);
    }

    /** A chunk of parent records, reported as the row cells their edits came from. */
    public GridSaveChunk(
        String saveId,
        Integer chunkIndex,
        Integer chunkCount,
        List<SObject> records,
        GridEditLog.Context audit,
        Map<Id, List<List<String>>> reportAs
    ) {
        this.saveId = saveId;
        this.chunkIndex = chunkIndex;
        this.chunkCount = chunkCount;
        this.records = records;
        this.audit = audit;
        this.reportAs = reportAs;
    }

    public void execute(QueueableContext context) {
        List<Id> ids = new List<Id>();
        Set<Id> rowIds = new Set<Id>();
        for (SObject r : records) {
            if (reportAs == null) {
                ids.add(r.Id);
                continue;
            }
            for (List<String> cell : reportAs.get(r.Id)) {
                if (rowIds.add(Id.valueOf(cell[0]))) {
                    ids.add(Id.valueOf(cell[0])); // a failed chunk is reported on the grid's rows
                }
            }
        }
        System.attachFinalizer(new GridSaveFinalizer(saveId, chunkIndex, chunkCount, ids));

        Schema.SObjectType objectType = records.isEmpty() ? null : records[0].getSObjectType();
        Map<Id, SObject> before = audit == null || objectType == null ? null : GridEditLog.before(objectType, records);
        Boolean logs = audit != null && objectType != null;
        // In a grid that logs, the update and its log entries stand or fall
        // together: a log that cannot be written undoes the update here, rather
        // than leaving that to the job's failure.
        Savepoint beforeUpdate = logs ? Database.setSavepoint() : null;
        List<Database.SaveResult> results = GridSecurity.updateRecords(records); // one DML statement
        if (logs) {
            try {
                GridEditLog.write(GridEditLog.updates(audit, objectType, records, results, before));
            } catch (GridException e) {
                Database.rollback(beforeUpdate);
                throw e;
            }
        }
        Integer successCount = 0;
        List<GridSaveError> errors = new List<GridSaveError>();
        for (Integer i = 0; i < results.size(); i++) {
            if (results[i].isSuccess()) {
                successCount++;
                continue;
            }
            if (reportAs != null) {
                // A parent record's error belongs on each row cell that edited it.
                for (Database.Error e : results[i].getErrors()) {
                    for (List<String> cell : reportAs.get(records[i].Id)) {
                        errors.add(new GridSaveError(Id.valueOf(cell[0]), cell[1], e.getMessage()));
                    }
                }
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
