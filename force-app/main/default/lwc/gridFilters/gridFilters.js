/**
 * gridFilters — the user's column filters, as plain functions: no DOM,
 * no events, no state (HR-25).
 *
 * A filter is { field, operator, value, valueTo }, kept by gridView and sent
 * with every request for rows and totals. A column's menu keeps one per
 * column; the Filters panel may add more (Stage equals A, Stage equals B),
 * joined by filter logic ("1 OR 2", parseLogic).
 * The server checks each against the grid's columns and builds bound SOQL
 * (GridFilters.cls); nothing here is trusted there. What is here decides what
 * the filter panel offers for a column, how a filter reads as a chip, and
 * whether one is complete enough to send.
 *
 * WHAT EACH TYPE OFFERS
 *   text, email, phone, url  contains, does not contain, equals, does not
 *                            equal, starts with, is blank, is not blank
 *   picklist                 equals, does not equal (a value from the list),
 *                            is blank, is not blank
 *   multi-select             includes, excludes (a value from the list), is
 *                            blank, is not blank
 *   number, currency,        equals, does not equal, greater and less than,
 *   percent, time            between, is blank, is not blank
 *   date, date/time          on, not on, after, on or after, before, on or
 *                            before, between, is blank, is not blank; a
 *                            date/time by the day, in the user's time zone
 *   checkbox                 is checked, is not checked
 *   lookup, owner            name contains, is blank, is not blank, and, for
 *                            a lookup to users, is me
 */
import { formatDate, formatTime, formatNumber, picklistLabel, isBlank, isNumericType } from 'c/gridFormat';

/** Filters one user may add to one grid: GridFilters.MAX_USER_FILTERS. */
export const MAX_FILTERS = 10;

const BLANK_OPS = [
    { value: 'is_blank', label: 'Is blank' },
    { value: 'is_not_blank', label: 'Is not blank' }
];
const TEXT_OPS = [
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Does not contain' },
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Does not equal' },
    { value: 'starts_with', label: 'Starts with' },
    ...BLANK_OPS
];
const ORDERED_OPS = [
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Does not equal' },
    { value: 'greater_than', label: 'Greater than' },
    { value: 'greater_or_equal', label: 'Greater than or equal to' },
    { value: 'less_than', label: 'Less than' },
    { value: 'less_or_equal', label: 'Less than or equal to' },
    { value: 'between', label: 'Between' },
    ...BLANK_OPS
];
const DATE_OPS = [
    { value: 'equals', label: 'On' },
    { value: 'not_equals', label: 'Not on' },
    { value: 'greater_than', label: 'After' },
    { value: 'greater_or_equal', label: 'On or after' },
    { value: 'less_than', label: 'Before' },
    { value: 'less_or_equal', label: 'On or before' },
    { value: 'between', label: 'Between' },
    ...BLANK_OPS
];
const PICKLIST_OPS = [
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Does not equal' },
    ...BLANK_OPS
];
const MULTI_OPS = [
    { value: 'contains', label: 'Includes' },
    { value: 'not_contains', label: 'Excludes' },
    ...BLANK_OPS
];
const CHECKBOX_OPS = [{ value: 'equals', label: 'Is' }];
const LOOKUP_OPS = [{ value: 'contains', label: 'Name contains' }, ...BLANK_OPS];
/** "Is me": a lookup to users equals the person looking. */
export const IS_ME = 'is_me';

const isDateType = type => type === 'date' || type === 'datetime';
const isLookupType = type => type === 'reference' || type === 'owner';

/** May the user filter by this column? The server says so (column.filterable). */
export function canFilter(column) {
    return Boolean(column) && column.filterable === true && column.isFormula !== true;
}

/** The conditions the panel offers for a column, [{ value, label }]. */
export function operatorsFor(column) {
    const type = (column && column.type) || 'text';
    if (type === 'picklist') return PICKLIST_OPS;
    if (type === 'multipicklist') return MULTI_OPS;
    if (type === 'checkbox' || type === 'boolean') return CHECKBOX_OPS;
    if (isDateType(type)) return DATE_OPS;
    if (isNumericType(type) || type === 'time') return ORDERED_OPS;
    if (isLookupType(type)) {
        const toUsers = (column.referenceTo || []).includes('User');
        return toUsers ? [{ value: IS_ME, label: 'Is me' }, ...LOOKUP_OPS] : LOOKUP_OPS;
    }
    return TEXT_OPS;
}

/** Does the condition take a value? The blank tests and "is me" do not. */
export function needsValue(operator) {
    return operator !== 'is_blank' && operator !== 'is_not_blank' && operator !== IS_ME;
}

/** What kind of box the value is typed or chosen in: text, number, date, time, select or none. */
export function inputKind(column, operator) {
    if (!needsValue(operator)) return 'none';
    const type = (column && column.type) || 'text';
    if (type === 'picklist' || type === 'multipicklist' || type === 'checkbox' || type === 'boolean') return 'select';
    if (isDateType(type)) return 'date';
    if (type === 'time') return 'time';
    if (isNumericType(type)) return 'number';
    return 'text';
}

/** The choices of a select box: a picklist's values, or Checked and Not checked. */
export function choicesFor(column) {
    const type = (column && column.type) || 'text';
    if (type === 'checkbox' || type === 'boolean') {
        return [
            { value: 'true', label: 'Checked' },
            { value: 'false', label: 'Not checked' }
        ];
    }
    return (column.options || []).map(o => ({ value: o.value, label: o.label }));
}

/**
 * The filter as the server takes it: "is me" is equals $User; a time typed
 * as 17:30 stays so (the server reads 17:30 or 17:30:00). Null when it is not
 * complete: a value missing, or Between without both ends.
 */
export function toRequest(filter) {
    if (!filter || !filter.field || !filter.operator) return null;
    if (filter.operator === IS_ME) return { field: filter.field, operator: 'equals', value: '$User', valueTo: null };
    if (!needsValue(filter.operator))
        return { field: filter.field, operator: filter.operator, value: null, valueTo: null };
    if (isBlank(filter.value)) return null;
    if (filter.operator === 'between' && isBlank(filter.valueTo)) return null;
    return {
        field: filter.field,
        operator: filter.operator,
        value: String(filter.value),
        valueTo: filter.operator === 'between' ? String(filter.valueTo) : null
    };
}

/** Why a filter cannot be applied yet, or '' when it can. */
export function problemOf(filter, column) {
    if (!filter || !filter.operator) return 'Choose a condition.';
    if (!needsValue(filter.operator)) return '';
    if (isBlank(filter.value)) return 'Enter a value.';
    if (filter.operator === 'between' && isBlank(filter.valueTo)) return 'Enter both ends of the range.';
    const type = (column && column.type) || 'text';
    if (isNumericType(type)) {
        const bad = [filter.value, filter.operator === 'between' ? filter.valueTo : 0].some(
            v => !/^[-+]?\d+(\.\d+)?$/.test(String(v).trim())
        );
        if (bad) return 'Enter a number, such as 1000.';
    }
    return '';
}

/** One value as the chip shows it. */
function shown(value, column) {
    const type = (column && column.type) || 'text';
    if (type === 'checkbox' || type === 'boolean')
        return value === 'true' || value === true ? 'checked' : 'not checked';
    if (type === 'picklist' || type === 'multipicklist') return picklistLabel(value, column.options);
    if (isDateType(type)) return formatDate(value);
    if (type === 'time') return formatTime(value);
    if (isNumericType(type)) return formatNumber(value, { type, scale: column.scale });
    return `“${value}”`;
}

/** A filter in words, for its chip: "Stage equals Closed Won", "Amount between 1 and 9". */
export function describeFilter(filter, column) {
    const label = (column && column.label) || filter.field;
    const op = operatorsFor(column).find(o => o.value === filter.operator);
    const words = op ? op.label.toLowerCase() : filter.operator;
    // "Is me" goes to the server as equals $User (toRequest), and comes back so.
    if (filter.operator === IS_ME || (filter.operator === 'equals' && filter.value === '$User'))
        return `${label} is me`;
    if (column && (column.type === 'checkbox' || column.type === 'boolean'))
        return `${label} is ${shown(filter.value, column)}`;
    if (!needsValue(filter.operator)) return `${label} ${words}`;
    const text = `${label} ${words} ${shown(filter.value, column)}`;
    return filter.operator === 'between' ? `${text} and ${shown(filter.valueTo, column)}` : text;
}

/**
 * The filters with this column's replaced (or removed, with null), one per
 * column, in the order first applied. A new column past MAX_FILTERS is not
 * added: the same list comes back.
 */
export function withFilter(filters, field, filter) {
    const list = Array.isArray(filters) ? filters : [];
    const at = list.findIndex(f => f.field === field);
    if (!filter) return at < 0 ? list : list.filter(f => f.field !== field);
    if (at < 0) return list.length >= MAX_FILTERS ? list : [...list, filter];
    const out = list.slice();
    out[at] = filter;
    return out;
}

/** Filters with the one at this place replaced, from the Filters panel. */
export function withFilterAt(filters, index, filter) {
    const list = Array.isArray(filters) ? filters : [];
    if (!filter || index < 0 || index >= list.length) return list;
    const out = list.slice();
    out[index] = filter;
    return out;
}

/** Filters without the one at this place: its chip's remove button, or the Filters panel. */
export function withoutFilterAt(filters, index) {
    const list = Array.isArray(filters) ? filters : [];
    if (index < 0 || index >= list.length) return list;
    return list.filter((_, i) => i !== index);
}

// ------------------------------------------------------------ filter logic

/** Characters filter logic may have: GridFilterLogic.MAX_LENGTH. */
export const MAX_LOGIC = 255;

const SPELLING = 'Check the spelling in your filter logic.';
const PARENTHESIS = 'Your filter is missing a parenthesis.';

/** Numbers, AND, OR, NOT and parentheses; anything else is a spelling mistake. */
function logicTokens(logic) {
    const out = [];
    const text = logic.toUpperCase();
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) {
            i++;
        } else if (ch === '(' || ch === ')') {
            out.push(ch);
            i++;
        } else if (/[0-9A-Z]/.test(ch)) {
            const digits = /[0-9]/.test(ch);
            let j = i;
            while (j < text.length && (digits ? /[0-9]/ : /[A-Z]/).test(text[j])) j++;
            const word = text.slice(i, j);
            if (!digits && word !== 'AND' && word !== 'OR' && word !== 'NOT') throw new Error(SPELLING);
            out.push(word);
            i = j;
        } else {
            throw new Error(SPELLING);
        }
    }
    return out;
}

/** The logic as a tree: { op: 'filter', index } | { op: 'and' | 'or' | 'not', parts }. */
function logicTree(tokens, count) {
    let at = 0;
    function expression() {
        const first = term();
        let word = null;
        let joined = null;
        while (at < tokens.length && (tokens[at] === 'AND' || tokens[at] === 'OR')) {
            const next = tokens[at] === 'AND' ? 'and' : 'or';
            if (word && word !== next)
                throw new Error('Your filter must use parentheses around successive AND and OR expressions.');
            if (!joined) joined = { op: next, parts: [first] };
            word = next;
            at++;
            joined.parts.push(term());
        }
        return joined || first;
    }
    function term() {
        if (at >= tokens.length) throw new Error(SPELLING);
        const token = tokens[at];
        if (token === 'NOT') {
            at++;
            return { op: 'not', parts: [term()] };
        }
        if (token === '(') {
            at++;
            const nested = expression();
            if (tokens[at] !== ')') throw new Error(PARENTHESIS);
            at++;
            return nested;
        }
        if (/^[0-9]+$/.test(token)) {
            at++;
            const n = token.length > 3 ? 1000 : Number(token);
            if (n < 1 || n > count) throw new Error(`The filter logic references an undefined filter: ${token}.`);
            return { op: 'filter', index: n - 1 };
        }
        throw new Error(SPELLING);
    }
    const root = expression();
    if (at < tokens.length) throw new Error(tokens[at] === ')' ? PARENTHESIS : SPELLING);
    return root;
}

function spelledTree(node, top) {
    if (node.op === 'filter') return String(node.index + 1);
    if (node.op === 'not') return 'NOT ' + spelledTree(node.parts[0], false);
    const joined = node.parts.map(p => spelledTree(p, false)).join(node.op === 'and' ? ' AND ' : ' OR ');
    return top ? joined : `(${joined})`;
}

function usedFilters(node, used) {
    if (node.op === 'filter') used.add(node.index);
    (node.parts || []).forEach(p => usedFilters(p, used));
    return used;
}

/**
 * Filter logic for this many filters, read as the server reads it
 * (GridFilterLogic): { logic, error }. `logic` is its standard spelling, "1
 * AND (2 OR 3)", or '' for none (every filter must hold); `error` is why it
 * cannot be used, in Salesforce's words, or ''. The server checks it again.
 */
export function parseLogic(logic, count) {
    const text = typeof logic === 'string' ? logic.trim() : '';
    if (!text || !count) return { logic: '', error: '' };
    if (text.length > MAX_LOGIC) return { logic: '', error: `Filter logic is ${MAX_LOGIC} characters at most.` };
    try {
        const tree = logicTree(logicTokens(text), count);
        if (usedFilters(tree, new Set()).size < count)
            return {
                logic: '',
                error: 'Some filter conditions are defined but not referenced in your filter logic.'
            };
        return { logic: spelledTree(tree, true), error: '' };
    } catch (e) {
        return { logic: '', error: e.message };
    }
}
