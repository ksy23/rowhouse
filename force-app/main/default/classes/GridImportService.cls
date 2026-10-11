/**
 * GridImportService — writes one batch of an imported CSV or Excel file.
 *
 * The browser reads the file, shows the user a preview, and sends the rows in
 * batches of at most 200, one call per batch, so each batch is one transaction
 * with its own limits. A row with an Id updates that record; a row without one
 * creates a record.
 *
 * Nothing about the request is trusted (HR-6):
 *   the configuration must allow import and inline edit (read here); a grid
 *   that does not allow new records allows no import (GridConfig);
 *   only the grid's editable columns are written, through the same field
 *   rules as a save (GridSaveService.fillFields); any other field is refused
 *   and named in `rejectedFields`;
 *   field-level security then removes what the user may not write: on an
 *   update, what they cannot edit; on a new record, what they cannot set on
 *   create. Both are named in `strippedFields`;
 *   the user must have edit permission for updates and create permission for
 *   new records, checked before anything is written;
 *   an Id of another object, or one sent twice, is a row error.
 * Then one partial update and one partial insert, both in user mode: a row
 * that fails (sharing, a validation rule, a trigger, a required field the
 * file leaves out) fails alone and says why.
 *
 * In a child grid a new row is created under the grid's parent: the
 * relationship field is set on it unless the file sets it. The field comes from
 * GridNesting.scopeFor, not from the browser, and the user must be allowed to
 * set it on create, or the batch creates nothing.
 *
 * MATCHING AND UNDOING
 * A batch may match records by an External Id column of the grid instead of
 * the record Id: a row whose value matches one record updates it, a row
 * whose value matches none creates one, and a value that matches two
 * records is a row error. The matching is a query in user mode, so only
 * records the user can see are matched. Each update says what the fields
 * held before (`previous`), so the browser can put them back: Undo import
 * writes those values back through this same path, and deletes the records
 * the import created through undoCreates, which deletes only records the
 * user created in the last day.
 *
 * In a grid that logs its changes the user must be able to write the
 * log before anything is written; each field an update changes is logged, and
 * each record created, in this same transaction, all or nothing. A batch that
 * would log more than GridAudit.MAX_ENTRIES entries is refused whole; the
 * browser sizes its batches so none does.
 */
public with sharing class GridImportService {
    /** One DML statement's worth, as for a save chunk. */
    public static final Integer MAX_ROWS = 200;

    /** What happened to one row, by its position in the batch. */
    public class RowResult {
        @AuraEnabled
        public Integer index;
        /** The record updated, or the one created. */
        @AuraEnabled
        public Id recordId;
        @AuraEnabled
        public Boolean created = false;
        @AuraEnabled
        public Boolean success = false;
        /** Set when one field is at fault. */
        @AuraEnabled
        public String fieldName;
        @AuraEnabled
        public String message;
        /** An update's fields as they were before it, for Undo import; null for a new record. */
        @AuraEnabled
        public Map<String, Object> previous;
    }

    /** Records undoCreates deletes at most in one call: one DML statement's worth. */
    public static final Integer MAX_UNDO = 200;

    public class Result {
        @AuraEnabled
        public List<RowResult> rows = new List<RowResult>();
        /** Fields not written because they are not editable columns of this grid. */
        @AuraEnabled
        public List<String> rejectedFields = new List<String>();
        /** Fields not written because of field-level security. */
        @AuraEnabled
        public List<String> strippedFields = new List<String>();
    }

    public static Result importRows(String configName, List<Map<String, Object>> rows) {
        return importRows(configName, rows, null, null);
    }

    /** The same, in a child grid: new rows are created under the parent. */
    public static Result importRows(
        String configName,
        List<Map<String, Object>> rows,
        String parentLink,
        String parentId
    ) {
        return importRows(configName, rows, parentLink, parentId, null);
    }

    /**
     * The same, on a record page: new rows are created with the
     * configuration's Record Page Field pointing to the page's record.
     */
    public static Result importRows(
        String configName,
        List<Map<String, Object>> rows,
        String parentLink,
        String parentId,
        String pageRecordId
    ) {
        return importRows(configName, rows, parentLink, parentId, pageRecordId, null);
    }

    /**
     * The same, matching records by an External Id column of the grid
     * (matchField) instead of the record Id.
     */
    public static Result importRows(
        String configName,
        List<Map<String, Object>> rows,
        String parentLink,
        String parentId,
        String pageRecordId,
        String matchField
    ) {
        Result result = new Result();
        if (rows == null || rows.isEmpty()) {
            return result; // nothing asked, no DML
        }
        GridConfig.Definition def = GridConfig.load(configName);
        if (def.allowImport != true || def.allowInlineEdit != true) {
            throw new GridException('This grid does not allow importing records.');
        }
        GridNesting.Scope scope = GridNesting.scopeFor(def, parentLink, parentId);
        if (scope == null) {
            scope = GridFilters.recordScope(def, pageRecordId);
        }
        if (rows.size() > MAX_ROWS) {
            throw new GridException(
                'Import at most ' + MAX_ROWS + ' rows at a time; this request has ' + rows.size() + '.'
            );
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        Set<String> allowed = def.editableFields();
        Set<String> rejected = new Set<String>();
        Set<Id> seen = new Set<Id>();
        Schema.SObjectField match = matchFieldOf(def, objectType, matchField);
        String matchKey = match == null ? null : GridDescribe.localName(match);
        Map<String, List<Id>> matched = match == null ? null : idsByKey(rows, match, matchKey, objectType);
        Map<String, Integer> keysSeen = new Map<String, Integer>();
        List<SObject> updates = new List<SObject>();
        List<RowResult> updated = new List<RowResult>();
        List<SObject> inserts = new List<SObject>();
        List<RowResult> created = new List<RowResult>();

        for (Integer i = 0; i < rows.size(); i++) {
            Map<String, Object> row = rows[i] == null ? new Map<String, Object>() : rows[i];
            RowResult r = new RowResult();
            r.index = i;
            result.rows.add(r);
            String rawId = row.get('Id') == null ? '' : String.valueOf(row.get('Id')).trim();
            if (match != null) {
                // Matched by an External Id: the record Id is the match's, never the file's.
                String key = keyOf(valueIn(row, matchKey));
                rawId = '';
                if (key != null) {
                    if (keysSeen.containsKey(key)) {
                        r.message = String.valueOf(valueIn(row, matchKey)) + ' is in the file more than once.';
                        continue;
                    }
                    keysSeen.put(key, i);
                    List<Id> found = matched.get(key);
                    if (found != null && found.size() > 1) {
                        r.message =
                            'More than one record has ' +
                            String.valueOf(valueIn(row, matchKey)) +
                            ' as its ' +
                            match.getDescribe().getLabel() +
                            '.';
                        continue;
                    }
                    if (found != null) {
                        rawId = String.valueOf(found[0]);
                    }
                }
            }
            SObject record;
            if (String.isBlank(rawId)) {
                r.created = true;
                record = objectType.newSObject();
            } else {
                Id recordId;
                try {
                    recordId = Id.valueOf(rawId);
                } catch (Exception e) {
                    r.message = 'Not a record Id: ' + rawId;
                    continue;
                }
                if (recordId.getSObjectType() != objectType) {
                    r.message = 'Record ' + rawId + ' is not a ' + GridDescribe.localName(objectType) + '.';
                    continue;
                }
                if (!seen.add(recordId)) {
                    r.message = 'Record ' + rawId + ' is in the file more than once.';
                    continue;
                }
                r.recordId = recordId;
                record = objectType.newSObject(recordId);
            }
            List<GridSaveError> problems = new List<GridSaveError>();
            if (!GridSaveService.fillFields(record, row, objectType, allowed, rejected, problems, r.recordId)) {
                r.fieldName = problems[0].fieldName;
                List<String> messages = new List<String>();
                for (GridSaveError p : problems) {
                    messages.add(p.fieldName == null ? p.message : p.fieldName + ': ' + p.message);
                }
                r.message = String.join(messages, ' ');
                continue;
            }
            if (r.created) {
                if (scope != null && record.get(scope.field) == null) {
                    record.put(scope.field, scope.parentId);
                }
                inserts.add(record);
                created.add(r);
            } else {
                updates.add(record);
                updated.add(r);
            }
        }
        result.rejectedFields.addAll(rejected);
        dropShortenedCopies(updates, updated, objectType);

        // Both permissions before any write, so a refused batch writes nothing.
        if (!updates.isEmpty()) {
            GridSecurity.requireUpdate(objectType);
        }
        if (!inserts.isEmpty()) {
            GridSecurity.requireCreate(objectType);
            if (scope != null && !GridSecurity.canSetOnCreate(scope.field)) {
                throw new GridException(
                    'You cannot set ' +
                        GridDescribe.localName(scope.field) +
                        ' on new records, so this grid cannot create them.'
                );
            }
        }
        GridAudit.Context audit = updates.isEmpty() && inserts.isEmpty() ? null : GridAudit.start(def); // throws if the user cannot log
        if (audit != null && cellsIn(updates) + inserts.size() > GridAudit.MAX_ENTRIES) {
            throw new GridException(
                'This batch would write more than ' +
                    GridAudit.MAX_ENTRIES +
                    ' log entries; import fewer rows or columns at a time. Nothing was imported.'
            );
        }
        Set<String> stripped = new Set<String>();
        List<Grid_Edit_Log__c> entries = new List<Grid_Edit_Log__c>();
        if (!updates.isEmpty()) {
            SObjectAccessDecision decision = GridSecurity.stripForUpdate(updates);
            collectRemoved(decision, objectType, stripped);
            List<SObject> writing = decision.getRecords();
            // What the fields held, for the log and for Undo import.
            Map<Id, SObject> before = GridAudit.before(objectType, writing);
            List<Database.SaveResult> outcomes = GridSecurity.updateRecords(writing);
            apply(outcomes, updated, objectType);
            keepPrevious(writing, updated, before);
            entries.addAll(GridAudit.updates(audit, objectType, writing, outcomes, audit == null ? null : before));
        }
        if (!inserts.isEmpty()) {
            SObjectAccessDecision decision = GridSecurity.stripForCreate(inserts);
            collectRemoved(decision, objectType, stripped);
            List<SObject> writing = decision.getRecords();
            List<Database.SaveResult> outcomes = GridSecurity.insertRecords(writing);
            apply(outcomes, created, objectType);
            entries.addAll(GridAudit.creates(audit, objectType, writing, outcomes));
        }
        GridAudit.write(entries); // one statement; throws, and undoes the batch, if the log cannot be written
        result.strippedFields.addAll(stripped);
        return result;
    }

    /**
     * A long text as the grid exported it, shortened (TC-055), never replaces
     * the whole text (GridSaveService.keepWholeTexts): an unchanged copy is
     * left out of the update, and a changed one fails its row. The two lists
     * are changed in place and stay in step.
     */
    private static void dropShortenedCopies(
        List<SObject> updates,
        List<RowResult> updated,
        Schema.SObjectType objectType
    ) {
        if (updates.isEmpty()) {
            return;
        }
        List<GridSaveError> problems = new List<GridSaveError>();
        // A copy: when nothing is in the shortened form, the same list comes back.
        List<SObject> kept = new List<SObject>(GridSaveService.keepWholeTexts(updates, objectType, problems));
        if (problems.isEmpty()) {
            updates.clear();
            updates.addAll(kept); // the same records, less their unchanged shortened copies
            return;
        }
        Map<Id, GridSaveError> refused = new Map<Id, GridSaveError>();
        for (GridSaveError p : problems) {
            if (!refused.containsKey(p.recordId)) {
                refused.put(p.recordId, p);
            }
        }
        Map<Id, SObject> keptById = new Map<Id, SObject>(kept);
        List<SObject> writing = new List<SObject>();
        List<RowResult> rows = new List<RowResult>();
        for (Integer i = 0; i < updates.size(); i++) {
            RowResult r = updated[i];
            GridSaveError p = refused.get(r.recordId);
            if (p != null) {
                r.fieldName = p.fieldName;
                r.message = p.fieldName + ': ' + p.message;
                continue;
            }
            writing.add(keptById.get(r.recordId));
            rows.add(r);
        }
        updates.clear();
        updates.addAll(writing);
        updated.clear();
        updated.addAll(rows);
    }

    // ------------------------------------------------------------- matching

    /** The External Id column to match by, checked against the grid; null when the request names none. */
    private static Schema.SObjectField matchFieldOf(
        GridConfig.Definition def,
        Schema.SObjectType objectType,
        String matchField
    ) {
        if (String.isBlank(matchField)) {
            return null;
        }
        for (GridConfig.Column c : def.columns) {
            if (c.isFormula != true && c.isChildTotal != true && c.field.equalsIgnoreCase(matchField.trim())) {
                Schema.SObjectField f = GridDescribe.field(objectType, c.field);
                if (c.adminEditable == true && f.getDescribe().isExternalId() && GridSecurity.canRead(f)) {
                    return f;
                }
                break;
            }
        }
        throw new GridException('Records cannot be matched by ' + matchField + ' in this grid.');
    }

    /** A row's value for a field, by its local name in any case. */
    private static Object valueIn(Map<String, Object> row, String localName) {
        for (String k : row.keySet()) {
            if (k != null && k.equalsIgnoreCase(localName)) {
                return row.get(k);
            }
        }
        return null;
    }

    /** A match value as a key: text without case or edge spaces, a number as written plainly; null for blank. */
    private static String keyOf(Object value) {
        if (value == null) {
            return null;
        }
        String text = value instanceof Decimal ? ((Decimal) value).toPlainString() : String.valueOf(value).trim();
        return String.isBlank(text) ? null : text.toLowerCase();
    }

    /** The records the batch's values match, in user mode: { key: [Ids] }, two Ids for a value two records share. */
    private static Map<String, List<Id>> idsByKey(
        List<Map<String, Object>> rows,
        Schema.SObjectField match,
        String matchKey,
        Schema.SObjectType objectType
    ) {
        Map<String, List<Id>> out = new Map<String, List<Id>>();
        Set<String> values = new Set<String>();
        for (Map<String, Object> row : rows) {
            Object v = row == null ? null : valueIn(row, matchKey);
            if (keyOf(v) != null) {
                values.add(v instanceof Decimal ? ((Decimal) v).toPlainString() : String.valueOf(v).trim());
            }
        }
        if (values.isEmpty()) {
            return out;
        }
        Schema.DisplayType t = match.getDescribe().getType();
        Boolean numeric =
            t == Schema.DisplayType.DOUBLE ||
            t == Schema.DisplayType.INTEGER ||
            t == Schema.DisplayType.LONG;
        Object bound = values;
        if (numeric) {
            List<Decimal> numbers = new List<Decimal>();
            for (String v : values) {
                try {
                    numbers.add(Decimal.valueOf(v));
                } catch (Exception e) {
                    // not a number: matches nothing, and the row's own check says why
                }
            }
            bound = numbers;
        }
        String api = GridDescribe.apiName(match);
        for (
            SObject r : GridSecurity.query(
                'SELECT Id, ' + api + ' FROM ' + GridDescribe.apiName(objectType) + ' WHERE ' + api + ' IN :keys',
                new Map<String, Object>{ 'keys' => bound }
            )
        ) {
            String key = keyOf(r.get(match));
            if (!out.containsKey(key)) {
                out.put(key, new List<Id>());
            }
            out.get(key).add(r.Id);
        }
        return out;
    }

    /** Each update's fields as they were, in the form the import takes them back. */
    private static void keepPrevious(List<SObject> writing, List<RowResult> rows, Map<Id, SObject> before) {
        for (Integer i = 0; i < writing.size(); i++) {
            RowResult r = rows[i];
            SObject old = before.get(writing[i].Id);
            if (r.success != true || old == null) {
                continue;
            }
            Map<String, Object> previous = new Map<String, Object>();
            for (String key : writing[i].getPopulatedFieldsAsMap().keySet()) {
                if (key == 'Id') {
                    continue;
                }
                Object value = old.get(key);
                String local = GridDescribe.localName(GridDescribe.field(writing[i].getSObjectType(), key)); // HR-4
                previous.put(
                    local,
                    value instanceof Decimal
                        ? (Object) ((Decimal) value).toPlainString()
                        : value instanceof Time ? (Object) timeText((Time) value) : value
                );
            }
            r.previous = previous;
        }
    }

    /** A Time as the grid's editors and the save path read it: "17:30:00.000Z". */
    private static String timeText(Time t) {
        return String.valueOf(t.hour()).leftPad(2, '0') +
            ':' +
            String.valueOf(t.minute()).leftPad(2, '0') +
            ':' +
            String.valueOf(t.second()).leftPad(2, '0') +
            '.' +
            String.valueOf(t.millisecond()).leftPad(3, '0') +
            'Z';
    }

    // ------------------------------------------------------------- undoing

    /**
     * Undo import, for the records an import created: they go to the Recycle
     * Bin. Only records of the grid's object that this user created in the
     * last day, in a grid that allows import, with delete permission: an undo
     * is for the import just made, never a way round Allow Mass Delete for
     * anyone else's records. A record that is not one of those is a row error.
     */
    public static GridDeleteService.Result undoCreates(String configName, List<Id> recordIds) {
        GridDeleteService.Result result = new GridDeleteService.Result();
        if (recordIds == null || recordIds.isEmpty()) {
            return result;
        }
        GridConfig.Definition def = GridConfig.load(configName);
        if (def.allowImport != true) {
            throw new GridException('This grid does not allow importing records.');
        }
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridSecurity.requireDelete(objectType);
        if (recordIds.size() > MAX_UNDO) {
            throw new GridException(
                'Undo at most ' + MAX_UNDO + ' records at a time; this request has ' + recordIds.size() + '.'
            );
        }
        Set<Id> asked = new Set<Id>();
        for (Id recordId : recordIds) {
            if (recordId == null || recordId.getSObjectType() != objectType) {
                throw new GridException(
                    'Record ' + recordId + ' is not a ' + GridDescribe.localName(objectType) + '. Nothing was deleted.'
                );
            }
            asked.add(recordId);
        }
        Map<String, Object> binds = new Map<String, Object>{
            'ids' => asked,
            'me' => UserInfo.getUserId(),
            'since' => System.now().addDays(-1)
        };
        Set<Id> mine = new Map<Id, SObject>(
                GridSecurity.query(
                    'SELECT Id FROM ' +
                        GridDescribe.apiName(objectType) +
                        ' WHERE Id IN :ids AND CreatedById = :me AND CreatedDate >= :since',
                    binds
                )
            )
            .keySet();
        List<Id> ids = new List<Id>();
        for (Id recordId : asked) {
            if (mine.contains(recordId)) {
                ids.add(recordId);
            } else {
                result.errors.add(
                    new GridSaveError(
                        recordId,
                        null,
                        'Not deleted: it is not a record you created in the last day, or it is already deleted.'
                    )
                );
            }
        }
        if (ids.isEmpty()) {
            return result;
        }
        GridAudit.Context audit = GridAudit.start(def);
        Map<Id, String> names = audit == null ? null : GridAudit.namesOf(objectType, ids);
        List<Database.DeleteResult> outcomes = GridSecurity.deleteRecords(objectType, ids);
        for (Integer i = 0; i < outcomes.size(); i++) {
            if (outcomes[i].isSuccess()) {
                result.deletedIds.add(ids[i]);
                continue;
            }
            List<String> messages = new List<String>();
            for (Database.Error e : outcomes[i].getErrors()) {
                messages.add(e.getMessage());
            }
            result.errors.add(new GridSaveError(ids[i], null, String.join(messages, ' ')));
        }
        GridAudit.write(GridAudit.deletes(audit, result.deletedIds, names));
        return result;
    }

    /** Changed cells an update batch could log: every field on every record but the Id. */
    private static Integer cellsIn(List<SObject> records) {
        Integer n = 0;
        for (SObject r : records) {
            n += GridAudit.cellsOf(r);
        }
        return n;
    }

    private static void collectRemoved(
        SObjectAccessDecision decision,
        Schema.SObjectType objectType,
        Set<String> names
    ) {
        for (Set<String> fields : decision.getRemovedFields().values()) {
            for (String f : fields) {
                names.add(GridDescribe.localName(GridDescribe.field(objectType, f))); // HR-4
            }
        }
    }

    /** One DML result per row, in the order the rows were written. */
    private static void apply(List<Database.SaveResult> outcomes, List<RowResult> rows, Schema.SObjectType objectType) {
        for (Integer i = 0; i < outcomes.size(); i++) {
            Database.SaveResult outcome = outcomes[i];
            RowResult r = rows[i];
            if (outcome.isSuccess()) {
                r.success = true;
                r.recordId = outcome.getId();
                continue;
            }
            List<String> messages = new List<String>();
            for (Database.Error e : outcome.getErrors()) {
                messages.add(e.getMessage());
                if (r.fieldName == null && e.getFields() != null && e.getFields().size() == 1) {
                    try {
                        r.fieldName = GridDescribe.localName(GridDescribe.field(objectType, e.getFields()[0]));
                    } catch (GridException notAField) {
                        r.fieldName = null; // a message about the row, not a field
                    }
                }
            }
            r.message = String.join(messages, ' ');
        }
    }
}
