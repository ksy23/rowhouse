/**
 * gridKeyboard — the grid's keyboard model, as pure functions.
 *
 * WHY A PLAIN MODULE (HR-25)
 * Lightning Locker's support for extending mixins is very limited and works only
 * if the mixin touches neither the DOM nor events — which is exactly what a
 * keyboard layer does. So this file owns no DOM, no events and no state. It
 * answers one question — "given where focus is and which key was pressed, where
 * should focus go?" — and gridTable does the rest.
 *
 * Positions are { row, col }:
 *   row 0      is the header row; data rows are 1..rowCount (position in the
 *              sorted, filtered view — not the record's index in the data).
 *   col 1..n   are the rendered columns, left to right.
 *
 * The rules come from two written specifications, so a failing test is a
 * deviation from a document, not a matter of taste:
 *   - W3C APG data grid: arrow keys never wrap; Home/End stay in the row;
 *     Ctrl+Home/Ctrl+End go to the first/last cell of the first/last row.
 *   - SLDS data table: navigation mode and actionable mode.
 */

export const MODE_NAVIGATION = 'navigation';
export const MODE_ACTION = 'action';

const NAV_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown'
]);

/** True when the key moves focus in navigation mode. */
export function isNavigationKey(key) {
    return NAV_KEYS.has(key);
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Where focus goes next. Never wraps, never leaves the grid.
 *
 * @param {{row:number,col:number}} from  current position
 * @param {string} key                    KeyboardEvent.key
 * @param {object} modifiers              { ctrlKey, metaKey }
 * @param {object} bounds                 { rowCount, colCount, pageSize, rtl }
 *        rowCount is the number of DATA rows in the whole view (not just the
 *        rendered window) — that is what makes Ctrl+End land on the last row of
 *        the data rather than the last row in the DOM.
 * @returns {{row:number,col:number}}     a new object; `from` is not mutated
 */
export function nextPosition(from, key, modifiers = {}, bounds = {}) {
    const rowCount = Math.max(0, bounds.rowCount || 0);
    const colCount = Math.max(1, bounds.colCount || 1);
    const pageSize = Math.max(1, bounds.pageSize || 10);
    const ctrl = Boolean(modifiers.ctrlKey || modifiers.metaKey);

    // In a right-to-left layout the visual left is the logical end. Salesforce's
    // own datatable inverts its direction constants the same way.
    const forward = bounds.rtl ? -1 : 1;

    let { row, col } = from;
    switch (key) {
        case 'ArrowUp':
            row -= 1;
            break;
        case 'ArrowDown':
            row += 1;
            break;
        case 'ArrowLeft':
            col -= forward;
            break;
        case 'ArrowRight':
            col += forward;
            break;
        case 'Home':
            col = 1;
            if (ctrl) row = 0;
            break;
        case 'End':
            col = colCount;
            if (ctrl) row = rowCount;
            break;
        case 'PageUp':
            // PageUp never lands on the header: it is a data-scrolling key.
            row = row === 0 ? 0 : Math.max(1, row - pageSize);
            break;
        case 'PageDown':
            row = row === 0 ? Math.min(rowCount, pageSize) : row + pageSize;
            break;
        default:
            return { row: from.row, col: from.col };
    }
    return {
        row: clamp(row, 0, rowCount),
        col: clamp(col, 1, colCount)
    };
}

/**
 * What a key means in the current mode, as a verb gridTable can act on.
 * Returning a verb rather than doing the work keeps this module DOM-free.
 */
export function actionFor(key, mode, { isHeader = false, shiftKey = false, editable = false, hasLink = false, ctrlKey = false, metaKey = false, altKey = false } = {}) {
    if (mode === MODE_ACTION) {
        if (key === 'Escape') return 'exitAction';
        return null; // Everything else belongs to the in-cell control.
    }
    if (isNavigationKey(key)) return 'move';
    // A spreadsheet's keys start editing an editable data cell: F2 always,
    // Enter unless the cell's content is a link, which Enter reaches instead.
    if (!isHeader && editable && (key === 'F2' || (key === 'Enter' && !hasLink))) return 'edit';
    // SLDS: Enter (or F2) switches a cell — header or data — into actionable mode,
    // where its controls (sort button, resize input, edit button, link) take focus.
    if (key === 'Enter' || key === 'F2') return 'enterAction';
    // Space is the one-key shortcut: sort from a header, select from a data row.
    if (key === ' ' || key === 'Spacebar') {
        if (isHeader) return shiftKey ? 'addSort' : 'sort';
        return 'toggleSelect';
    }
    // Typing on an editable cell starts editing with what was typed.
    if (!isHeader && editable && isPrintable(key, { ctrlKey, metaKey, altKey })) return 'typeToEdit';
    return null;
}

/** One printable character, typed without Ctrl, Cmd or Alt. Space is not one: it selects. */
export function isPrintable(key, { ctrlKey = false, metaKey = false, altKey = false } = {}) {
    return typeof key === 'string' && [...key].length === 1 && key !== ' ' && !ctrlKey && !metaKey && !altKey;
}
