/**
 * gridColumns — each user's own columns. Plain functions over plain
 * objects, no DOM (HR-28).
 *
 * THE CHOICE
 * A user hides, shows and reorders the columns the admin set up, nothing
 * more. What they chose is a plain object of field keys:
 *   { order: [field, ...], hidden: [field, ...] }
 * `order` holds every column, hidden ones too, in the user's order; `hidden`
 * the ones not shown. null stands for the admin's columns, as configured.
 *
 * It is kept with the user's layout and read back against the grid as
 * it is now (readChoice): a key the grid no longer has is dropped; a column
 * the admin has added since shows, after the column before it in the admin's
 * order; a column the admin marks Always Shown is never hidden; and at least
 * one column always shows.
 *
 * Every function here takes the admin's columns, [{ field, alwaysShown }], in
 * the admin's order, and returns a new choice, or null when the choice is the
 * admin's; none changes what it is given.
 */

/** A choice is no more than this many keys a list: the layout's size cap. */
export const MAX_KEYS = 500;

function keysOf(list) {
    return Array.isArray(list) ? list.filter(k => typeof k === 'string' && k.length > 0).slice(0, MAX_KEYS) : [];
}

/**
 * The choice, made to fit these columns: every column in `order` once, in
 * the user's order where they set one; nothing unknown; no Always Shown
 * column hidden; never every column hidden. null for the admin's columns.
 */
export function readChoice(saved, columns) {
    const cols = Array.isArray(columns) ? columns : [];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !cols.length) return null;
    const known = new Map(cols.map(c => [c.field, c]));
    const order = [];
    const seen = new Set();
    keysOf(saved.order).forEach(k => {
        if (known.has(k) && !seen.has(k)) {
            seen.add(k);
            order.push(k);
        }
    });
    // A column the user has never placed (added by the admin since): after
    // the column before it in the admin's order, or first when it leads.
    cols.forEach((c, i) => {
        if (seen.has(c.field)) return;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
            const before = order.indexOf(cols[j].field);
            if (before >= 0) {
                at = before + 1;
                break;
            }
        }
        order.splice(at, 0, c.field);
        seen.add(c.field);
    });
    const hidden = new Set(keysOf(saved.hidden).filter(k => known.has(k) && known.get(k).alwaysShown !== true));
    // At least one column shows: hiding every one is no choice to keep.
    if (hidden.size >= order.length) hidden.clear();
    return normal(order.filter(k => known.has(k)), [...hidden], cols);
}

/** The choice as kept: null when it is the admin's columns, as configured. */
function normal(order, hidden, cols) {
    const hiddenInOrder = order.filter(k => hidden.includes(k));
    const admin = cols.map(c => c.field);
    const sameOrder = order.length === admin.length && order.every((k, i) => k === admin[i]);
    if (sameOrder && !hiddenInOrder.length) return null;
    return { order, hidden: hiddenInOrder };
}

/** The choice, or the admin's columns when there is none: { order, hidden }. */
function current(choice, columns) {
    const read = readChoice(choice, columns);
    return read || { order: (columns || []).map(c => c.field), hidden: [] };
}

/** The columns to draw, in the user's order: the admin's when there is no choice. */
export function shownColumns(columns, choice) {
    const cols = Array.isArray(columns) ? columns : [];
    const read = readChoice(choice, cols);
    if (!read) return cols;
    const byField = new Map(cols.map(c => [c.field, c]));
    const hidden = new Set(read.hidden);
    return read.order.filter(k => !hidden.has(k)).map(k => byField.get(k));
}

/** The fields of the columns not drawn. */
export function hiddenFields(columns, choice) {
    const read = readChoice(choice, columns);
    return read ? read.hidden : [];
}

/**
 * Can this column be hidden? Not when the admin keeps it on screen, when it
 * is hidden already, or when it is the last column showing.
 */
export function canHide(columns, choice, field) {
    const cols = Array.isArray(columns) ? columns : [];
    const col = cols.find(c => c.field === field);
    if (!col || col.alwaysShown === true) return false;
    const shown = shownColumns(cols, choice);
    return shown.length > 1 && shown.some(c => c.field === field);
}

/** The choice with this column hidden; the same choice when it cannot be. */
export function hideColumn(columns, choice, field) {
    if (!canHide(columns, choice, field)) return readChoice(choice, columns);
    const c = current(choice, columns);
    return normal(c.order, c.hidden.concat([field]), columns);
}

/**
 * The choice with `field` moved next to `target`: before it, or after it
 * when `after` is true. Moving a column onto itself changes nothing.
 */
export function moveColumn(columns, choice, field, target, after) {
    const c = current(choice, columns);
    if (field === target || !c.order.includes(field) || !c.order.includes(target)) return readChoice(choice, columns);
    const order = c.order.filter(k => k !== field);
    const at = order.indexOf(target) + (after ? 1 : 0);
    order.splice(at, 0, field);
    return normal(order, c.hidden, columns);
}

/**
 * The choice from the Choose columns dialog: `visible`, the columns to show
 * in the order to show them. The rest are hidden, after them, in the order
 * they had. An Always Shown column the list leaves out is shown at the end;
 * an empty list changes nothing.
 */
export function chooseColumns(columns, choice, visible) {
    const cols = Array.isArray(columns) ? columns : [];
    const known = new Set(cols.map(c => c.field));
    const shown = [];
    keysOf(visible).forEach(k => {
        if (known.has(k) && !shown.includes(k)) shown.push(k);
    });
    if (!shown.length) return readChoice(choice, cols);
    cols.forEach(c => {
        if (c.alwaysShown === true && !shown.includes(c.field)) shown.push(c.field);
    });
    const before = current(choice, cols).order;
    const rest = before.filter(k => !shown.includes(k));
    return normal(shown.concat(rest), rest, cols);
}

/** Do two choices show the same columns in the same order? */
export function sameChoice(a, b) {
    const x = a || null;
    const y = b || null;
    if (!x || !y) return x === y;
    return JSON.stringify(x.order) === JSON.stringify(y.order) && JSON.stringify(x.hidden) === JSON.stringify(y.hidden);
}
