/**
 * gridFields — rules that belong to a field type rather than to the table:
 * what a lookup shows and links to, which values a dependent picklist
 * offers, which values a row's record type allows, and what an edit of a
 * controlling field forces. Pure functions over
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

/** Names one call to the server looks up (GridLookup.MAX_NAMES). */
export const MAX_NAME_LOOKUP = 200;

/**
 * The names among these texts that no record in `names` ({ [id]: name })
 * carries and that are not record Ids: what a paste or an import must ask
 * the server about. Distinct, trimmed, at most MAX_NAME_LOOKUP.
 */
export function unknownNames(texts, names) {
    const index = nameIndex(names);
    const out = new Map();
    (texts || []).forEach(t => {
        const s = t === null || t === undefined ? '' : String(t).trim();
        if (!s || RECORD_ID.test(s) || s.length > 255) return;
        const key = s.toLowerCase();
        if (!index.has(key) && !out.has(key)) out.set(key, s);
    });
    return [...out.values()].slice(0, MAX_NAME_LOOKUP);
}

/** The server's answer ({ lower-case name: [{ id, name }] }) as { [id]: name }. */
export function namesFound(found) {
    const out = {};
    Object.keys(found || {}).forEach(key => {
        (found[key] || []).forEach(r => {
            if (r && r.id && r.name) out[r.id] = r.name;
        });
    });
    return out;
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
                out.push({
                    recordId: change.recordId,
                    field: dependent.field,
                    value: null,
                    originalValue: original(change.recordId, dependent.field)
                });
            }
        });
    });
    return out;
}

// ============================================================ record types

const PICKLIST_TYPES = new Set(['picklist', 'multipicklist']);

/**
 * The UI API's answer for one record type (getPicklistValuesByRecordType) as
 * { [field, lower case]: [values] }. A packaged field is listed under its
 * name without the namespace too, as the grid's columns name it.
 */
export function recordTypeValues(data) {
    const out = {};
    const fields = (data && data.picklistFieldValues) || {};
    Object.keys(fields).forEach(name => {
        const values = ((fields[name] && fields[name].values) || []).map(v => v.value);
        const lower = name.toLowerCase();
        out[lower] = values;
        const local = lower.match(/^[a-z0-9]+__(.+__c)$/);
        if (local && !(local[1] in out)) out[local[1]] = values;
    });
    return out;
}

/**
 * The values a row's record type allows for a picklist column, as a Set; null
 * when nothing narrows them: the grid's picklists do not follow record
 * types, the row's are not known yet, or its record type does not list the field.
 *
 *   byType   { [recordTypeId]: recordTypeValues(...) }
 */
export function allowedValues(column, row, byType) {
    if (!byType || !column || !PICKLIST_TYPES.has(column.type) || !row || !row.RecordTypeId) return null;
    const fields = byType[String(row.RecordTypeId)];
    const values = fields && fields[String(column.field).toLowerCase()];
    return Array.isArray(values) ? new Set(values) : null;
}

function valuesOf(column, value) {
    if (isBlank(value)) return [];
    return column.type === 'multipicklist' ? String(value).split(';') : [String(value)];
}

/**
 * The values a row's editor offers: those its controlling value allows (a
 * dependent picklist), narrowed to those its record type allows, as
 * Salesforce's record page offers them. The row's own value stays, so a value
 * another record type set is shown by its label rather than as unknown.
 */
export function rowOptions(column, row, controllingValue, byType, current) {
    const base = column.dependentOn ? dependentOptions(column, controllingValue) : column.options || [];
    const allowed = allowedValues(column, row, byType);
    if (!allowed) return base;
    const keep = new Set(valuesOf(column, current));
    return base.filter(o => allowed.has(o.value) || keep.has(o.value));
}

/** Update field across rows: the values every row's record type allows. */
export function sharedOptions(column, rows, byType) {
    let options = column.options || [];
    (rows || []).forEach(row => {
        const allowed = allowedValues(column, row, byType);
        if (allowed) options = options.filter(o => allowed.has(o.value));
    });
    return options;
}

/** Blank is always allowed; otherwise every value must be one the row's record type allows. */
export function isAllowedForRecordType(column, value, row, byType) {
    const allowed = allowedValues(column, row, byType);
    return !allowed || valuesOf(column, value).every(v => allowed.has(v));
}
