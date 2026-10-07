/**
 * gridFields — rules that belong to a field type rather than to the table:
 * what a lookup shows and links to, which values a dependent picklist
 * offers, and what an edit of a controlling field forces. Pure functions over
 * plain objects, so the table stays about tables.
 */
import { isBlank } from 'c/gridFormat';

const LOOKUP_TYPES = new Set(['reference', 'owner']);
const RECORD_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const QUEUE_PREFIX = '00G'; // queues are Groups; they have no record page

export function isLookup(type) {
    return LOOKUP_TYPES.has(type);
}

/** The name a lookup shows: the record's name when known, else its Id. */
export function lookupText(value, names) {
    if (isBlank(value)) return '';
    return (names && names[value]) || String(value);
}

/** A link to the looked-up record, or null (no value, not an Id, or a queue). */
export function lookupHref(value) {
    if (isBlank(value)) return null;
    const id = String(value);
    if (!RECORD_ID.test(id) || id.startsWith(QUEUE_PREFIX)) return null;
    return `/lightning/r/${id}/view`;
}

/** Lower-case name to the record Ids that carry it, for pasting a name into a lookup. */
export function nameIndex(names) {
    const index = new Map();
    Object.keys(names || {}).forEach(id => {
        const key = String(names[id]).toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(id);
    });
    return index;
}

/** A controlling value as validFor lists it: the picklist value, or 'true' / 'false'. */
function controllingKey(value) {
    if (value === true || value === false) return String(value);
    return isBlank(value) ? null : String(value);
}

/**
 * The values a dependent picklist offers for a controlling value (TC-037).
 * None while the controlling field is blank, as in Salesforce, and none when
 * no value is valid for it (TC-039: the editor is then disabled and empty).
 */
export function dependentOptions(column, controllingValue) {
    const key = controllingKey(controllingValue);
    if (key === null) return [];
    return (column.options || []).filter(o => Array.isArray(o.validFor) && o.validFor.includes(key));
}

/** Blank is always valid; anything else must be offered for the controlling value. */
export function isValidDependent(column, value, controllingValue) {
    if (isBlank(value)) return true;
    return dependentOptions(column, controllingValue).some(o => o.value === value);
}

/**
 * The dependent values an edit of their controlling field makes invalid, as
 * changes that clear them. TC-038: a stored invalid pairing is shown as
 * stored and left alone; only an explicit edit of the controlling field
 * corrects it, as Salesforce's own record page does.
 *
 *   changes   [{ recordId, field, value, originalValue }], one action's edits
 *   columns   the grid's columns
 *   current   (recordId, field) => the value before this action (draft or stored)
 *   original  (recordId, field) => the stored value
 *
 * A change that leaves the controlling value as it was forces nothing, and a
 * dependent this same action sets is left to that action.
 */
export function dependentClears(changes, columns, current, original) {
    const out = [];
    const touched = new Set(changes.map(c => c.recordId + '|' + c.field));
    changes.forEach(change => {
        if (current(change.recordId, change.field) === change.value) return;
        columns.forEach(dependent => {
            if (dependent.dependentOn !== change.field || !dependent.editable) return;
            const key = change.recordId + '|' + dependent.field;
            if (touched.has(key)) return;
            if (!isValidDependent(dependent, current(change.recordId, dependent.field), change.value)) {
                touched.add(key);
                out.push({ recordId: change.recordId, field: dependent.field, value: null, originalValue: original(change.recordId, dependent.field) });
            }
        });
    });
    return out;
}
