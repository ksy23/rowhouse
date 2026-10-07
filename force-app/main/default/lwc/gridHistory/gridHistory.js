/**
 * gridHistory — undo and redo of uncommitted edits (docs/spreadsheet.md).
 * Plain data in, new plain data out, like gridEditState (HR-28).
 *
 * A step is one user action: a typed cell, a paste, a fill-down, a clear. It
 * records, for every cell the action touched, the cell's draft before and
 * after — { has: false } when the cell had no draft. Undo puts the "before"
 * states back; redo the "after" states. A new step empties the redo stack, as
 * in every editor. Only the last MAX_STEPS steps are kept.
 *
 *   history: { undo: Step[], redo: Step[] }
 *   Step:    { label: string, cells: [{ recordId, field, before, after }] }
 */

export const MAX_STEPS = 100;

const has = (obj, key) => Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);

export function emptyHistory() {
    return { undo: [], redo: [] };
}

/** A cell's draft state: { has: true, value } or { has: false }. */
export function draftState(drafts, recordId, field) {
    const row = drafts && drafts[recordId];
    return has(row, field) ? { has: true, value: row[field] } : { has: false };
}

/**
 * The step that turned `before` into `after`, for the cells listed. Cells whose
 * draft did not change are left out; a step with no cells is null.
 */
export function stepBetween(label, before, after, cells) {
    const seen = new Set();
    const changed = [];
    cells.forEach(({ recordId, field }) => {
        const key = recordId + '|' + field; // neither Ids nor field names contain |
        if (seen.has(key)) return;
        seen.add(key);
        const b = draftState(before, recordId, field);
        const a = draftState(after, recordId, field);
        const same =
            b.has === a.has &&
            (!b.has ||
                b.value === a.value ||
                (b.value != null && a.value != null && String(b.value) === String(a.value)));
        if (!same) changed.push({ recordId, field, before: b, after: a });
    });
    return changed.length ? { label, cells: changed } : null;
}

/** Add a step. The redo stack is emptied: a new action starts a new future. */
export function record(history, step) {
    if (!step) return history;
    return { undo: history.undo.concat([step]).slice(-MAX_STEPS), redo: [] };
}

function applyStates(drafts, cells, side) {
    const next = { ...(drafts || {}) };
    cells.forEach(cell => {
        const row = { ...(next[cell.recordId] || {}) };
        const state = cell[side];
        if (state.has) row[cell.field] = state.value;
        else delete row[cell.field];
        if (Object.keys(row).length) next[cell.recordId] = row;
        else delete next[cell.recordId];
    });
    return next;
}

/** Undo the last step: { history, drafts, step }, or null when there is none. */
export function undo(history, drafts) {
    const step = history.undo[history.undo.length - 1];
    if (!step) return null;
    return {
        history: { undo: history.undo.slice(0, -1), redo: history.redo.concat([step]) },
        drafts: applyStates(drafts, step.cells, 'before'),
        step
    };
}

/** Redo the last undone step: { history, drafts, step }, or null when there is none. */
export function redo(history, drafts) {
    const step = history.redo[history.redo.length - 1];
    if (!step) return null;
    return {
        history: { undo: history.undo.concat([step]), redo: history.redo.slice(0, -1) },
        drafts: applyStates(drafts, step.cells, 'after'),
        step
    };
}

/**
 * The history without the cells of records that no longer exist, after a
 * delete. A step left with no cells goes; the rest stay undoable.
 */
export function withoutRecords(history, recordIds) {
    const gone = new Set(recordIds);
    const prune = steps =>
        steps
            .map(step =>
                step.cells.some(c => gone.has(c.recordId))
                    ? { ...step, cells: step.cells.filter(c => !gone.has(c.recordId)) }
                    : step
            )
            .filter(step => step.cells.length);
    return { undo: prune(history.undo), redo: prune(history.redo) };
}

/** "paste of 12 cells", "edit" — how a step is named in announcements and titles. */
export function describe(step) {
    if (!step) return '';
    const n = step.cells.length;
    return n > 1 ? `${step.label} of ${n} cells` : step.label;
}
