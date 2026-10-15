/**
 * gridDisplayRules — conditional formatting, as plain functions: no DOM,
 * no events, no state (HR-25).
 *
 * The server sends the rules already checked and normalised (GridConfig), in
 * the order they apply: { name, label, field, type, operator, value, style,
 * applyTo }.
 * compileRules turns each into a test once; formatsFor tests one row against
 * every rule and says which classes each cell takes, and which labels.
 *
 * WHICH RULE WINS
 * A style sets one of three things: the fill, the text color or the weight.
 * On a cell, the first matching rule to set each thing wins, first meaning the
 * lowest Sort Order. A row rule's text color or weight counts for every cell
 * of its row and a cell rule for its own column only, in one order, so a cell
 * rule placed before a row rule shows through it, and one placed after does
 * not.
 *
 * A ROW'S FILL IS A TINT AND A BAR
 * A whole row filled with a cell's strong color competed with the row's
 * hover, selected and unsaved colors, and a blue row looked selected. A row
 * rule's fill marks the row with a light tint, weaker than all of those, and
 * a colored bar at its left edge (both from the bar class given here; the
 * stylesheet draws them): the first matching row fill wins. Cell fills are
 * unchanged.
 *
 * LABELS
 * Color alone does not say what it means (WCAG 1.4.1). Each rule carries its
 * label (the Grid Display Rule's Label); a cell's labels are those of the rules
 * that formatted it, and a row's those of the row rules that did.
 *
 * NO BLUE
 * SLDS's selected row is a light blue, so a blue fill would look like a
 * selection. Purple is offered instead.
 *
 * WHAT IS TESTED
 * The value the cell shows: an unsaved edit if there is one, else the stored
 * value, so a format follows the user's typing before anything is saved.
 *
 * COMPARISONS
 *   numbers          as numbers; a large one arrives as a string (TC-024)
 *   dates            as ISO dates; TODAY and TODAY+N / TODAY-N are worked out
 *                    in the user's time zone, when the rules are compiled
 *   date/times       by calendar day, in the user's time zone
 *   times            as HH:MM:SS
 *   text, picklists  ignoring case, as Salesforce filters compare text
 *   multi-select     contains: includes that value; equals: the same values
 *   lookups, owners  by record Id, 15 or 18 characters; $User is the viewer
 *   blank            null, undefined or ''; a checkbox is never blank (unset
 *                    is unchecked)
 * A blank value never meets equals, greater or less than, contains or starts
 * with, and always meets does not equal and does not contain, as in a
 * Salesforce list view filter.
 *
 * MORE OPTIONS
 *   Between      Value and Value To, both included, for anything ordered.
 *   Two fields   compareField: the cell's value against another field of the
 *                same row, read the same way; a blank on either side meets
 *                only "does not equal".
 *   Formula      tested on the server, for the saved record: the row carries
 *                the names of the formula rules it meets (`_rules`), so an
 *                unsaved edit does not change the result until it is saved.
 *   Icons        Warning, Error, Success, Info, Up and Down, before the value,
 *                labelled with the rule's label; a row rule's icon goes on the
 *                row's first value.
 *   Data bar     a bar behind a number, its length the value's place in the
 *                column (gridTable works out the scale from the loaded rows).
 * Icons and bars are kinds of their own, so a cell can have a fill, an icon
 * and a bar at once, the first matching rule of each kind winning.
 */
import TIME_ZONE from '@salesforce/i18n/timeZone';
import USER_ID from '@salesforce/user/Id';
import { isBlank } from 'c/gridFormat';

/** Each style: the class it adds and the one thing it sets. */
export const STYLES = Object.freeze({
    fill_green: { kind: 'fill', cls: 'rh-rule_fill-green', bar: 'rh-rule_bar-green', swatch: 'Green' },
    fill_amber: { kind: 'fill', cls: 'rh-rule_fill-amber', bar: 'rh-rule_bar-amber', swatch: 'Amber' },
    fill_red: { kind: 'fill', cls: 'rh-rule_fill-red', bar: 'rh-rule_bar-red', swatch: 'Red' },
    fill_purple: { kind: 'fill', cls: 'rh-rule_fill-purple', bar: 'rh-rule_bar-purple', swatch: 'Purple' },
    fill_gray: { kind: 'fill', cls: 'rh-rule_fill-gray', bar: 'rh-rule_bar-gray', swatch: 'Gray' },
    text_red: { kind: 'text', cls: 'rh-rule_text-red', swatch: 'Red text' },
    text_green: { kind: 'text', cls: 'rh-rule_text-green', swatch: 'Green text' },
    text_gray: { kind: 'text', cls: 'rh-rule_text-gray', swatch: 'Gray text' },
    bold: { kind: 'weight', cls: 'rh-rule_bold', swatch: 'Bold' },
    icon_warning: { kind: 'icon', icon: 'utility:warning', variant: 'warning', swatch: 'Warning icon' },
    icon_error: { kind: 'icon', icon: 'utility:error', variant: 'error', swatch: 'Error icon' },
    icon_success: { kind: 'icon', icon: 'utility:success', variant: 'success', swatch: 'Success icon' },
    icon_info: { kind: 'icon', icon: 'utility:info', variant: null, swatch: 'Info icon' },
    icon_up: { kind: 'icon', icon: 'utility:arrowup', variant: null, swatch: 'Up arrow' },
    icon_down: { kind: 'icon', icon: 'utility:arrowdown', variant: null, swatch: 'Down arrow' },
    data_bar: { kind: 'databar', cls: 'rh-rule_databar', swatch: 'Data bar' }
});

const NUMBER_TYPES = new Set(['number', 'currency', 'percent', 'double', 'integer', 'long']);
const ORDERED = new Set(['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal']);
const RELATIVE_DATE = /^TODAY(?:([+-])(\d{1,4}))?$/;

// ================================================================ dates

const dayFormats = new Map(); // one formatter per time zone, made once (see gridFormat formatter)

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function dateIn(instant, timeZone = TIME_ZONE) {
    const parts = {};
    let format = dayFormats.get(timeZone);
    if (!format) {
        format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        dayFormats.set(timeZone, format);
    }
    format.formatToParts(instant).forEach(p => {
        parts[p.type] = p.value;
    });
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(isoDate, days) {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** TODAY, TODAY+N or TODAY-N as a date; anything else unchanged. */
export function resolveDate(value, today) {
    const m = RELATIVE_DATE.exec(String(value));
    if (!m) return value;
    return m[1] ? addDays(today, (m[1] === '-' ? -1 : 1) * Number(m[2])) : today;
}

// ================================================================ compiling

const lower = v => String(v).toLowerCase();
const valuesOf = v =>
    String(v)
        .split(';')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

/**
 * How a rule's type reads a cell's value, and the value it compares with.
 * `ordered` types compare with < and >; the rest only for equality or text.
 */
function reading(rule, context) {
    const type = rule.type || 'text';
    const value = rule.value;
    if (NUMBER_TYPES.has(type)) return { read: v => Number(v), target: Number(value), ordered: true };
    if (type === 'date')
        return { read: v => String(v).slice(0, 10), target: resolveDate(value, context.today), ordered: true };
    if (type === 'datetime') {
        const read = v => {
            const instant = new Date(v);
            return Number.isNaN(instant.getTime()) ? null : dateIn(instant, context.timeZone);
        };
        return { read, target: resolveDate(value, context.today), ordered: true };
    }
    if (type === 'time') {
        // HH:MM:SS on both sides: the server sends 17:30:00, a value written 17:30 is the same time.
        const hms = v => (/^\d{2}:\d{2}$/.test(String(v)) ? `${v}:00` : String(v).slice(0, 8));
        return { read: hms, target: value == null ? value : hms(value), ordered: true };
    }
    if (type === 'checkbox' || type === 'boolean')
        return { read: v => String(v === true || v === 'true'), target: value };
    if (type === 'reference' || type === 'owner') {
        const id = value === '$User' ? context.userId : value;
        return { read: v => String(v).slice(0, 15), target: String(id || '').slice(0, 15) };
    }
    if (type === 'multipicklist') return { read: valuesOf, target: value == null ? null : lower(value), several: true };
    return { read: lower, target: value == null ? null : lower(value) };
}

/**
 * Two fields of one row: each read by its own type, then compared. A
 * date/time is read as its day in the user's time zone, as everywhere in the
 * rules, so a date and a date/time compare by day. A
 * multi-select picklist compares as its set of values, in any order.
 */
function compareFieldsTest(rule, context) {
    const op = rule.operator;
    const left = reading({ ...rule, value: null }, context);
    const right = reading({ ...rule, type: rule.compareType || rule.type, value: null }, context);
    const asSet = x => (Array.isArray(x) ? [...x].sort().join(';') : x);
    const read = (side, v) => asSet(side.read(v));
    const ordered = left.ordered && right.ordered;
    const meets = {
        equals: (a, b) => a === b,
        not_equals: (a, b) => a !== b,
        greater_than: (a, b) => a > b,
        greater_or_equal: (a, b) => a >= b,
        less_than: (a, b) => a < b,
        less_or_equal: (a, b) => a <= b
    }[op];
    if (!meets || (ORDERED.has(op) && !ordered)) return () => false;
    return (v, w) => {
        if (isBlank(v) || isBlank(w)) return op === 'not_equals' && !(isBlank(v) && isBlank(w));
        const a = read(left, v);
        const b = read(right, w);
        if (a === null || b === null || (typeof a === 'number' && (Number.isNaN(a) || Number.isNaN(b)))) return false;
        return meets(a, b);
    };
}

/** The test for one rule: value in, true or false out. */
function testFor(rule, context) {
    const op = rule.operator;
    const isCheckbox = rule.type === 'checkbox' || rule.type === 'boolean';
    const blank = v => !isCheckbox && isBlank(v);
    if (op === 'is_blank') return v => blank(v);
    if (op === 'is_not_blank') return v => !blank(v);
    const { read, target, ordered, several } = reading(rule, context);
    let meets;
    if (op === 'between') {
        if (!ordered) return () => false;
        const upper = reading({ ...rule, value: rule.valueTo }, context).target;
        meets = got => got >= target && got <= upper;
    } else if (several) {
        const wanted = valuesOf(target || '');
        if (op === 'equals' || op === 'not_equals') {
            const same = got => got.length === wanted.length && wanted.every(w => got.includes(w));
            meets = op === 'equals' ? same : got => !same(got);
        } else {
            meets = op === 'contains' ? got => got.includes(target) : got => !got.includes(target);
        }
    } else if (ORDERED.has(op)) {
        if (!ordered) return () => false;
        meets = {
            greater_than: got => got > target,
            greater_or_equal: got => got >= target,
            less_than: got => got < target,
            less_or_equal: got => got <= target
        }[op];
    } else {
        meets = {
            equals: got => got === target,
            not_equals: got => got !== target,
            contains: got => String(got).includes(target),
            not_contains: got => !String(got).includes(target),
            starts_with: got => String(got).startsWith(target)
        }[op];
    }
    if (!meets) return () => false;
    // A blank value meets only the negative tests (does not equal, does not contain).
    const negative = op === 'not_equals' || op === 'not_contains';
    return v => {
        if (blank(v)) return negative;
        const got = read(v);
        // A value the type cannot read (not a number, not a date) meets nothing.
        if (got === null || (typeof got === 'number' && Number.isNaN(got))) return false;
        return meets(got);
    };
}

/**
 * The rules as tests, in order. Rules with a style this grid does not know are
 * left out. `context` is for tests: { today, timeZone, userId }.
 */
export function compileRules(rules, context = {}) {
    const timeZone = context.timeZone || TIME_ZONE;
    const full = {
        timeZone,
        today: context.today || dateIn(new Date(), timeZone),
        userId: context.userId || USER_ID
    };
    return (Array.isArray(rules) ? rules : [])
        .filter(r => r && (r.field || r.isFormula) && STYLES[r.style])
        .map(r => {
            const style = STYLES[r.style];
            let matches;
            let test;
            if (r.isFormula) {
                // Worked out on the server for the saved record.
                test = list => Array.isArray(list) && list.includes(r.name);
                matches = valueOf => test(valueOf('_rules'));
            } else if (r.compareField) {
                const two = compareFieldsTest(r, full);
                test = two;
                matches = valueOf => two(valueOf(r.field), valueOf(r.compareField));
            } else {
                test = testFor(r, full);
                matches = valueOf => test(valueOf(r.field));
            }
            return {
                name: r.name,
                label: r.label || r.name || '',
                field: r.field || null,
                applyTo: r.applyTo === 'row' ? 'row' : 'cell',
                kind: style.kind,
                cls: style.cls || null,
                bar: style.bar || null,
                icon: style.icon || null,
                variant: style.variant || null,
                test,
                matches
            };
        });
}

/**
 * What the rules look like, for the grid's Display Key: one entry
 * per rule, in order, { key, label, cls, bar, row, style }. `cls` is the class
 * a cell rule gives; `bar` the bar a row fill gives.
 */
export function displayKeyFor(rules) {
    return (Array.isArray(rules) ? rules : [])
        .filter(r => r && (r.field || r.isFormula) && STYLES[r.style])
        .map((r, i) => {
            const style = STYLES[r.style];
            const row = r.applyTo === 'row';
            return {
                key: (r.name || 'rule') + ':' + i,
                label: r.label || r.name || '',
                row,
                kind: style.kind,
                cls: row && style.kind === 'fill' ? null : style.cls || null,
                bar: row && style.kind === 'fill' ? style.bar : null,
                icon: style.icon || null,
                variant: style.variant || null,
                style: style.swatch
            };
        });
}

/**
 * How one row is formatted, or null when no rule matches:
 *   cells   { [field]: 'class class' } for the cells of `fields` that take any
 *   labels  { [field]: 'Label, Label' }: the cell rules that formatted each cell
 *   bar     the class of the row's bar (the first matching row fill), or null
 *   rowLabels  the labels of the row rules that took effect, in order
 *   icons   { [field]: { name, variant, label } }: the icon before a cell's
 *           value; a row rule's goes on the first of `fields`
 *   bars    { [field]: true }: the cells that show a data bar
 * `valueOf(field)` gives the value the cell shows ('_rules' the row's formula
 * rules). Each rule is tested once per row.
 */
export function formatsFor(compiled, valueOf, fields) {
    if (!compiled || !compiled.length) return null;
    const matched = compiled.filter(r => r.matches(valueOf));
    if (!matched.length) return null;
    const icons = {};
    const bars = {};
    matched.forEach(r => {
        if (r.kind === 'icon') {
            const target = r.applyTo === 'row' ? fields[0] : r.field;
            if (target && !icons[target]) icons[target] = { name: r.icon, variant: r.variant, label: r.label };
        } else if (r.kind === 'databar' && r.field && !bars[r.field]) {
            bars[r.field] = true;
        }
    });
    const cells = {};
    const labels = {};
    const rowLabels = [];
    const rowUsed = new Set();
    let bar = null;
    matched.forEach(r => {
        if (r.applyTo === 'row' && r.kind === 'fill' && !bar) {
            bar = r.bar;
            rowUsed.add(r);
        }
    });
    fields.forEach(field => {
        const taken = {};
        const classes = [];
        const names = [];
        matched.forEach(r => {
            if (r.applyTo === 'row' && r.kind === 'fill') return; // a row's fill is its bar
            if (r.kind === 'icon' || r.kind === 'databar') return; // icons and bars, above
            if ((r.applyTo === 'row' || r.field === field) && !taken[r.kind]) {
                taken[r.kind] = true;
                classes.push(r.cls);
                if (r.applyTo === 'row') rowUsed.add(r);
                else if (r.label) names.push(r.label);
            }
        });
        if (classes.length) cells[field] = classes.join(' ');
        if (names.length) labels[field] = names.join(', ');
    });
    matched.forEach(r => {
        if (rowUsed.has(r) && r.label && !rowLabels.includes(r.label)) rowLabels.push(r.label);
    });
    if (!Object.keys(cells).length && !bar && !Object.keys(icons).length && !Object.keys(bars).length) return null;
    return { cells, labels, bar, rowLabels, icons, bars };
}
