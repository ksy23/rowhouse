/**
 * gridGroups — grouping and subtotals in the browser. Plain functions
 * over plain objects, no DOM (HR-28).
 *
 * THE GROUPING
 * Up to three levels, outermost first: [{ field, unit }], unit being day,
 * week, month, quarter, year, fiscal_quarter or fiscal_year for a date or
 * date/time column and null otherwise (week and the fiscal units since).
 * The server takes each level as "Field__c" or "Field__c:month" (levelParam).
 *
 * KEYS
 * A row belongs, at each level, to the group with its key. keyFor gives the
 * same key GridGroupService gives that group, so a group's rows (grouped here,
 * from the rows loaded) and its count and subtotals (from the server, over
 * every matching record) find each other:
 *   date        2026-09-28, 2026-09, 2026-Q3 or 2026, by the unit; a week
 *               is the date it starts on (the first day of the week in the
 *               user's locale), a fiscal quarter FY2026-Q3 and a fiscal year
 *               FY2026, by the org's fiscal year (fiscalOf)
 *   date/time   the same, of its date in the user's time zone
 *   checkbox    true or false
 *   lookup      the record Id, 18 characters
 *   text        the value trimmed and in lower case: SOQL groups text without
 *               regard to case or trailing spaces
 *   blank       '' (the server's null)
 *
 * THE VIEW
 * buildView turns the rows, in the user's sort order, into what the table
 * renders: each group's header row, then (unless the group is collapsed) its
 * sub-groups or its rows. Rows are gathered into their groups, so a group is
 * never split, and keep the user's order within it. The groups at each level
 * are then put in order as a Salesforce report puts them: a picklist in the
 * order of the field's values (Prospecting before Closed Won, not
 * alphabetically; a stored value no longer in the list after them), a date by
 * its period, a number by its size, a lookup by its record's name, text
 * alphabetically; in the direction the user sorted that column (ascending
 * otherwise), blank last. A header row is a synthetic row whose key field
 * holds a stable, opaque id and whose __group describes the group.
 *
 * GROUP ORDER
 * By name, as above, unless the user orders a grouping's groups by their
 * record count or by a column's subtotal, largest or smallest first: the
 * groups at every level, each among its siblings. Blank stays last; groups
 * that tie keep their order by name.
 *
 * SUBTOTALS
 * The server returns the deepest level only, from one call or from several
 * slices of a large list. rollUp adds them up into every level and the Total:
 * sums add exactly, as decimal strings; counts add; mins and maxes compare;
 * an average is the sum over the count. withDrafts then adds the grid's
 * unsaved edits in, so a subtotal follows an edit before it is saved.
 */
import LOCALE from '@salesforce/i18n/locale';
import TIME_ZONE from '@salesforce/i18n/timeZone';
import FIRST_DAY_OF_WEEK from '@salesforce/i18n/firstDayOfWeek';
import {
    isBlank,
    isNumericType,
    formatValue,
    totalColumn,
    currencyFor,
    formatDate,
    formatCount,
    picklistLabel,
    compareValues
} from 'c/gridFormat';
import { isLookup } from 'c/gridFields';
import { firstDayFromSalesforce } from 'c/gridCalendar';

export const MAX_LEVELS = 3;
export const DATE_UNITS = ['day', 'week', 'month', 'quarter', 'year', 'fiscal_quarter', 'fiscal_year'];
export const UNIT_LABELS = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    quarter: 'Quarter',
    year: 'Year',
    fiscal_quarter: 'Fiscal quarter',
    fiscal_year: 'Fiscal year'
};
/** The first day of the week in the user's locale, 0 for Sunday, as Date.toStartOfWeek takes it on the server. */
const FIRST_DAY = firstDayFromSalesforce(FIRST_DAY_OF_WEEK);
/** Shown before a subtotal in its cell. */
export const SUBTOTAL_SHORT = { sum: 'Sum', average: 'Avg', min: 'Min', max: 'Max', count: 'Count' };
/** Read out with a subtotal. */
export const SUBTOTAL_NAMES = { sum: 'Sum', average: 'Average', min: 'Min', max: 'Max', count: 'Count' };
export const BLANK_LABEL = '(blank)';
/** Joins a group's keys into its path; a control character, so no value contains it. */
const SEP = String.fromCharCode(31);
/** What joins a group's keys into a path (rollUp's byPath). */
export const PATH_SEP = SEP;
const DECIMAL_RE = /^[-+]?\d+(\.\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function isDateColumn(column) {
    return Boolean(column) && (column.type === 'date' || column.type === 'datetime');
}

function isCheckbox(column) {
    return Boolean(column) && (column.type === 'checkbox' || column.type === 'boolean');
}

/** One level as the server takes it. */
export function levelParam(level) {
    return level.unit ? `${level.field}:${level.unit}` : level.field;
}

/**
 * The grouping, checked against the columns: groupable columns only, each
 * once, at most three; a date gets a unit (month when it has none), anything
 * else has none. Returns a new array.
 */
export function normalizeGrouping(grouping, columns) {
    const byField = new Map((columns || []).map(c => [c.field, c]));
    const out = [];
    (grouping || []).forEach(level => {
        const field = level && level.field;
        const column = byField.get(field);
        if (!column || column.groupable !== true || out.length >= MAX_LEVELS || out.some(l => l.field === field))
            return;
        const unit = isDateColumn(column) ? (DATE_UNITS.includes(level.unit) ? level.unit : 'month') : null;
        out.push({ field, unit });
    });
    return out;
}

export function sameGrouping(a, b) {
    const x = a || [];
    const y = b || [];
    return (
        x.length === y.length && x.every((l, i) => l.field === y[i].field && (l.unit || null) === (y[i].unit || null))
    );
}

// ------------------------------------------------------------------ keys

const dayFormats = new Map();
/** The calendar date of an instant in a time zone, as 2026-09-28. */
function localDate(value, timeZone) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return '';
    let format = dayFormats.get(timeZone);
    if (!format) {
        format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        dayFormats.set(timeZone, format);
    }
    const parts = {};
    format.formatToParts(instant).forEach(p => {
        parts[p.type] = p.value;
    });
    return `${parts.year}-${parts.month}-${parts.day}`;
}

const pad2 = n => String(n).padStart(2, '0');

/** The date a week starts on, for a date: the first day of the week on or before it. */
export function weekStart(isoDate, firstDay = FIRST_DAY) {
    const m = DATE_RE.exec(isoDate);
    if (!m) return '';
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() - firstDay + 7) % 7));
    return `${String(day.getUTCFullYear()).padStart(4, '0')}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
}

/**
 * A date's fiscal year and quarter, { year, quarter }, as SOQL's FISCAL_YEAR
 * and FISCAL_QUARTER give them. `fiscal` is the server's account of
 * the org's fiscal year (GridGroupService.fiscalCalendarFor): the years and
 * quarters the org has defined, and outside them the start month (1 for
 * January) and whether a fiscal year is named after the calendar year it
 * starts in (else the one it ends in, Salesforce's default).
 */
export function fiscalOf(isoDate, fiscal) {
    const day = isoDate.slice(0, 10);
    const periods = fiscal && Array.isArray(fiscal.periods) ? fiscal.periods : [];
    const within = type => periods.find(p => p && p.type === type && p.start <= day && day <= p.end);
    const year = within('year');
    if (year && year.name) {
        const quarter = within('quarter');
        return { year: String(year.name), quarter: quarter ? Number(quarter.number) : null };
    }
    const start =
        fiscal && Number(fiscal.startMonth) >= 1 && Number(fiscal.startMonth) <= 12 ? Number(fiscal.startMonth) : 1;
    const y = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    const startYear = month >= start ? y : y - 1;
    // A year that starts in January ends in the same year; any other ends in the next.
    const endYear = start === 1 ? startYear : startYear + 1;
    return {
        year: String(fiscal && fiscal.nameByStart === true ? startYear : endYear),
        quarter: Math.floor(((month - start + 12) % 12) / 3) + 1
    };
}

function unitKey(isoDate, unit, fiscal) {
    const year = isoDate.slice(0, 4);
    const month = isoDate.slice(5, 7);
    switch (unit) {
        case 'day':
            return isoDate.slice(0, 10);
        case 'week':
            return weekStart(isoDate.slice(0, 10));
        case 'fiscal_quarter':
        case 'fiscal_year': {
            const f = fiscalOf(isoDate, fiscal);
            if (unit === 'fiscal_year') return `FY${f.year}`;
            return f.quarter ? `FY${f.year}-Q${f.quarter}` : `FY${f.year}`;
        }
        case 'quarter':
            return `${year}-Q${Math.floor((Number(month) - 1) / 3) + 1}`;
        case 'year':
            return year;
        default:
            return `${year}-${month}`;
    }
}

/** The key a value groups under at one level; '' for blank. `fiscal`: see fiscalOf. */
export function keyFor(value, column, unit, timeZone = TIME_ZONE, fiscal = null) {
    if (isCheckbox(column)) return value === true || value === 'true' ? 'true' : 'false';
    if (isBlank(value)) return '';
    const type = (column && column.type) || 'text';
    if (type === 'date') {
        const m = DATE_RE.exec(String(value));
        return m ? unitKey(m[0], unit, fiscal) : '';
    }
    if (type === 'datetime') {
        const day = localDate(value, timeZone);
        return day ? unitKey(day, unit, fiscal) : '';
    }
    if (isLookup(type)) return String(value);
    return String(value).trim().toLowerCase();
}

/** A key the server sent, in the form keyFor gives. */
export function serverKey(key, column) {
    if (isCheckbox(column)) return String(key) === 'true' ? 'true' : 'false';
    if (key === null || key === undefined) return '';
    if (isDateColumn(column) || isLookup(column && column.type)) return String(key);
    return String(key).trim().toLowerCase();
}

// ------------------------------------------------------------------ labels

let monthFormat;
/**
 * What a group is called: "September 2026", "Q3 2026", "Week of 9/27/2026",
 * "Q3 FY 2026", "FY 2026", a record's name, a picklist label.
 */
export function groupLabel(key, column, unit, { sample, names, serverLabel } = {}) {
    if (isCheckbox(column)) return key === 'true' ? 'Checked' : 'Not checked';
    if (key === '') return BLANK_LABEL;
    if (isDateColumn(column)) {
        if (unit === 'day') return formatDate(key);
        if (unit === 'week') return `Week of ${formatDate(key)}`;
        if (unit === 'fiscal_year') return `FY ${key.slice(2)}`;
        if (unit === 'fiscal_quarter') {
            const m = /^FY(.+)-Q(\d)$/.exec(key);
            return m ? `Q${m[2]} FY ${m[1]}` : `FY ${key.slice(2)}`;
        }
        if (unit === 'year') return key;
        if (unit === 'quarter') return `Q${key.slice(-1)} ${key.slice(0, 4)}`;
        if (!monthFormat)
            monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return monthFormat.format(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
    }
    if (isLookup(column.type)) return (names && names[key]) || serverLabel || key;
    if (column.type === 'picklist') {
        const option = (column.options || []).find(o => String(o.value).toLowerCase() === key);
        return option ? option.label : picklistLabel(sample === undefined ? key : sample, column.options);
    }
    return sample === undefined || isBlank(sample) ? key : String(sample).trim();
}

// ------------------------------------------------------------------ the view

/** A stable, opaque id for a group: its level and a hash of its path (FNV-1a). */
function hashPath(path) {
    let h = 0x811c9dc5;
    for (let i = 0; i < path.length; i++) {
        h ^= path.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

/**
 * What the table renders for a grouped grid: { items, headers, numbers }.
 *
 *   rows      the rows, in the user's sort order
 *   levels    the grouping (normalizeGrouping)
 *   options   { columns, keyField, collapsed: { [id]: true }, totals: rollUp's
 *               answer or null, names: { [recordId]: name }, sortKeys: the
 *               user's [{ field, direction }], timeZone, fiscal (fiscalOf),
 *               order: the groups' order (GROUP ORDER, normalizeOrder),
 *               numbered: true for row numbers }
 *
 * items: header rows ({ [keyField]: id, __group }) and the rows of expanded
 * groups, in order. headers: Map of id to header, whether shown or not.
 * numbers: with numbered, a Map of each row's id (as a string) to its row
 * number, 1 up, in the order shown, counting straight through the groups.
 * A collapsed group's rows keep their numbers, so the rows after it keep
 * theirs too. Without numbered, null.
 * A header: { id, path, level, key, field, unit, label, columnLabel, loaded
 * (rows loaded), count and values (the server's, or null), edited and unknown
 * (withDrafts), expanded, parentId }.
 */
export function buildView(
    rows,
    levels,
    {
        columns = [],
        keyField = 'Id',
        collapsed = {},
        totals = null,
        names = {},
        sortKeys = [],
        timeZone = TIME_ZONE,
        fiscal = null,
        order = null,
        numbered = false
    } = {}
) {
    const headers = new Map();
    if (!levels || !levels.length)
        return { items: rows, headers, numbers: numbered ? numberRows(rows, keyField) : null };
    const byField = new Map(columns.map(c => [c.field, c]));
    const cols = levels.map(l => byField.get(l.field) || { field: l.field, type: 'text' });
    const root = { children: new Map(), order: [] };
    rows.forEach(row => {
        let node = root;
        let path = '';
        levels.forEach((level, i) => {
            const key = keyFor(row[level.field], cols[i], level.unit, timeZone, fiscal);
            path = i ? path + SEP + key : key;
            let child = node.children.get(key);
            if (!child) {
                child = {
                    key,
                    path,
                    level: i + 1,
                    sample: row[level.field],
                    children: new Map(),
                    order: [],
                    rows: [],
                    loaded: 0
                };
                node.children.set(key, child);
                node.order.push(child);
            }
            child.loaded++;
            node = child;
        });
        node.rows.push(row);
    });
    arrangeGroups(root, levels, cols, names, sortKeys, normalizeOrder(order, columns), totals, columns);

    const idPaths = new Map();
    const items = [];
    const walk = (node, parentId) => {
        node.order.forEach(g => {
            let id = `__g${g.level}_${hashPath(g.path)}`;
            while (idPaths.has(id) && idPaths.get(id) !== g.path) id += '_';
            idPaths.set(id, g.path);
            const level = levels[g.level - 1];
            const column = cols[g.level - 1];
            const agg = totals && totals.byPath ? totals.byPath.get(g.path) : null;
            const header = {
                id,
                path: g.path,
                level: g.level,
                key: g.key,
                field: level.field,
                unit: level.unit,
                label: groupLabel(g.key, column, level.unit, {
                    sample: g.sample,
                    names,
                    serverLabel: agg ? agg.label : null
                }),
                columnLabel: column.label || column.field,
                loaded: g.loaded,
                count: agg ? agg.count : null,
                values: agg ? agg.values : null,
                // Columns whose figure an unsaved edit moved, or left unknown until saved.
                edited: agg && agg.edited ? agg.edited : null,
                unknown: agg && agg.unknown ? agg.unknown : null,
                expanded: !collapsed[id],
                parentId
            };
            headers.set(id, header);
            items.push({ [keyField]: id, __group: header });
            if (!header.expanded) return;
            if (g.order.length) walk(g, id);
            else g.rows.forEach(r => items.push(r));
        });
    };
    walk(root, null);
    let numbers = null;
    if (numbered) {
        // Every group, collapsed or not, in the order shown.
        numbers = new Map();
        const number = node =>
            node.order.forEach(g => {
                if (g.order.length) number(g);
                else g.rows.forEach(r => numbers.set(String(r[keyField]), numbers.size + 1));
            });
        number(root);
    }
    return { items, headers, numbers };
}

/** Ungrouped: each row's number is its place in the list, 1 up. */
function numberRows(rows, keyField) {
    const numbers = new Map();
    rows.forEach((r, i) => numbers.set(String(r[keyField]), i + 1));
    return numbers;
}

/**
 * Put each level's groups in order (see THE VIEW). The sort is stable, so
 * groups that compare equal keep the order they first appeared in.
 *
 * A picklist's groups follow the field's own order of values, as Salesforce's
 * reports do and as SOQL's ORDER BY does, so the rows the server sends for a
 * grouped grid (GridDataService orders by the group fields) arrive in the
 * same order as the groups (alphabetical would put Closed Won before
 * Prospecting).
 */
function arrangeGroups(root, levels, cols, names, sortKeys, order, totals, allColumns) {
    const directions = new Map((sortKeys || []).map(k => [k.field, k.direction]));
    const byMeasure = order.by !== 'name' ? measureCompare(order, totals, allColumns) : null;
    const ranks = cols.map(column => (column && column.type === 'picklist' ? picklistRanks(column) : null));
    const valueOf = (g, column) => {
        if (isCheckbox(column)) return g.key === 'true';
        if (g.key === '') return null; // blank: last, whichever the direction
        if (isDateColumn(column)) return g.key; // 2026-Q3 and the like order as text
        if (isLookup(column.type)) return names[g.key] || g.key;
        return g.sample;
    };
    const typeOf = column => {
        if (isDateColumn(column)) return 'date';
        if (isCheckbox(column)) return 'checkbox';
        return isNumericType(column.type) ? column.type : 'text';
    };
    const arrange = node => {
        if (!node.order.length) return;
        const i = node.order[0].level - 1;
        const column = cols[i];
        const direction = directions.get(levels[i].field) === 'desc' ? 'desc' : 'asc';
        const byName = ranks[i]
            ? (a, b) => comparePicklistGroups(a, b, ranks[i], direction)
            : (a, b) => compareValues(valueOf(a, column), valueOf(b, column), typeOf(column), direction);
        // By a count or a subtotal: blank still last, ties by name.
        const compare = byMeasure
            ? (a, b) => {
                  if (a.key === '' || b.key === '') return a.key === b.key ? 0 : a.key === '' ? 1 : -1;
                  return byMeasure(a, b) || byName(a, b);
              }
            : byName;
        node.order.sort(compare);
        node.order.forEach(arrange);
    };
    arrange(root);
}

/**
 * How the user orders the groups, checked against the columns:
 * { by: 'name' | 'count' | a column with a subtotal, direction: 'asc' |
 * 'desc' }. By name follows each grouped column's sort, as before; by a count
 * or a subtotal, largest first unless asked otherwise.
 */
export function normalizeOrder(order, columns) {
    const by = order && typeof order.by === 'string' ? order.by : 'name';
    if (by === 'name') return { by: 'name', direction: 'asc' };
    if (by !== 'count' && !(columns || []).some(c => c.field === by && c.subtotal))
        return { by: 'name', direction: 'asc' };
    return { by, direction: order.direction === 'asc' ? 'asc' : 'desc' };
}

/** Two groups by their count or a column's subtotal, from the server's figures; 0 when either has none. */
function measureCompare(order, totals, columns) {
    const byPath = totals && totals.byPath ? totals.byPath : null;
    const column = (columns || []).find(c => c.field === order.by) || null;
    const sign = order.direction === 'asc' ? 1 : -1;
    const measure = g => {
        const agg = byPath ? byPath.get(g.path) : null;
        if (order.by === 'count') return agg ? agg.count : g.loaded;
        const sub = agg && column ? subtotalFor(agg, column) : null;
        return sub ? sub.value : null;
    };
    return (a, b) => {
        const x = measure(a);
        const y = measure(b);
        // A group with no figure goes after those with one.
        if (isBlank(x) || isBlank(y)) return isBlank(x) === isBlank(y) ? 0 : isBlank(x) ? 1 : -1;
        return sign * compareAgg(typeof x === 'number' ? String(x) : x, typeof y === 'number' ? String(y) : y);
    };
}

/** { [group key]: position } for a picklist's values, in the field's order. */
function picklistRanks(column) {
    const ranks = new Map();
    (column.options || []).forEach(o => {
        const key = String(o.value).trim().toLowerCase();
        if (!ranks.has(key)) ranks.set(key, ranks.size);
    });
    return ranks;
}

/**
 * Two picklist groups: by the field's order of values; a stored value no
 * longer in the list after every value that is, by its text; blank last,
 * whichever the direction.
 */
function comparePicklistGroups(a, b, ranks, direction) {
    if (a.key === '' || b.key === '') return a.key === b.key ? 0 : a.key === '' ? 1 : -1;
    const ra = ranks.has(a.key) ? ranks.get(a.key) : ranks.size;
    const rb = ranks.has(b.key) ? ranks.get(b.key) : ranks.size;
    const c = ra !== rb ? Math.sign(ra - rb) : ra === ranks.size ? compareValues(a.sample, b.sample, 'text') : 0;
    return direction === 'desc' ? -c : c;
}

// ------------------------------------------------------------------ subtotals

function fraction(s) {
    const i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
}

/*
 * Exact decimal arithmetic on digit strings. BigInt would be shorter, but
 * Lightning Locker does not provide it, and Rowhouse runs under Locker too.
 * A decimal string becomes { negative, digits }: its digits with the point
 * removed after padding the fraction to `scale` places, leading zeros dropped
 * ('' is zero).
 */
function scaled(s, scale) {
    const negative = s.startsWith('-');
    const [whole, frac = ''] = s.replace(/^[-+]/, '').split('.');
    const digits = (whole + frac.padEnd(scale, '0')).replace(/^0+/, '');
    return { negative: negative && digits !== '', digits };
}

/** Compare two digit strings without leading zeros, by size. */
function compareDigits(a, b) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a === b ? 0 : a < b ? -1 : 1;
}

/** a + b, both digit strings. */
function addDigits(a, b) {
    let out = '';
    let carry = 0;
    for (let i = a.length - 1, j = b.length - 1; i >= 0 || j >= 0 || carry; i--, j--) {
        const d = (i >= 0 ? a.charCodeAt(i) - 48 : 0) + (j >= 0 ? b.charCodeAt(j) - 48 : 0) + carry;
        out = (d % 10) + out;
        carry = d >= 10 ? 1 : 0;
    }
    return out.replace(/^0+/, '');
}

/** a - b, both digit strings, a not smaller than b. */
function subtractDigits(a, b) {
    let out = '';
    let borrow = 0;
    for (let i = a.length - 1, j = b.length - 1; i >= 0; i--, j--) {
        let d = a.charCodeAt(i) - 48 - (j >= 0 ? b.charCodeAt(j) - 48 : 0) - borrow;
        borrow = d < 0 ? 1 : 0;
        if (d < 0) d += 10;
        out = d + out;
    }
    return out.replace(/^0+/, '');
}

/** Two signed scaled values compared by number. */
function compareScaled(x, y) {
    if (x.negative !== y.negative) return x.negative ? -1 : 1;
    const c = compareDigits(x.digits, y.digits);
    return x.negative ? -c : c;
}

/** a + b, exactly, for decimal strings such as the server sends. */
export function addDecimal(a, b) {
    if (isBlank(a)) return isBlank(b) ? null : String(b);
    if (isBlank(b)) return String(a);
    const x = String(a).trim();
    const y = String(b).trim();
    if (!DECIMAL_RE.test(x) || !DECIMAL_RE.test(y)) return String(Number(x) + Number(y));
    const scale = Math.max(fraction(x), fraction(y));
    const p = scaled(x, scale);
    const q = scaled(y, scale);
    let digits;
    let negative;
    if (p.negative === q.negative) {
        digits = addDigits(p.digits, q.digits);
        negative = p.negative;
    } else {
        const c = compareDigits(p.digits, q.digits);
        digits = c >= 0 ? subtractDigits(p.digits, q.digits) : subtractDigits(q.digits, p.digits);
        negative = c >= 0 ? p.negative : q.negative;
    }
    if (digits === '') negative = false;
    let text = digits.padStart(scale + 1, '0');
    if (scale) text = text.slice(0, -scale) + '.' + text.slice(-scale);
    return (negative ? '-' : '') + text;
}

/** Compare two subtotal values: decimal strings by number, dates and date/times as ISO text. */
function compareAgg(a, b) {
    const x = String(a);
    const y = String(b);
    if (DECIMAL_RE.test(x) && DECIMAL_RE.test(y)) {
        const scale = Math.max(fraction(x), fraction(y));
        return compareScaled(scaled(x, scale), scaled(y, scale));
    }
    return x === y ? 0 : x < y ? -1 : 1;
}

function addValues(into, from) {
    Object.keys(from || {}).forEach(field => {
        const v = from[field] || {};
        const acc = into[field] || (into[field] = { s: null, c: 0, mn: null, mx: null });
        if (!isBlank(v.s)) acc.s = addDecimal(acc.s, v.s);
        if (v.c !== undefined && v.c !== null) acc.c += Number(v.c);
        if (!isBlank(v.mn) && (acc.mn === null || compareAgg(v.mn, acc.mn) < 0)) acc.mn = v.mn;
        if (!isBlank(v.mx) && (acc.mx === null || compareAgg(v.mx, acc.mx) > 0)) acc.mx = v.mx;
    });
}

/**
 * The server's deepest groups, from every slice, added up into every level
 * and the Total: { byPath: Map of path to { count, values, label }, total:
 * { count, values } }. A path joins a group's keys, as buildView makes them.
 */
export function rollUp(groups, levels, columns) {
    const byField = new Map((columns || []).map(c => [c.field, c]));
    const cols = (levels || []).map(l => byField.get(l.field) || { field: l.field, type: 'text' });
    const byPath = new Map();
    const total = { count: 0, values: {} };
    (groups || []).forEach(g => {
        const n = Number(g.n) || 0;
        const keys = Array.isArray(g.k) ? g.k : [];
        const labels = g.l || [];
        total.count += n;
        addValues(total.values, g.v);
        // One key per level, or the group cannot be placed: it counts in the
        // Total only, never under another group. (Lightning drops null list
        // elements on the way here; the server sends a blank as '' for that.)
        if (keys.length !== cols.length) return;
        let path = '';
        keys.forEach((raw, i) => {
            const key = serverKey(raw, cols[i]);
            path = i ? path + SEP + key : key;
            let entry = byPath.get(path);
            if (!entry) {
                entry = { count: 0, values: {}, label: null };
                byPath.set(path, entry);
            }
            entry.count += n;
            if (labels[i] && !entry.label) entry.label = labels[i];
            addValues(entry.values, g.v);
        });
    });
    return { byPath, total };
}

/** -x, for a decimal string. */
function negate(x) {
    const t = String(x).trim();
    return t.startsWith('-') ? t.slice(1) : '-' + t.replace(/^\+/, '');
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The server's counts and subtotals (rollUp's answer) with the grid's unsaved
 * edits added in, so a subtotal follows an edit before it is saved.
 * Returns a new answer; the server's is not changed. Each group (and the
 * Total) that an edit moved names the column in `edited`, so the grid can
 * mark the figure as unsaved, as it marks the edited cell.
 *
 * A row counts in the groups of its saved values: an unsaved edit to a
 * grouped column does not move the row. Sums, counts and averages
 * follow an edit exactly. A lowest or highest value follows an edit that goes
 * past it; when the edit takes away the value that was the lowest or highest,
 * the new one is worked out from the rows in hand if every row is loaded
 * (`complete`), and is otherwise not known until the save: the group then
 * names the column in `unknown` and keeps the saved figure.
 *
 *   options   { keyField, timeZone, fiscal, complete }
 */
export function withDrafts(
    totals,
    rows,
    drafts,
    levels,
    columns,
    { keyField = 'Id', timeZone = TIME_ZONE, fiscal = null, complete = false } = {}
) {
    if (!totals || !drafts || !Object.keys(drafts).length) return totals;
    const subtotalled = (columns || []).filter(c => c.subtotal);
    if (!subtotalled.length) return totals;
    const byField = new Map((columns || []).map(c => [c.field, c]));
    const cols = (levels || []).map(l => byField.get(l.field) || { field: l.field, type: 'text' });
    const copies = new Map(); // path ('' for the Total) -> its copy
    const copyOf = path => {
        let entry = copies.get(path);
        if (!entry) {
            const from = path === null ? totals.total : totals.byPath.get(path);
            if (!from) return null;
            const values = {};
            Object.keys(from.values || {}).forEach(f => {
                values[f] = { ...from.values[f] };
            });
            entry = { ...from, values, edited: { ...(from.edited || {}) }, unknown: { ...(from.unknown || {}) } };
            copies.set(path, entry);
        }
        return entry;
    };
    const pathsOf = row => {
        const out = [null];
        let path = '';
        levels.forEach((level, i) => {
            const key = keyFor(row[level.field], cols[i], level.unit, timeZone, fiscal);
            path = i ? path + SEP + key : key;
            out.push(path);
        });
        return out;
    };
    const recompute = new Set(); // "field" whose lowest or highest must be worked out again
    (rows || []).forEach(row => {
        const d = drafts[row[keyField]];
        if (!d) return;
        const changed = subtotalled.filter(c => has(d, c.field) && !sameValue(d[c.field], row[c.field]));
        if (!changed.length) return;
        const paths = pathsOf(row);
        changed.forEach(c => {
            const before = row[c.field];
            const after = d[c.field];
            // In an org with more than one currency a total is in the corporate
            // currency, each record converted at rates the browser does not
            // have: an amount in another currency cannot be added in until it
            // is saved, and lowest and highest cannot be worked out from rows
            // in different currencies.
            const mixed = Boolean(c.totalCurrency || c.currencyField || c.currencyCode) && c.subtotal !== 'count';
            const foreign = mixed && currencyFor(c, row).code !== c.totalCurrency;
            paths.forEach(path => {
                const entry = copyOf(path);
                if (!entry) return;
                entry.edited[c.field] = true;
                if (foreign) {
                    entry.unknown[c.field] = true;
                    return;
                }
                const v = entry.values[c.field] || (entry.values[c.field] = { s: null, c: 0, mn: null, mx: null });
                applyEdit(v, c.subtotal, before, after, () => {
                    if (complete && !mixed) recompute.add(c.field);
                    else entry.unknown[c.field] = true;
                });
            });
        });
    });
    if (!copies.size) return totals;
    if (recompute.size)
        lowestAndHighest(
            copies,
            rows,
            drafts,
            subtotalled.filter(c => recompute.has(c.field)),
            pathsOf,
            keyField
        );
    const byPath = new Map(totals.byPath);
    copies.forEach((entry, path) => {
        if (path !== null) byPath.set(path, entry);
    });
    return { byPath, total: copies.get(null) || totals.total };
}

/** The same value, as the grid stores it: 5 and "5.00" are; '' and null are. */
function sameValue(a, b) {
    if (isBlank(a) || isBlank(b)) return isBlank(a) === isBlank(b);
    const x = String(a).trim();
    const y = String(b).trim();
    return x === y || (DECIMAL_RE.test(x) && DECIMAL_RE.test(y) && compareAgg(x, y) === 0);
}

/** One edit, from `before` to `after`, into one group's { s, c, mn, mx } for a column's kind of subtotal. */
function applyEdit(v, kind, before, after, lost) {
    const was = isBlank(before) ? null : String(before).trim();
    const now = isBlank(after) ? null : String(after).trim();
    if (kind === 'sum' || kind === 'average') {
        let s = v.s;
        if (now !== null) s = addDecimal(s, now);
        if (was !== null) s = addDecimal(s, negate(was));
        v.s = s;
    }
    if (kind === 'average' || kind === 'count') {
        v.c = Number(v.c || 0) + (now !== null ? 1 : 0) - (was !== null ? 1 : 0);
    }
    if (kind === 'min' || kind === 'max') {
        const key = kind === 'min' ? 'mn' : 'mx';
        const better = (x, y) => (kind === 'min' ? compareAgg(x, y) < 0 : compareAgg(x, y) > 0);
        if (now !== null && (isBlank(v[key]) || better(now, v[key]))) v[key] = now;
        else if (
            was !== null &&
            !isBlank(v[key]) &&
            compareAgg(was, v[key]) === 0 &&
            (now === null || better(was, now))
        )
            lost();
    }
}

/** Every changed group's lowest and highest of these columns, worked out from the rows in hand. */
function lowestAndHighest(copies, rows, drafts, columns, pathsOf, keyField) {
    const fresh = new Map();
    (rows || []).forEach(row => {
        const d = drafts[row[keyField]];
        pathsOf(row).forEach(path => {
            if (!copies.has(path)) return;
            columns.forEach(c => {
                const raw = d && has(d, c.field) ? d[c.field] : row[c.field];
                if (isBlank(raw)) return;
                const value = String(raw).trim();
                const k = `${path === null ? '#' : 'g' + path}${SEP}${c.field}`;
                const acc = fresh.get(k) || { mn: null, mx: null };
                if (acc.mn === null || compareAgg(value, acc.mn) < 0) acc.mn = value;
                if (acc.mx === null || compareAgg(value, acc.mx) > 0) acc.mx = value;
                fresh.set(k, acc);
            });
        });
    });
    copies.forEach((entry, path) => {
        columns.forEach(c => {
            if (!entry.edited[c.field]) return;
            const acc = fresh.get(`${path === null ? '#' : 'g' + path}${SEP}${c.field}`) || { mn: null, mx: null };
            const v = entry.values[c.field] || (entry.values[c.field] = {});
            if (c.subtotal === 'min') v.mn = acc.mn;
            else v.mx = acc.mx;
            delete entry.unknown[c.field];
        });
    });
}

/**
 * A group's share of the whole list: its count, or its subtotal of a
 * column summed or counted, as a percentage of the Total's; null when there
 * is none to give (an average, a lowest, a highest, or a total of nothing).
 */
export function shareOf(aggregate, total, column) {
    if (!aggregate || !total) return null;
    let part;
    let whole;
    if (!column) {
        part = Number(aggregate.count);
        whole = Number(total.count);
    } else {
        const kind = column.subtotal;
        if (kind !== 'sum' && kind !== 'count') return null;
        const a = subtotalFor(aggregate, column);
        const t = subtotalFor(total, column);
        part = a ? Number(a.value) : NaN;
        whole = t ? Number(t.value) : NaN;
    }
    if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null;
    return part / whole;
}

/** "42%", in the user's locale; under 1% shows as "<1%", never "0%" for a group that has something. */
export function shareText(share) {
    if (share === null || share === undefined || !Number.isFinite(share)) return '';
    const pct = share * 100;
    if (pct > 0 && pct < 1) return '<' + formatPercent(0.01);
    return formatPercent(Math.round(pct) / 100);
}

let percentFormat;
function formatPercent(part) {
    if (!percentFormat) percentFormat = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 });
    return percentFormat.format(part);
}

/**
 * One column's subtotal from an aggregate ({ values }): { kind, value, text },
 * or null when the column has none. An average shows two decimal places at
 * least, so the average of whole numbers is not rounded to one.
 */
export function subtotalFor(aggregate, column) {
    const kind = column && column.subtotal;
    const v = kind && aggregate && aggregate.values ? aggregate.values[column.field] : null;
    if (!v) return null;
    let value;
    switch (kind) {
        case 'sum':
            value = v.s;
            break;
        case 'average':
            value = v.c && !isBlank(v.s) ? Number(v.s) / v.c : null;
            break;
        case 'min':
            value = v.mn;
            break;
        case 'max':
            value = v.mx;
            break;
        default:
            value = v.c;
    }
    return { kind, value, text: subtotalText(value, kind, column) };
}

export function subtotalText(value, kind, column) {
    if (isBlank(value)) return '';
    if (kind === 'count') return formatCount(Number(value));
    // In an org with more than one currency, a total is in the corporate one.
    const col = totalColumn(column);
    if (kind === 'average' && isNumericType(col.type)) {
        const own = Number.isInteger(col.scale) ? col.scale : 0;
        return formatValue(value, { ...col, scale: col.type === 'currency' ? own : Math.max(own, 2) });
    }
    return formatValue(value, col);
}

/** "12 records", in the user's locale. */
export function recordsText(count) {
    return `${formatCount(count)} ${count === 1 ? 'record' : 'records'}`;
}
