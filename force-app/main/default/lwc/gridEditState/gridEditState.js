/**
 * gridEditState — uncommitted edits and save errors, as plain data.
 *
 * WHY PLAIN DATA (HR-28)
 * Drafts cross a component boundary (gridApp → gridTable) inside the config
 * object. Lightning Web Security proxies cross-namespace data and silently
 * swallows mutations on anything that is not a plain object, array or typed
 * array, so drafts are plain objects keyed by record Id and every function here
 * returns a NEW object rather than mutating its input. That also gives gridTable
 * a new reference on every change, which is what HR-17 requires of callers.
 *
 * Shapes
 *   drafts: { [recordId]: { [field]: value } }
 *   errors: { [recordId]: { row?: string, fields: { [field]: string } } }
 */

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Record one cell edit. If the new value equals the stored value the draft is
 * removed — typing a value back to what it was is not an edit.
 *
 * TC-001 / TC-002: null and '' are treated as the same "empty" when deciding
 * whether anything changed, because the platform stores '' as null for text
 * fields. Editing a null cell and cancelling must not produce a draft of ''.
 */
export function applyEdit(drafts, recordId, field, value, originalValue) {
    const next = { ...(drafts || {}) };
    const row = { ...(next[recordId] || {}) };
    if (sameValue(value, originalValue)) {
        delete row[field];
    } else {
        row[field] = value;
    }
    if (Object.keys(row).length) next[recordId] = row;
    else delete next[recordId];
    return next;
}

/**
 * Record many cell edits at once (a paste, a fill-down, a clear), by the same
 * rule as applyEdit. One copy of the drafts, not one per cell: applyEdit in a
 * loop copies every draft for every cell, which at 10,000 pasted cells is a
 * hundred million copies.
 *
 * @param {object} drafts
 * @param {Array<{recordId, field, value, originalValue}>} changes
 */
export function applyEdits(drafts, changes) {
    const next = { ...(drafts || {}) };
    const copied = new Set();
    (changes || []).forEach(({ recordId, field, value, originalValue }) => {
        if (!copied.has(recordId)) {
            next[recordId] = { ...(next[recordId] || {}) };
            copied.add(recordId);
        }
        if (sameValue(value, originalValue)) delete next[recordId][field];
        else next[recordId][field] = value;
    });
    copied.forEach(id => {
        if (!Object.keys(next[id]).length) delete next[id];
    });
    return next;
}

function sameValue(a, b) {
    const blank = v => v === null || v === undefined || v === '';
    if (blank(a) && blank(b)) return true;
    return String(a) === String(b);
}

export function draftCount(drafts) {
    return Object.values(drafts || {}).reduce((n, row) => n + Object.keys(row).length, 0);
}

export function hasDrafts(drafts) {
    return draftCount(drafts) > 0;
}

/** The save payload: one plain object per edited record, Id first. */
export function toPayload(drafts) {
    return Object.keys(drafts || {}).map(id => ({ Id: id, ...drafts[id] }));
}

/**
 * Fold a GridSaveResult into the next drafts and errors.
 *
 * A record that saved cleanly loses its draft. A record that failed keeps its
 * draft — the user's typing is not thrown away — and gains an error, at cell
 * level when the server named the field, otherwise at row level.
 *
 * @param {object} drafts
 * @param {{errors: Array<{recordId, fieldName, message}>}} result
 * @returns {{drafts: object, errors: object}}
 */
export function applySaveResult(drafts, result) {
    const failed = new Set((result && result.errors ? result.errors : []).map(e => e.recordId));
    const nextDrafts = {};
    Object.keys(drafts || {}).forEach(id => {
        if (failed.has(id)) nextDrafts[id] = { ...drafts[id] };
    });
    const errors = {};
    (result && result.errors ? result.errors : []).forEach(e => {
        const entry = errors[e.recordId] || { row: null, fields: {} };
        if (e.fieldName && nextDrafts[e.recordId] && has(nextDrafts[e.recordId], e.fieldName)) {
            entry.fields[e.fieldName] = e.message;
        } else if (e.fieldName) {
            // The server named a field the user did not edit (a validation rule on
            // another field, say). It still belongs to that cell.
            entry.fields[e.fieldName] = e.message;
        } else {
            entry.row = entry.row ? entry.row + ' ' + e.message : e.message;
        }
        errors[e.recordId] = entry;
    });
    return { drafts: nextDrafts, errors };
}

/**
 * Merge saved values into the row array, returning a NEW array. Rows that were
 * not edited keep their object identity, so the table only re-renders what
 * changed.
 */
export function mergeSaved(rows, drafts, failedIds) {
    const failed = new Set(failedIds || []);
    return (rows || []).map(row => {
        const d = drafts && drafts[row.Id];
        return d && !failed.has(row.Id) ? { ...row, ...d } : row;
    });
}

export const REFUSED_BY_PERMISSION = 'Not saved: you do not have permission to edit this field.';
export const REFUSED_BY_CONFIG = 'Not saved: this column is not editable in this grid.';

/**
 * Fields the server refused before anything was written: `rejectedFields` (not
 * an editable column of this grid, HR-6) and `strippedFields` (field-level
 * security). The record itself saved, so applySaveResult dropped its draft; the
 * refused edit must not vanish silently. The typed value comes back as a draft,
 * and the cell carries the reason.
 *
 * @param {{drafts: object, errors: object}} state  output of applySaveResult
 * @param {object} sent    the drafts that were sent
 * @param {{rejectedFields?: string[], strippedFields?: string[]}} result
 * @returns {{drafts: object, errors: object}}
 */
export function applyRefusedFields(state, sent, result) {
    const lower = list => new Set((list || []).map(f => String(f).toLowerCase()));
    const rejected = lower(result && result.rejectedFields);
    const stripped = lower(result && result.strippedFields);
    if (!rejected.size && !stripped.size) return state;
    const drafts = { ...(state.drafts || {}) };
    const errors = { ...(state.errors || {}) };
    Object.keys(sent || {}).forEach(id => {
        Object.keys(sent[id]).forEach(field => {
            const key = field.toLowerCase();
            let message = null;
            if (rejected.has(key)) message = REFUSED_BY_CONFIG;
            else if (stripped.has(key)) message = REFUSED_BY_PERMISSION;
            if (!message) return;
            drafts[id] = { ...(drafts[id] || {}), [field]: sent[id][field] };
            const before = errors[id] || { row: null, fields: {} };
            errors[id] = { row: before.row, fields: { ...before.fields, [field]: message } };
        });
    });
    return { drafts, errors };
}

/**
 * Edits made WHILE a save was in flight. The save result is computed from the
 * drafts that were sent; anything typed since then is a new edit and must
 * survive the result being applied.
 */
export function carryNewEdits(current, sent, next) {
    const out = { ...(next || {}) };
    Object.keys(current || {}).forEach(id => {
        Object.keys(current[id]).forEach(field => {
            const value = current[id][field];
            const alreadySent = sent && sent[id] && has(sent[id], field) && sameValue(sent[id][field], value);
            if (!alreadySent) out[id] = { ...(out[id] || {}), [field]: value };
        });
    });
    return out;
}

/** A cell's error is about the old value; editing the cell clears it. */
export function clearCellError(errors, recordId, field) {
    const entry = errors && errors[recordId];
    if (!entry || !entry.fields || !has(entry.fields, field)) return errors;
    const fields = { ...entry.fields };
    delete fields[field];
    const next = { ...errors };
    if (Object.keys(fields).length || entry.row) next[recordId] = { row: entry.row, fields };
    else delete next[recordId];
    return next;
}

/** Salesforce's own wording, and the server's (GridSaveService.REQUIRED_MESSAGE). */
export const REQUIRED_MESSAGE = 'Complete this field.';

/**
 * Drafts that blank a required column. The platform does not always refuse
 * this (a blank Name on update is replaced with the record Id), so the grid
 * checks before sending, and the server checks again.
 *
 * @returns {object} errors in the usual shape; empty when nothing is missing
 */
export function requiredErrors(drafts, columns) {
    const required = new Set((columns || []).filter(c => c.required).map(c => c.field));
    const errors = {};
    Object.keys(drafts || {}).forEach(id => {
        Object.keys(drafts[id]).forEach(field => {
            const value = drafts[id][field];
            const blank = value === null || value === undefined || String(value).trim() === '';
            if (required.has(field) && blank) {
                const entry = errors[id] || { row: null, fields: {} };
                entry.fields[field] = REQUIRED_MESSAGE;
                errors[id] = entry;
            }
        });
    });
    return errors;
}

/** Merge two error maps; cell messages in `more` win. Returns a NEW object. */
export function mergeErrors(errors, more) {
    const out = { ...(errors || {}) };
    Object.keys(more || {}).forEach(id => {
        const a = out[id] || { row: null, fields: {} };
        const b = more[id];
        out[id] = { row: b.row || a.row, fields: { ...a.fields, ...b.fields } };
    });
    return out;
}
