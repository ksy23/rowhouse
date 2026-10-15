/**
 * GridSaveService — validates a save synchronously, then commits it
 * asynchronously, one Queueable per 200-record chunk.
 *
 * WHY QUEUEABLE PER CHUNK
 * Each chunk is its own transaction with its own governor limits. A chunk that
 * hits a CPU or heap limit in a subscriber's own trigger fails alone; it cannot
 * roll back the chunks that succeeded. The price is that the save is
 * asynchronous: this method returns a ticket, each chunk records its outcome in
 * a Grid_Save_Result__c row, and the grid polls status() until every chunk has
 * reported. The calling transaction issues no DML at all.
 *
 * WHAT HAPPENS SYNCHRONOUSLY, BEFORE ANYTHING IS QUEUED
 *   HR-6  every payload field must be an editable column of THIS grid's
 *         configuration. A field the user could edit but the grid never
 *         rendered is refused — FLS cannot catch that, only the allow-list can.
 *   FLS   Security.stripInaccessible removes every populated field the user
 *         cannot update, across the whole payload, not just rendered fields.
 *   Types values are converted by the field's type here, so a bad value is a
 *         per-cell error the user sees at once rather than a failed job.
 *
 * HR-7: no DML per record. Each chunk issues one Database.update.
 *
 * FIELDS ON PARENT RECORDS
 * A column can show a field of a parent record (GridPaths: Account.Industry
 * on a Contact grid). An edit to it is written to that parent record, once
 * however many rows share the parent, in chunks of its own; each chunk reports
 * the outcome on the row cells the edit came from. Two rows that set the same
 * parent field to different values are both refused, and neither is written.
 *
 * AUDIT TRAIL
 * When the configuration logs changes, the user must be able to write the log
 * before anything is queued (GridEditLog.start), and each chunk logs its own
 * changes in its own transaction. A chunk then holds at most
 * GridEditLog.MAX_ENTRIES changed cells as well as at most CHUNK_SIZE records,
 * so its log fits the transaction's limits (chunksOf).
 */
public with sharing class GridSaveService {
    public static final Integer CHUNK_SIZE = 200;
    /** Salesforce's own wording for a required field left blank. */
    public static final String REQUIRED_MESSAGE = 'Complete this field.';

    /** Validate and queue. Returns a ticket; poll status(ticket.saveId). */
    public static GridSaveResult save(String configName, List<Map<String, Object>> rows) {
        GridSaveResult ticket = new GridSaveResult();
        if (rows == null || rows.isEmpty()) {
            return ticket; // done, nothing queued, no DML
        }
        GridConfig.Definition def = GridConfig.load(configName);
        if (def.allowInlineEdit != true) {
            throw new GridException('This grid does not allow editing records.');
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridSecurity.requireUpdate(objectType);
        GridEditLog.Context audit = GridEditLog.start(def); // null unless the grid logs; throws if the user cannot
        Set<String> allowed = def.editableFields();
        Set<String> rejected = new Set<String>();

        // A row's own fields and its parent records' fields are written apart.
        List<Map<String, Object>> parentRows = new List<Map<String, Object>>();
        List<SObject> records = new List<SObject>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> own = new Map<String, Object>();
            Map<String, Object> parent = new Map<String, Object>();
            for (String key : row.keySet()) {
                if (key != 'Id' && GridPaths.isPath(key)) {
                    parent.put(key, row.get(key));
                } else {
                    own.put(key, row.get(key));
                }
            }
            if (!parent.isEmpty()) {
                parent.put('Id', row.get('Id'));
                parentRows.add(parent);
                if (own.size() <= 1) {
                    continue; // only parent fields changed: nothing to write on the row's own record
                }
            }
            SObject record = toRecord(own, objectType, allowed, rejected, ticket.errors);
            if (hasValues(record)) {
                records.add(record); // a row whose every field was refused has nothing to write
            }
        }
        Set<String> stripped = new Set<String>();
        ParentSave parents = parentEdits(objectType, parentRows, allowed, rejected, stripped, ticket.errors);
        ticket.rejectedFields.addAll(rejected);
        records = keepWholeTexts(records, objectType, ticket.errors);

        SObjectAccessDecision decision = GridSecurity.stripForUpdate(records);
        records = new List<SObject>();
        for (SObject record : decision.getRecords()) {
            if (hasValues(record)) {
                records.add(record); // one left with only its Id after stripping is not written
            }
        }
        for (Set<String> fields : decision.getRemovedFields().values()) {
            for (String f : fields) {
                stripped.add(GridDescribe.localName(GridDescribe.field(objectType, f))); // HR-4
            }
        }
        ticket.strippedFields.addAll(stripped);

        Integer cellBudget = audit == null ? null : GridEditLog.MAX_ENTRIES;
        List<List<SObject>> chunks = chunksOf(records, cellBudget);
        List<List<SObject>> parentChunks = new List<List<SObject>>();
        Integer parentCount = 0;
        for (List<SObject> holders : parents.records.values()) {
            parentChunks.addAll(chunksOf(holders, cellBudget));
            parentCount += holders.size();
        }
        Integer chunkCount = chunks.size() + parentChunks.size();
        Integer maxChunks = Limits.getLimitQueueableJobs() - Limits.getQueueableJobs();
        if (chunkCount > maxChunks) {
            throw new GridException(
                'One save can include at most ' +
                    (maxChunks * CHUNK_SIZE) +
                    ' records' +
                    (audit == null ? '' : ', fewer when many fields change in a grid that logs its changes') +
                    '; this one has ' +
                    (records.size() + parentCount) +
                    '. Save in smaller batches.'
            );
        }
        ticket.saveId = newSaveId();
        ticket.chunkCount = chunkCount;
        ticket.done = chunkCount == 0;
        if (audit != null) {
            audit.saveId = ticket.saveId; // a save's log entries carry the save's own Id
        }
        for (Integer i = 0; i < chunks.size(); i++) {
            System.enqueueJob(new GridSaveChunk(ticket.saveId, i, chunkCount, chunks[i], audit));
        }
        for (Integer j = 0; j < parentChunks.size(); j++) {
            List<SObject> chunk = parentChunks[j];
            Map<Id, List<List<String>>> reportAs = new Map<Id, List<List<String>>>();
            for (SObject holder : chunk) {
                reportAs.put(holder.Id, parents.reportAs.get(holder.Id));
            }
            System.enqueueJob(
                new GridSaveChunk(
                    ticket.saveId,
                    chunks.size() + j,
                    chunkCount,
                    chunk,
                    auditFor(audit, chunk[0].getSObjectType()),
                    reportAs
                )
            );
        }
        return ticket;
    }

    // ---------------------------------------------------- parent records

    /** What a save writes on parent records: the records by object, and the row cells each one answers for. */
    private class ParentSave {
        Map<Schema.SObjectType, List<SObject>> records = new Map<Schema.SObjectType, List<SObject>>();
        /** Parent record Id to the row cells whose edits it carries: [row Id, column]. */
        Map<Id, List<List<String>>> reportAs = new Map<Id, List<List<String>>>();
    }

    /** Why a parent field was not written: two rows gave it different values. */
    public static final String CONFLICT_MESSAGE = 'Another row changes this field on the same record to a different value. Make them match, then save again.';

    /**
     * The parent records to write for the edits on parent-record columns
     * (GridPaths). Each column must be an editable column of this grid
     * (HR-6, else `rejected`) that this user may edit through every record on
     * the way (GridSecurity.canEditPath, else `stripped`). The rows are read
     * in user mode to find each one's parent record; a row whose lookup is
     * blank cannot change its parent's field. Values are converted and
     * checked as on the row's own fields. Problems go to `errors` against
     * the row and column the user edited.
     */
    private static ParentSave parentEdits(
        Schema.SObjectType objectType,
        List<Map<String, Object>> rows,
        Set<String> allowed,
        Set<String> rejected,
        Set<String> stripped,
        List<GridSaveError> errors
    ) {
        ParentSave out = new ParentSave();
        if (rows.isEmpty()) {
            return out;
        }
        // Which columns may be written, each resolved once.
        Map<String, GridPaths.FieldPath> usable = new Map<String, GridPaths.FieldPath>();
        Set<String> refused = new Set<String>();
        Map<Id, Map<String, Object>> edits = new Map<Id, Map<String, Object>>();
        for (Map<String, Object> row : rows) {
            Id rowId = rowIdOf(row, objectType, errors);
            if (rowId == null) {
                continue;
            }
            for (String key : row.keySet()) {
                if (key == 'Id' || refused.contains(key)) {
                    continue;
                }
                if (!usable.containsKey(key)) {
                    GridPaths.FieldPath fp = writablePath(objectType, key, allowed, rejected, stripped);
                    if (fp == null) {
                        refused.add(key);
                        continue;
                    }
                    usable.put(key, fp);
                }
                if (!edits.containsKey(rowId)) {
                    edits.put(rowId, new Map<String, Object>());
                }
                edits.get(rowId).put(key, row.get(key));
            }
        }
        if (edits.isEmpty()) {
            return out;
        }

        // Where each row's parent records are. Field names from describe; the Ids are bound.
        Set<String> holderFields = new Set<String>{ 'Id' };
        for (GridPaths.FieldPath fp : usable.values()) {
            holderFields.add(fp.holderIdSoql);
        }
        Set<Id> rowIds = edits.keySet();
        Map<Id, SObject> found = new Map<Id, SObject>(
            GridSecurity.query(
                'SELECT ' +
                    String.join(new List<String>(holderFields), ', ') +
                    ' FROM ' +
                    GridDescribe.apiName(objectType) +
                    ' WHERE Id IN :rowIds',
                new Map<String, Object>{ 'rowIds' => rowIds }
            )
        );

        // The value each parent field gets, and the cells that set it.
        Map<String, Object> values = new Map<String, Object>();
        Map<String, Schema.SObjectField> fields = new Map<String, Schema.SObjectField>();
        Map<String, Id> holderOf = new Map<String, Id>();
        Map<String, List<List<String>>> cellsOf = new Map<String, List<List<String>>>();
        Set<String> conflicted = new Set<String>();
        for (Id rowId : edits.keySet()) {
            SObject row = found.get(rowId);
            for (String key : edits.get(rowId).keySet()) {
                GridPaths.FieldPath fp = usable.get(key);
                if (row == null) {
                    errors.add(new GridSaveError(rowId, fp.local, NOT_AVAILABLE_MESSAGE));
                    continue;
                }
                Id holderId = GridPaths.holderIdAt(row, fp);
                if (holderId == null) {
                    errors.add(new GridSaveError(rowId, fp.local, noParentMessage(fp)));
                    continue;
                }
                Object value;
                try {
                    value = coerce(fp.field, edits.get(rowId).get(key));
                } catch (Exception e) {
                    errors.add(new GridSaveError(rowId, fp.local, 'Invalid value: ' + e.getMessage()));
                    continue;
                }
                if (isBlank(value) && isRequired(fp.field)) {
                    errors.add(new GridSaveError(rowId, fp.local, REQUIRED_MESSAGE));
                    continue;
                }
                // Keyed by the parent record and its field, so two columns that
                // reach the same field by different lookups agree too.
                String slot = holderId + '.' + GridDescribe.apiName(fp.field);
                if (!cellsOf.containsKey(slot)) {
                    cellsOf.put(slot, new List<List<String>>());
                    values.put(slot, value);
                    fields.put(slot, fp.field);
                    holderOf.put(slot, holderId);
                } else if (!sameValue(values.get(slot), value)) {
                    conflicted.add(slot);
                }
                cellsOf.get(slot).add(new List<String>{ rowId, fp.local });
            }
        }

        // One record per parent, with every field the rows set on it.
        Map<Id, SObject> holders = new Map<Id, SObject>();
        for (String slot : cellsOf.keySet()) {
            if (conflicted.contains(slot)) {
                for (List<String> cell : cellsOf.get(slot)) {
                    errors.add(new GridSaveError(Id.valueOf(cell[0]), cell[1], CONFLICT_MESSAGE));
                }
                continue;
            }
            Id holderId = holderOf.get(slot);
            if (!holders.containsKey(holderId)) {
                holders.put(holderId, holderId.getSObjectType().newSObject(holderId));
                out.reportAs.put(holderId, new List<List<String>>());
            }
            holders.get(holderId).put(fields.get(slot), values.get(slot));
            out.reportAs.get(holderId).addAll(cellsOf.get(slot));
        }

        Map<Schema.SObjectType, List<SObject>> byType = new Map<Schema.SObjectType, List<SObject>>();
        for (SObject holder : holders.values()) {
            Schema.SObjectType t = holder.getSObjectType();
            if (!byType.containsKey(t)) {
                byType.put(t, new List<SObject>());
            }
            byType.get(t).add(holder);
        }
        for (Schema.SObjectType t : byType.keySet()) {
            // A shortened copy of a long text is never written back (as on the row's own fields).
            List<GridSaveError> textErrors = new List<GridSaveError>();
            List<SObject> kept = keepWholeTexts(byType.get(t), t, textErrors);
            for (GridSaveError e : textErrors) {
                for (List<String> cell : cellsFor(out.reportAs.get(e.recordId), e.fieldName)) {
                    errors.add(new GridSaveError(Id.valueOf(cell[0]), cell[1], e.message));
                }
            }
            SObjectAccessDecision decision = GridSecurity.stripForUpdate(kept);
            Map<Integer, Set<String>> removed = decision.getRemovedFields().isEmpty()
                ? new Map<Integer, Set<String>>()
                : indexRemoved(kept, decision);
            List<SObject> writable = new List<SObject>();
            List<SObject> checked = decision.getRecords();
            for (Integer i = 0; i < checked.size(); i++) {
                Id holderId = kept[i].Id;
                for (String f : removed.containsKey(i) ? removed.get(i) : new Set<String>()) {
                    String local = GridDescribe.localName(GridDescribe.field(t, f));
                    for (List<String> cell : cellsFor(out.reportAs.get(holderId), local)) {
                        stripped.add(cell[1]);
                    }
                }
                SObject holder = checked[i];
                holder.Id = holderId;
                if (holder.getPopulatedFieldsAsMap().size() > 1) {
                    writable.add(holder);
                }
            }
            if (!writable.isEmpty()) {
                out.records.put(t, writable);
            }
        }
        return out;
    }

    /** The removed fields of each record, by its place in `records`. */
    private static Map<Integer, Set<String>> indexRemoved(List<SObject> records, SObjectAccessDecision decision) {
        Map<Integer, Set<String>> out = new Map<Integer, Set<String>>();
        Set<String> removed = new Set<String>();
        for (Set<String> fields : decision.getRemovedFields().values()) {
            removed.addAll(fields);
        }
        for (Integer i = 0; i < records.size(); i++) {
            Set<String> mine = new Set<String>();
            for (String f : records[i].getPopulatedFieldsAsMap().keySet()) {
                if (removed.contains(f)) {
                    mine.add(f);
                }
            }
            if (!mine.isEmpty()) {
                out.put(i, mine);
            }
        }
        return out;
    }

    /**
     * The path a column names, when this grid lets it be written: an editable
     * column (HR-6, else its name goes to `rejected`) the user may edit through
     * every record on the way (else to `stripped`). Null when it may not.
     */
    private static GridPaths.FieldPath writablePath(
        Schema.SObjectType objectType,
        String key,
        Set<String> allowed,
        Set<String> rejected,
        Set<String> stripped
    ) {
        GridPaths.FieldPath fp;
        try {
            fp = GridPaths.resolve(objectType, key);
        } catch (GridException e) {
            rejected.add(key);
            return null;
        }
        if (!allowed.contains(fp.local.toLowerCase())) {
            rejected.add(fp.local); // HR-6: not an editable column of this grid
            return null;
        }
        if (!GridSecurity.canEditPath(fp)) {
            stripped.add(fp.local);
            return null;
        }
        return fp;
    }

    /** A row's Id, when it is a record of the grid's object; otherwise the problem goes to `errors`. */
    private static Id rowIdOf(Map<String, Object> row, Schema.SObjectType objectType, List<GridSaveError> errors) {
        Id rowId;
        try {
            rowId = (Id) String.valueOf(row.get('Id'));
        } catch (Exception e) {
            errors.add(new GridSaveError(null, null, 'Not a record Id: ' + row.get('Id')));
            return null;
        }
        if (rowId == null || rowId.getSObjectType() != objectType) {
            errors.add(
                new GridSaveError(
                    rowId,
                    null,
                    'Record ' + rowId + ' is not a ' + GridDescribe.localName(objectType) + '.'
                )
            );
            return null;
        }
        return rowId;
    }

    /** Why a row could not be read to find its parent record. */
    public static final String NOT_AVAILABLE_MESSAGE = 'This record was deleted, or you no longer have access to it.';

    /** Why a row whose lookup is blank cannot change its parent's field: "This record has no Account, so Industry can't be changed." */
    private static String noParentMessage(GridPaths.FieldPath fp) {
        Schema.SObjectField lookup = fp.hops[fp.hops.size() - 1];
        return 'This record has no ' +
            GridConfig.defaultLabel(lookup.getDescribe()) +
            ', so ' +
            GridConfig.defaultLabel(fp.field.getDescribe()) +
            ' can\'t be changed.';
    }

    /** The cells among `cells` whose column ends in the field `local`. */
    private static List<List<String>> cellsFor(List<List<String>> cells, String local) {
        List<List<String>> out = new List<List<String>>();
        if (cells == null) {
            return out;
        }
        for (List<String> cell : cells) {
            if (local == null || cell[1].substringAfterLast('.').equalsIgnoreCase(local)) {
                out.add(cell);
            }
        }
        return out;
    }

    /** Equal values; text compared exactly, since Apex compares strings ignoring case. */
    private static Boolean sameValue(Object a, Object b) {
        if (a == null || b == null) {
            return a == null && b == null;
        }
        if (a instanceof String && b instanceof String) {
            return ((String) a).equals((String) b);
        }
        return a == b;
    }

    /** The log context for a chunk of parent records: the same save, their own object. */
    private static GridEditLog.Context auditFor(GridEditLog.Context audit, Schema.SObjectType objectType) {
        if (audit == null) {
            return null;
        }
        GridEditLog.Context ctx = new GridEditLog.Context();
        ctx.configName = audit.configName;
        ctx.objectName = GridDescribe.apiName(objectType);
        ctx.saveId = audit.saveId;
        return ctx;
    }

    /**
     * The records in chunks of at most CHUNK_SIZE, in order. With a
     * `cellBudget` (a grid that logs its changes), a chunk also holds at
     * most that many changed fields, so its log entries fit its transaction;
     * a single record is never split.
     */
    @TestVisible
    private static List<List<SObject>> chunksOf(List<SObject> records, Integer cellBudget) {
        List<List<SObject>> out = new List<List<SObject>>();
        List<SObject> chunk = new List<SObject>();
        Integer cells = 0;
        for (SObject r : records) {
            Integer n = cellBudget == null ? 0 : GridEditLog.cellsOf(r);
            if (!chunk.isEmpty() && (chunk.size() >= CHUNK_SIZE || (cellBudget != null && cells + n > cellBudget))) {
                out.add(chunk);
                chunk = new List<SObject>();
                cells = 0;
            }
            chunk.add(r);
            cells += n;
        }
        if (!chunk.isEmpty()) {
            out.add(chunk);
        }
        return out;
    }

    /**
     * Collect the chunk results for one save. When every chunk has reported,
     * the bookkeeping rows are deleted: they exist only to carry the answer.
     */
    public static GridSaveResult status(String saveId) {
        GridSaveResult result = new GridSaveResult();
        result.saveId = saveId;
        if (String.isBlank(saveId)) {
            return result;
        }
        List<Grid_Save_Result__c> reports = (List<Grid_Save_Result__c>) GridSecurity.query(
            'SELECT Id, Chunk_Index__c, Chunk_Count__c, Success_Count__c, Errors_JSON__c ' +
            'FROM Grid_Save_Result__c WHERE Save_Id__c = :saveId AND OwnerId = :ownerId',
            new Map<String, Object>{ 'saveId' => saveId, 'ownerId' => UserInfo.getUserId() }
        );
        Set<Integer> seen = new Set<Integer>();
        for (Grid_Save_Result__c r : reports) {
            result.chunkCount = r.Chunk_Count__c.intValue();
            if (!seen.add(r.Chunk_Index__c.intValue())) {
                continue;
            }
            result.successCount += r.Success_Count__c == null ? 0 : r.Success_Count__c.intValue();
            if (String.isNotBlank(r.Errors_JSON__c)) {
                result.errors.addAll(
                    (List<GridSaveError>) JSON.deserialize(r.Errors_JSON__c, List<GridSaveError>.class)
                );
            }
        }
        result.chunksReported = seen.size();
        result.done = result.chunkCount > 0 && result.chunksReported >= result.chunkCount;
        if (result.done) {
            GridSecurity.deleteOwnRecords(reports);
        }
        return result;
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Does the record carry a value to write, beyond its Id? An update with
     * none would still run the org's triggers and flows and stamp Last
     * Modified, while changing nothing the user asked for.
     */
    private static Boolean hasValues(SObject record) {
        return record != null && record.getPopulatedFieldsAsMap().size() > 1;
    }

    private static SObject toRecord(
        Map<String, Object> row,
        Schema.SObjectType objectType,
        Set<String> allowed,
        Set<String> rejected,
        List<GridSaveError> errors
    ) {
        Id recordId;
        try {
            recordId = (Id) String.valueOf(row.get('Id'));
        } catch (Exception e) {
            errors.add(new GridSaveError(null, null, 'Not a record Id: ' + row.get('Id')));
            return null;
        }
        if (recordId == null || recordId.getSObjectType() != objectType) {
            errors.add(
                new GridSaveError(
                    recordId,
                    null,
                    'Record ' + recordId + ' is not a ' + GridDescribe.localName(objectType) + '.'
                )
            );
            return null;
        }
        SObject record = objectType.newSObject(recordId);
        return fillFields(record, row, objectType, allowed, rejected, errors, recordId) ? record : null;
    }

    /**
     * Put a row's values on a record by the rules every write follows: only
     * fields in `allowed` (HR-6; the rest are named in `rejected`), each value
     * converted by its field's type, a blank required field refused. Problems
     * go to `errors`, against `recordId` (null for a new record). Returns false
     * when any value was refused. Shared by the save and the import.
     */
    public static Boolean fillFields(
        SObject record,
        Map<String, Object> row,
        Schema.SObjectType objectType,
        Set<String> allowed,
        Set<String> rejected,
        List<GridSaveError> errors,
        Id recordId
    ) {
        Boolean valid = true;
        for (String key : row.keySet()) {
            if (key == 'Id') {
                continue;
            }
            Schema.SObjectField field;
            try {
                field = GridDescribe.field(objectType, key);
            } catch (GridException e) {
                rejected.add(key);
                continue;
            }
            String local = GridDescribe.localName(field);
            if (!allowed.contains(local.toLowerCase())) {
                rejected.add(local); // HR-6: not an editable column of this grid
                continue;
            }
            Object value;
            try {
                value = coerce(field, row.get(key));
            } catch (Exception e) {
                errors.add(new GridSaveError(recordId, local, 'Invalid value: ' + e.getMessage()));
                valid = false;
                continue;
            }
            // The platform does not always refuse a blank required field: a blank
            // Name on update is silently replaced with the record Id (seen in a
            // Developer Edition org). Lightning's own inline edit refuses it, and
            // so does the grid.
            if (isBlank(value) && isRequired(field)) {
                errors.add(new GridSaveError(recordId, local, REQUIRED_MESSAGE));
                valid = false;
                continue;
            }
            record.put(field, value);
        }
        return valid;
    }

    // ------------------------------------------------- shortened long texts

    /** Why a shortened copy of a long text is not saved. */
    public static final String SHORTENED_MESSAGE =
        'This is the shortened copy the grid shows of a longer text' +
        ' (its first 1,000 characters and "…"). Saving it would cut the rest, so it was not saved.' +
        ' Edit the text in the grid, which opens the whole of it.';

    /**
     * A long text the grid shows shortened (TC-055: its first
     * GridController.LONG_TEXT_PREVIEW characters and "…") is never written
     * back as if it were the whole text. A file exported and imported again,
     * or a shortened cell copied and pasted, would otherwise cut every such
     * text. For each value in that form, the stored text
     * is read (user mode): when the value is its unchanged shortened copy the
     * field is left out of the write; when it was changed, the record is
     * refused with SHORTENED_MESSAGE in `errors`, since what came after the
     * first 1,000 characters is not in it. A value of that form over a text
     * that is not longer is the user's own, and is written. Returns the
     * records to write. Shared by the save and the import.
     */
    public static List<SObject> keepWholeTexts(
        List<SObject> records,
        Schema.SObjectType objectType,
        List<GridSaveError> errors
    ) {
        Map<Id, SObject> stored = storedLongTexts(records, objectType);
        if (stored.isEmpty()) {
            return records;
        }
        List<SObject> out = new List<SObject>();
        for (SObject record : records) {
            SObject kept = withoutShortenedCopies(record, stored.get(record.Id), objectType, errors);
            if (kept != null) {
                out.add(kept);
            }
        }
        return out;
    }

    /** The stored long texts of the records that carry a value in the shortened form; empty when none does. */
    @TestVisible
    private static Map<Id, SObject> storedLongTexts(List<SObject> records, Schema.SObjectType objectType) {
        Set<Id> ids = new Set<Id>();
        Set<String> fields = new Set<String>();
        for (SObject record : records) {
            if (record.Id == null) {
                continue;
            }
            Map<String, Object> values = record.getPopulatedFieldsAsMap();
            for (String api : values.keySet()) {
                if (api != 'Id' && looksShortened(values.get(api)) && isLongText(GridDescribe.field(objectType, api))) {
                    ids.add(record.Id);
                    fields.add(GridDescribe.apiName(GridDescribe.field(objectType, api)));
                }
            }
        }
        if (ids.isEmpty()) {
            return new Map<Id, SObject>();
        }
        // Field names from describe, never from the request; the Ids are bound.
        String soql =
            'SELECT Id, ' +
            String.join(new List<String>(fields), ', ') +
            ' FROM ' +
            GridDescribe.apiName(objectType) +
            ' WHERE Id IN :ids';
        return new Map<Id, SObject>(GridSecurity.query(soql, new Map<String, Object>{ 'ids' => ids }));
    }

    /**
     * The record to write: itself, a copy without its unchanged shortened
     * copies, or null when a shortened copy was changed (the error is added).
     */
    private static SObject withoutShortenedCopies(
        SObject record,
        SObject before,
        Schema.SObjectType objectType,
        List<GridSaveError> errors
    ) {
        if (before == null) {
            return record;
        }
        Map<String, Object> values = record.getPopulatedFieldsAsMap();
        Map<String, Object> was = before.getPopulatedFieldsAsMap();
        Set<String> unchanged = new Set<String>();
        Boolean refused = false;
        for (String api : values.keySet()) {
            if (api == 'Id' || !looksShortened(values.get(api)) || !(was.get(api) instanceof String)) {
                continue;
            }
            String whole = (String) was.get(api);
            if (whole.length() <= GridController.LONG_TEXT_PREVIEW) {
                continue; // the stored text is not longer: the value is the user's own
            }
            if (whole.startsWith(((String) values.get(api)).left(GridController.LONG_TEXT_PREVIEW))) {
                unchanged.add(api);
            } else {
                errors.add(
                    new GridSaveError(
                        record.Id,
                        GridDescribe.localName(GridDescribe.field(objectType, api)),
                        SHORTENED_MESSAGE
                    )
                );
                refused = true;
            }
        }
        if (refused) {
            return null;
        }
        if (unchanged.isEmpty()) {
            return record;
        }
        SObject copy = objectType.newSObject(record.Id);
        for (String api : values.keySet()) {
            if (api != 'Id' && !unchanged.contains(api)) {
                copy.put(api, values.get(api));
            }
        }
        return copy;
    }

    /** The form the grid shortens a long text to: exactly LONG_TEXT_PREVIEW characters and "…". */
    private static Boolean looksShortened(Object value) {
        return value instanceof String &&
            ((String) value).length() == GridController.LONG_TEXT_PREVIEW + 1 &&
            ((String) value).endsWith('…');
    }

    /** A text area the grid shows shortened, as GridController decides. */
    private static Boolean isLongText(Schema.SObjectField field) {
        Schema.DescribeFieldResult d = field.getDescribe();
        return d.getType() == Schema.DisplayType.TEXTAREA && d.getLength() > 255;
    }

    private static Boolean isRequired(Schema.SObjectField field) {
        return GridDescribe.isRequired(field.getDescribe());
    }

    private static Boolean isBlank(Object value) {
        return value == null || (value instanceof String && String.isBlank((String) value));
    }

    /**
     * Convert a JSON value to the field's Apex type. Numbers go through their
     * string form, so an 18-digit value sent as a string stays exact (TC-024).
     * A number with more decimals than the field allows is rounded to the
     * field's scale, half up (TC-023): the platform stores extra decimals it is
     * given through Apex or the API, but the grid shows them rounded, and what
     * is saved must be what was shown. RoundingMode.HALF_UP, not setScale's
     * default: that is HALF_EVEN, which turns 2.5 into 2 (seen in a Developer Edition org).
     * Text is never trimmed (TC-005).
     */
    @TestVisible
    private static Object coerce(Schema.SObjectField field, Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value);
        switch on field.getDescribe().getType() {
            when DOUBLE, CURRENCY, PERCENT {
                if (String.isBlank(text)) {
                    return null;
                }
                Decimal amount = Decimal.valueOf(text.replace(',', ''));
                Integer scale = field.getDescribe().getScale();
                return amount.scale() > scale ? amount.setScale(scale, System.RoundingMode.HALF_UP) : amount;
            }
            when INTEGER {
                return String.isBlank(text) ? null : Integer.valueOf(text);
            }
            when LONG {
                return String.isBlank(text) ? null : Long.valueOf(text);
            }
            when BOOLEAN {
                // TC-042: a checkbox is never null.
                return value instanceof Boolean ? (Boolean) value : 'true'.equalsIgnoreCase(text);
            }
            when DATE {
                return String.isBlank(text) ? null : Date.valueOf(text);
            }
            when DATETIME {
                return String.isBlank(text) ? null : (Datetime) JSON.deserialize('"' + text + '"', Datetime.class);
            }
            when TIME {
                // 17:30, 17:30:15 or 17:30:15.000Z, as the time editor and Salesforce send it.
                return String.isBlank(text) ? null : timeOf(text);
            }
            when REFERENCE {
                // A lookup or owner holds a record Id of one of its target objects.
                // Whether the user may point it there (sharing, ownership
                // transfer) is the platform's user-mode check, reported per row.
                if (String.isBlank(text)) {
                    return null;
                }
                Id ref = Id.valueOf(text);
                if (!field.getDescribe().getReferenceTo().contains(ref.getSObjectType())) {
                    throw new GridException(
                        text + ' is not a ' + String.join(GridDescribe.referenceTargets(field), ' or ') + ' record.'
                    );
                }
                return ref;
            }
            when else {
                return text;
            }
        }
    }

    private static final Pattern TIME_VALUE = Pattern.compile(
        '^(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?Z?$'
    );

    /** A time of day, HH:MM with optional seconds and milliseconds. */
    @TestVisible
    private static Time timeOf(String text) {
        Matcher m = TIME_VALUE.matcher(text.trim());
        if (!m.matches()) {
            throw new GridException(text + ' is not a time. Write it as 17:30.');
        }
        Integer h = Integer.valueOf(m.group(1));
        Integer mi = Integer.valueOf(m.group(2));
        Integer sec = m.group(3) == null ? 0 : Integer.valueOf(m.group(3));
        Integer ms = m.group(4) == null ? 0 : Integer.valueOf(m.group(4).rightPad(3, '0'));
        if (h > 23 || mi > 59 || sec > 59) {
            throw new GridException(text + ' is not a time of day.');
        }
        return Time.newInstance(h, mi, sec, ms);
    }

    private static String newSaveId() {
        return EncodingUtil.convertToHex(Crypto.generateAesKey(128));
    }
}
