/**
 * gridClipboard — tab-separated text in and out, and reading a pasted value by
 * its column's type. Plain functions: no DOM, no events, no state (HR-25).
 * docs/spreadsheet.md gives the rules and the reasons.
 *
 * WHAT COPY WRITES
 * Tab-separated text, the format Excel and Google Sheets paste natively.
 *   numbers    plain: the user's decimal separator, no grouping, no currency
 *              symbol, rounded to the field's scale as displayed;
 *              percent with a trailing % so a spreadsheet reads 50% as 50%
 *   dates      ISO, 2026-09-29, which spreadsheets read as a date in any locale
 *   checkboxes TRUE or FALSE
 *   picklists  the label, as shown
 *   text       as stored, with a formula prefix neutralised exactly as CSV
 *              export does (TC-019/020): =, +, -, @ at the start gets a
 *              leading apostrophe, so Excel shows it as text instead of running it
 *
 * WHAT PASTE READS
 * The same forms, and the forms spreadsheets write: grouped numbers,
 * currency symbols, accounting negatives "(1,234.00)", dates in the user's
 * locale order, yes/no and 1/0 for checkboxes, picklist labels or values. The
 * one leading apostrophe that copy added is removed again, so a copy inside the
 * grid round-trips exactly.
 */
import LOCALE from '@salesforce/i18n/locale';
import TIME_ZONE from '@salesforce/i18n/timeZone';
import { neutralise } from 'c/gridCsv';
import { parseTimeText, timeValue, zonedToInstant } from 'c/gridCalendar';
import { isBlank, isNumericType, roundDecimal, toSafeNumeric, formatValue, picklistLabel } from 'c/gridFormat';

/** The most cells one paste may change: the grid's row ceiling. */
export const MAX_PASTE_CELLS = 10000;

const NEUTRALISED = /^'[=+\-@\t\r]/;
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', 'checked', 'on']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'unchecked', 'off', '']);

// ================================================================ locale

const separatorCache = {};

/** The locale's decimal and grouping characters. */
export function separators(locale = LOCALE) {
    if (!separatorCache[locale]) {
        let parts = [];
        try {
            parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
        } catch {
            parts = [];
        }
        const find = type => (parts.find(p => p.type === type) || {}).value;
        separatorCache[locale] = { decimal: find('decimal') || '.', group: find('group') || ',' };
    }
    return separatorCache[locale];
}

/** The order of day, month and year in the locale's short dates. */
function dateOrder(locale) {
    try {
        return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' })
            .formatToParts(new Date(2026, 10, 22))
            .filter(p => p.type === 'year' || p.type === 'month' || p.type === 'day')
            .map(p => p.type);
    } catch {
        return ['month', 'day', 'year'];
    }
}

// ================================================================ copy

const isCheckboxType = type => type === 'checkbox' || type === 'boolean';

/** One cell's value as clipboard text. */
export function copyText(value, column = {}, locale = LOCALE) {
    const type = column.type || 'text';
    if (isCheckboxType(type)) return value === true || value === 'true' ? 'TRUE' : 'FALSE';
    if (isBlank(value)) return '';
    if (isNumericType(type)) {
        const scale = Number.isInteger(column.scale) ? column.scale : null;
        const text = String(scale === null ? value : roundDecimal(value, scale));
        const plain = separators(locale).decimal === '.' ? text : text.replace('.', separators(locale).decimal);
        return type === 'percent' ? plain + '%' : plain;
    }
    if (type === 'date') return String(value).slice(0, 10);
    if (type === 'picklist') return neutralise(picklistLabel(value, column.options) || String(value));
    // A lookup copies the name shown; pasting it back finds the record again.
    if (type === 'reference' || type === 'owner')
        return neutralise((column.names && column.names[value]) || String(value));
    if (type === 'datetime' || type === 'time' || type === 'multipicklist')
        return neutralise(formatValue(value, column));
    return neutralise(String(value));
}

function tsvField(text) {
    return /[\t\n\r"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** A matrix of cell texts as tab-separated lines, quoted the way Excel quotes. */
export function toTsv(matrix) {
    return (matrix || []).map(row => row.map(t => tsvField(t == null ? '' : String(t))).join('\t')).join('\n');
}

// ================================================================ paste

/**
 * Tab-separated text as a matrix of strings. Understands quoted fields, with
 * doubled quotes inside and line breaks inside (a multi-line cell), and CRLF,
 * LF or CR line endings. One trailing line break, which Excel always adds, does
 * not make an extra row.
 */
export function parseTsv(text) {
    const s = String(text == null ? '' : text);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false; // inside a quoted field
    let fieldStart = true; // at the first character of a field
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"' && s[i + 1] === '"') {
                field += '"';
                i += 2;
            } else if (ch === '"') {
                quoted = false;
                i++;
            } else {
                field += ch;
                i++;
            }
            continue;
        }
        if (ch === '"' && fieldStart) {
            quoted = true;
            fieldStart = false;
            i++;
            continue;
        }
        fieldStart = false;
        if (ch === '\t') {
            row.push(field);
            field = '';
            fieldStart = true;
            i++;
        } else if (ch === '\n' || ch === '\r') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            fieldStart = true;
            i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
        } else {
            field += ch;
            i++;
        }
    }
    // The last row, unless the text ended with a line break (Excel always adds one).
    if (!fieldStart || field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.length ? rows : [['']];
}

/** Remove the apostrophe that copy added in front of a formula prefix. */
export function unneutralise(text) {
    return NEUTRALISED.test(text) ? text.slice(1) : text;
}

function parseNumber(text, column, locale) {
    let s = text.trim();
    if (!s) return { value: null };
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
        negative = true;
        s = s.slice(1, -1).trim();
    }
    const MINUS_SIGN = 0x2212; // the typographic minus some spreadsheets write
    if (s[0] === '-' || s[0] === '+' || s.charCodeAt(0) === MINUS_SIGN) {
        if (s[0] !== '+') negative = !negative;
        s = s.slice(1).trim();
    }
    // A currency symbol or three-letter code on either side, and a percent
    // sign after a percent. Nothing else: "12abc" is not a number.
    s = s.replace(/^(?:\p{Sc}|[A-Z]{3}(?=[\s\d]))\s*/u, '').replace(/\s*(?:\p{Sc}|[A-Z]{3})$/u, '');
    if (column.type === 'percent') s = s.replace(/\s*%$/, '');
    const { decimal, group } = separators(locale);
    // \s includes the no-break spaces French and Swiss locales group digits with.
    s = s.replace(/\s/g, '');
    if (group !== decimal) s = s.split(group).join('');
    if (decimal !== '.') s = s.split(decimal).join('.');
    if (!PLAIN_DECIMAL.test(s)) return { error: `Not a number: ${text.trim()}` };
    const scale = Number.isInteger(column.scale) ? column.scale : null;
    const signed = (negative ? '-' : '') + s;
    return { value: toSafeNumeric(scale === null ? signed : roundDecimal(signed, scale)) };
}

const pad = n => String(n).padStart(2, '0');
// The years a Salesforce Date field holds: 1 Jan 1700 to 31 Dec 4000.
const FIRST_DATE_YEAR = 1700;
const LAST_DATE_YEAR = 4000;

/**
 * A pasted or typed date as ISO "YYYY-MM-DD". A year outside what a Date
 * field holds is not a date: "1/5/202", a year typed halfway, came back as
 * "202-01-05", which is not ISO at all (found in the date editor).
 */
function parseDate(text, locale) {
    const s = text.trim();
    if (!s) return { value: null };
    let y;
    let m;
    let d;
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
    if (iso) {
        [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    } else {
        const nums = s
            .split(/[^\d]+/)
            .filter(Boolean)
            .map(Number);
        if (nums.length !== 3) return { error: `Not a date: ${s}` };
        const parts = {};
        dateOrder(locale).forEach((type, i) => {
            parts[type] = nums[i];
        });
        [y, m, d] = [parts.year, parts.month, parts.day];
        if (y < 100) y += 2000;
    }
    const check = new Date(Date.UTC(y, m - 1, d));
    if (
        !y ||
        y < FIRST_DATE_YEAR ||
        y > LAST_DATE_YEAR ||
        check.getUTCFullYear() !== y ||
        check.getUTCMonth() !== m - 1 ||
        check.getUTCDate() !== d
    ) {
        return { error: `Not a date: ${s}` };
    }
    return { value: `${y}-${pad(m)}-${pad(d)}` };
}

/**
 * A pasted or typed time: "17:30", "5:30 PM", as Salesforce writes a
 * Time, "17:30:00.000Z".
 */
/**
 * An Excel time cell, read from a file, is a time on Excel's day zero
 * (gridXlsx serialToIso): 1899-12-31T17:30:00, or 1904-01-01T17:30:00 in a
 * 1904 workbook; midnight is the day alone.
 */
const EXCEL_DAY_ZERO = /^(?:1899-12-3[01]|1904-01-01)(?:T(\d{1,2}:\d{2}(?::\d{2})?))?$/;

function parseTime(text) {
    const s = text.trim();
    if (!s) return { value: null };
    const zero = EXCEL_DAY_ZERO.exec(s);
    const t = parseTimeText(zero ? zero[1] || '00:00' : s);
    return t ? { value: timeValue(t) } : { error: `Not a time: ${s}` };
}

/**
 * A pasted or typed date and time, as an instant in ISO, UTC. An
 * instant with its own zone ("...Z", "+02:00") is taken as it is; anything
 * else is the wall clock in the user's Salesforce time zone (`timeZone`):
 * "2026-10-01 17:30", "10/1/2026, 5:30 PM" (as the grid shows and copies
 * it), or a date alone, which is that day's midnight.
 */
function parseDateTime(text, locale, timeZone) {
    const s = text.trim();
    if (!s) return { value: null };
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
        const ms = Date.parse(s);
        return Number.isNaN(ms) ? { error: `Not a date and time: ${s}` } : { value: new Date(ms).toISOString() };
    }
    // The time is what follows the date: after a T, a comma, or the space
    // after the third number.
    const m = /^(.*?\d)(?:[T,]\s*|\s+)(\d{1,2}(?:[:.]\d{2}){0,2}(?:\.\d+)?\s*(?:[aApP]\.?\s*[mM]?\.?)?)$/.exec(s);
    const datePart = m ? m[1] : s;
    const timePart = m ? m[2] : null;
    const date = parseDate(datePart, locale);
    if (date.error || !date.value) return { error: `Not a date and time: ${s}` };
    const t = timePart ? parseTimeText(timePart) : { hour: 0, minute: 0, second: 0 };
    if (!t) return { error: `Not a date and time: ${s}` };
    const value = zonedToInstant(date.value, t, timeZone);
    return value ? { value } : { error: `Not a date and time: ${s}` };
}

function parseCheckbox(text) {
    const s = text.trim().toLowerCase();
    if (TRUE_WORDS.has(s)) return { value: true };
    if (FALSE_WORDS.has(s)) return { value: false };
    return { error: `Not a checkbox value: ${text.trim()}` };
}

function parsePicklist(text, column) {
    const s = text.trim();
    if (!s) return { value: null };
    const options = column.options || [];
    const exact = options.find(o => o.value === s);
    if (exact) return { value: exact.value };
    const lower = s.toLowerCase();
    const loose =
        options.find(o => String(o.label).toLowerCase() === lower) ||
        options.find(o => String(o.value).toLowerCase() === lower);
    if (loose) return { value: loose.value };
    return { error: `Not a value of this picklist: ${s}` };
}

/**
 * TC-040: values separated by semicolons (as stored) or commas (as shown),
 * each matched like a single picklist value, saved semicolon-delimited.
 */
function parseMultiPicklist(text, column) {
    const s = text.trim();
    if (!s) return { value: null };
    const parts = (s.includes(';') ? s.split(';') : s.split(',')).map(p => p.trim()).filter(Boolean);
    const values = [];
    for (const part of parts) {
        const one = parsePicklist(part, column);
        if (one.error) return one;
        if (!values.includes(one.value)) values.push(one.value);
    }
    return { value: values.join(';') };
}

const RECORD_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * A lookup takes a record Id, or the exact name of a record
 * (`column.nameIndex`: lower-case name to Ids): one shown in the grid, or one
 * the server found by that name before the paste or import (GridLookup.namesFor).
 * The server checks the Id is of the right object and one the user can see.
 */
function parseReference(text, column) {
    const s = text.trim();
    if (!s) return { value: null };
    if (RECORD_ID.test(s)) return { value: s };
    const ids = column.nameIndex ? column.nameIndex.get(s.toLowerCase()) : null;
    if (ids && ids.length === 1) return { value: ids[0] };
    if (ids && ids.length > 1) return { error: `More than one record is named ${s}. Paste its record Id instead.` };
    return { error: `No record named ${s} was found. Paste its record Id, or choose it with the lookup.` };
}

/**
 * A pasted text as a value for this column: `{ value }`, or `{ error }` with
 * a message for the cell. Text is taken exactly as pasted (TC-005: no trim).
 */
export function parseCell(text, column = {}, locale = LOCALE, timeZone = TIME_ZONE) {
    const raw = unneutralise(String(text == null ? '' : text));
    const type = column.type || 'text';
    if (isNumericType(type)) return parseNumber(raw, column, locale);
    if (type === 'date') return parseDate(raw, locale);
    if (type === 'datetime') return parseDateTime(raw, locale, timeZone);
    if (type === 'time') return parseTime(raw);
    if (isCheckboxType(type)) return parseCheckbox(raw);
    if (type === 'picklist') return parsePicklist(raw, column);
    if (type === 'multipicklist') return parseMultiPicklist(raw, column);
    if (type === 'reference' || type === 'owner') return parseReference(raw, column);
    return { value: raw === '' ? null : raw };
}

/**
 * How big a paste is, worked out from the block's and the range's sizes
 * alone, before any cell is listed: { rows, cols } it covers from the
 * range's top-left cell, and `cells`, how many of those fall inside the grid
 * (`bounds`). The arguments are pastePlan's.
 */
export function pasteSize(block, target, bounds) {
    const blockRows = block.length;
    // The widest row, by a loop: spreading 150,000 rows into Math.max
    // overflows the call stack.
    let blockCols = -Infinity;
    for (let r = 0; r < blockRows; r++) if (block[r].length > blockCols) blockCols = block[r].length;
    const targetRows = target.bottom - target.top + 1;
    const targetCols = target.right - target.left + 1;
    let rows = blockRows;
    let cols = blockCols;
    if ((blockRows === 1 && blockCols === 1) || (targetRows % blockRows === 0 && targetCols % blockCols === 0)) {
        rows = Math.max(targetRows, blockRows);
        cols = Math.max(targetCols, blockCols);
    }
    const inRows = Math.max(0, Math.min(rows, bounds.rowCount - target.top + 1));
    const inCols = Math.max(0, Math.min(cols, bounds.colCount - target.left + 1));
    return { rows, cols, blockRows, blockCols, cells: inRows * inCols };
}

/**
 * Where each pasted value goes. `block` is the parsed clipboard; the
 * target is the selected range, 1-based and inclusive, in view positions:
 * { top, left, bottom, right }. `bounds` is { rowCount, colCount }.
 *   - one value into a range fills the range;
 *   - a block into a range that is a whole multiple of it repeats the block;
 *   - otherwise the block goes in once from the range's top-left cell.
 * Cells past the last row or column are counted in `dropped`. Check
 * pasteSize first: this lists every cell.
 */
export function pastePlan(block, target, bounds) {
    const { rows, cols, blockRows, blockCols } = pasteSize(block, target, bounds);
    const cells = [];
    let dropped = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const row = target.top + r;
            const col = target.left + c;
            if (row > bounds.rowCount || col > bounds.colCount) {
                dropped++;
                continue;
            }
            const text = block[r % blockRows][c % blockCols];
            cells.push({ row, col, text: text === undefined ? '' : text });
        }
    }
    return { cells, dropped, rows, cols };
}
