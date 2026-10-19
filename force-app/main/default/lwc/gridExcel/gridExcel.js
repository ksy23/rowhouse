/**
 * gridExcel — Export to Excel: the grid as the user sees it, as a sheet for
 * c/gridXlsxWriter. Pure functions (HR-25).
 *
 * WHAT GOES IN
 * The rows Export to CSV writes (every loaded row, saved values, in the
 * grid's sort), the record Id first, then the columns the user sees, in
 * their order, at the widths drawn. Unlike the CSV, each value keeps its
 * kind and its look:
 *   numbers, currency, percent  numbers, formatted as the grid shows them:
 *                     grouping, the field's decimal places, the currency
 *                     (by its code in an org with more than one); a percent
 *                     is a fraction (50 for 50% becomes 0.5) shown as a percent
 *   dates, times      Excel dates and times, in the user's time zone, shown
 *                     in the reader's own date order (Excel's built-in formats)
 *   checkboxes        TRUE or FALSE
 *   lookups           the record's name, as the grid shows it
 *   picklists         their labels, as the grid shows them
 *   everything else   text, never a formula (c/gridXlsxWriter writes text as
 *                     text, so the CSV's formula neutralising is not needed)
 * A number with more than 15 significant digits is written as text: Excel
 * keeps 15, and would change the rest.
 *
 * THE LOOK
 * A bold header row with filter buttons, frozen with the columns the grid
 * freezes (and the Id); wrapped columns wrap. Display rules give the same
 * fills, text colors and bold; a row rule's fill gives the row its tint and a
 * colored bar at its left edge, as in the grid. Icons and data bars are not
 * carried over.
 *
 * GROUPS
 * When the grid is grouped, a Group column comes first, as in the grid: each
 * group has a heading row ("Stage: Negotiation (2)") and, under its rows, a
 * Subtotal row, and the sheet ends with a Total row. Subtotals are Excel
 * SUBTOTAL formulas over the rows in the file, so they stay right as the
 * file is edited, and Excel's outline buttons fold each group. They add up
 * the rows in the file, which are the loaded rows: the grid's own subtotals
 * count every matching record. Amounts in more than one currency are not
 * added up: the grid converts them, and a sheet cannot.
 */
import LOCALE from '@salesforce/i18n/locale';
import CURRENCY from '@salesforce/i18n/currency';
import TIME_ZONE from '@salesforce/i18n/timeZone';
import { formatValue, isBlank, isNumericType, toSafeNumeric, currencyFor, isMixedCurrency } from 'c/gridFormat';
import { isLookup, lookupText } from 'c/gridFields';
import { compileRules, formatsFor } from 'c/gridDisplayRules';

/** Excel's built-in formats: the reader's own short date, date and time, and times. */
const DATE_FORMAT = 14;
const DATETIME_FORMAT = 22;
const TIME_12 = 18; // h:mm AM/PM
const TIME_24 = 20; // h:mm

/** Excel's SUBTOTAL function for each of the grid's subtotals. */
export const SUBTOTAL_FUNCTION = { average: 1, count: 3, max: 4, min: 5, sum: 9 };

const HEADER_FILL = 'F3F3F3';
const LINE = 'C9C9C9';

/** Display rules' colors, as the grid draws them (gridTable.css; the SLDS palette's fallbacks). */
const RULE_LOOKS = {
    'rh-rule_fill-green': { fill: 'CDEFC4' },
    'rh-rule_fill-amber': { fill: 'F9E3B6' },
    'rh-rule_fill-red': { fill: 'FEDED8' },
    'rh-rule_fill-purple': { fill: 'ECE1F9' },
    'rh-rule_fill-gray': { fill: 'E5E5E5' },
    'rh-rule_text-red': { color: 'BA0517' },
    'rh-rule_text-green': { color: '396547' },
    'rh-rule_text-gray': { color: '5C5C5C' },
    'rh-rule_bold': { bold: true }
};
/** A row rule's fill: the row's tint and its bar. */
const ROW_LOOKS = {
    'rh-rule_bar-green': { tint: 'EBF7E6', bar: '3BA755' },
    'rh-rule_bar-amber': { tint: 'FFF1EA', bar: 'E4A201' },
    'rh-rule_bar-red': { tint: 'FEF1EE', bar: 'FE5C4C' },
    'rh-rule_bar-purple': { tint: 'F6F2FB', bar: 'AD7BEE' },
    'rh-rule_bar-gray': { tint: 'F9F9F9', bar: '939393' }
};

/** px in the grid to Excel's column width, in characters of Calibri 11 (7 px each, with padding). */
export function widthInCharacters(px) {
    const n = Number(px);
    if (!Number.isFinite(n) || n <= 0) return 18;
    return Math.min(100, Math.max(6, Math.round(((n - 12) / 7) * 10) / 10));
}

// ================================================================ values

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?$/;

/** A date (YYYY-MM-DD) as Excel's serial number, or null. Excel has no dates before 1900. */
export function dateSerial(iso) {
    const m = ISO_DATE.exec(String(iso || ''));
    if (!m) return null;
    const y = Number(m[1]);
    if (y < 1900) return null;
    return (Date.UTC(y, Number(m[2]) - 1, Number(m[3])) - EXCEL_EPOCH) / DAY_MS;
}

const wallClocks = new Map();

/** An instant as Excel's serial number for the wall clock in the time zone, or null. */
export function dateTimeSerial(value, timeZone = TIME_ZONE) {
    const instant = new Date(value);
    if (isBlank(value) || Number.isNaN(instant.getTime())) return null;
    let f = wallClocks.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        wallClocks.set(timeZone, f);
    }
    const p = {};
    f.formatToParts(instant).forEach(part => {
        p[part.type] = part.value;
    });
    const day = dateSerial(`${p.year}-${p.month}-${p.day}`);
    if (day === null) return null;
    const hour = Number(p.hour) % 24;
    return day + (hour * 3600 + Number(p.minute) * 60 + Number(p.second)) / 86400;
}

/** A Time field's value ("17:30:00.000Z") as Excel's fraction of a day, or null. */
export function timeSerial(value) {
    const m = TIME_RE.exec(String(value || '').trim());
    if (!m) return null;
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0)) / 86400;
}

let hour12 = null;
function usesHour12() {
    if (hour12 === null) {
        try {
            hour12 = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric' }).resolvedOptions().hour12 !== false;
        } catch {
            hour12 = true;
        }
    }
    return hour12;
}

const decimals = scale => (Number.isInteger(scale) && scale > 0 ? '.' + '0'.repeat(Math.min(scale, 30)) : '');

/** A number's format: grouped, with the field's decimal places; General when it has none. */
export function numberFormat(scale) {
    return Number.isInteger(scale) ? '#,##0' + decimals(scale) : 0;
}

export function percentFormat(scale) {
    return '#,##0' + decimals(Number.isInteger(scale) ? scale : 0) + '%';
}

const currencyFormats = new Map();

/**
 * A currency's format: its symbol where the locale puts it ("$"#,##0.00,
 * #,##0.00" €"), or its ISO code before the number ("USD "#,##0.00) where
 * the grid shows amounts by code. Excel shows the grouping and decimal
 * marks of the reader's own settings.
 */
export function currencyFormat(code, byCode, scale) {
    const digits = Number.isInteger(scale) ? scale : 2;
    const key = [code, byCode ? 1 : 0, digits].join('|');
    if (currencyFormats.has(key)) return currencyFormats.get(key);
    const number = '#,##0' + decimals(digits);
    let symbol = String(code || CURRENCY);
    let before = true;
    let space = true;
    if (!byCode) {
        try {
            const parts = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: symbol }).formatToParts(1);
            const at = parts.findIndex(p => p.type === 'currency');
            const digitsAt = parts.findIndex(p => p.type === 'integer');
            if (at >= 0 && digitsAt >= 0) {
                symbol = parts[at].value;
                before = at < digitsAt;
                const between = before ? parts.slice(at + 1, digitsAt) : parts.slice(digitsAt + 1, at);
                space = between.some(p => p.type === 'literal' && /\s/.test(p.value));
            }
        } catch {
            space = true; // a code the browser does not know: shown by its code
        }
    }
    const sym = symbol.replace(/"/g, '');
    const pad = space ? ' ' : '';
    const format = before ? `"${sym}${pad}"${number}` : `${number}"${pad}${sym}"`;
    currencyFormats.set(key, format);
    return format;
}

/**
 * One cell's value and kind: { v, t, numFmt, align } (t 's', 'n' or 'b'),
 * or null for a blank. The look (fills, wrapping) is added by the caller.
 */
export function cellValue(value, column, row, names, timeZone = TIME_ZONE) {
    if (isBlank(value)) return null;
    const type = column.type || 'text';
    if (isLookup(type)) return { v: lookupText(value, names), t: 's' };
    if (isNumericType(type)) {
        const safe = toSafeNumeric(value);
        if (typeof safe !== 'number') {
            // Past 15 significant digits, or not a number at all: kept as text, as the grid shows it.
            return { v: formatValue(value, column, row), t: 's', align: 'right' };
        }
        if (type === 'percent') return { v: safe / 100, t: 'n', numFmt: percentFormat(column.scale) };
        if (type === 'currency') {
            const { code, byCode } = currencyFor(column, row);
            return { v: safe, t: 'n', numFmt: currencyFormat(code, byCode, column.scale) };
        }
        return { v: safe, t: 'n', numFmt: numberFormat(column.scale) };
    }
    if (type === 'date') {
        const serial = dateSerial(value);
        return serial === null ? { v: String(value), t: 's' } : { v: serial, t: 'n', numFmt: DATE_FORMAT };
    }
    if (type === 'datetime') {
        const serial = dateTimeSerial(value, timeZone);
        return serial === null ? { v: String(value), t: 's' } : { v: serial, t: 'n', numFmt: DATETIME_FORMAT };
    }
    if (type === 'time') {
        const serial = timeSerial(value);
        return serial === null
            ? { v: String(value), t: 's' }
            : { v: serial, t: 'n', numFmt: usesHour12() ? TIME_12 : TIME_24 };
    }
    if (type === 'checkbox' || type === 'boolean') {
        return { v: value === true || value === 'true', t: 'b', align: 'center' };
    }
    return { v: formatValue(value, column, row), t: 's' };
}

// ================================================================ looks

/** One style object per distinct look, shared by the cells that have it (c/gridXlsxWriter). */
class Looks {
    constructor() {
        this.cache = new Map();
    }

    get(look) {
        const key = JSON.stringify(look);
        let style = this.cache.get(key);
        if (!style) {
            style = { ...look };
            this.cache.set(key, style);
        }
        return style;
    }
}

/** What a row's display rules give each cell: { [field]: look }, the row's tint and its bar. */
function ruleLooks(format) {
    if (!format) return null;
    const cells = {};
    Object.keys(format.cells || {}).forEach(field => {
        const look = {};
        String(format.cells[field])
            .split(/\s+/)
            .forEach(cls => Object.assign(look, RULE_LOOKS[cls] || {}));
        if (Object.keys(look).length) cells[field] = look;
    });
    const row = format.bar ? ROW_LOOKS[format.bar] || null : null;
    return { cells, tint: row ? row.tint : null, bar: row ? row.bar : null };
}

// ================================================================ subtotals

/**
 * A group's (or the sheet's) figure for a column, over the values in the
 * file: the value Excel's SUBTOTAL works out, written beside the formula
 * for readers that do not calculate.
 */
export function aggregate(values, kind) {
    if (kind === 'count') return values.length;
    let n = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        n++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    if (!n) return null;
    switch (kind) {
        case 'sum':
            return sum;
        case 'average':
            return sum / n;
        case 'min':
            return min;
        case 'max':
            return max;
        default:
            return null;
    }
}

// ================================================================ the sheet

/**
 * The sheet for c/gridXlsxWriter.
 * @param {object} p
 *   title    the grid's title: the sheet's name
 *   view     gridTable's exportView(): { columns: [{ field, width, wrapped }],
 *            frozen, items } (items: rows, and { __group: header } when grouped)
 *   columns  the grid's columns (the configuration's), by field
 *   names    lookup names, { [recordId]: name }
 *   rules    the display rules, as the server sent them; today: the day TODAY is
 *   timeZone the user's (for date/times and TODAY)
 */
export function buildSheet({ title, view, columns, names = {}, rules = [], today = null, timeZone = TIME_ZONE }) {
    const byField = new Map((columns || []).map(c => [c.field, c]));
    const shown = ((view && view.columns) || [])
        .map(v => ({ ...(byField.get(v.field) || { field: v.field, type: 'text' }), ...v }))
        .filter(c => c.field);
    const items = (view && Array.isArray(view.items) ? view.items : []).filter(Boolean);
    const grouped = items.some(it => it.__group);
    const lead = grouped ? 2 : 1; // the Group column, then the Id
    const looks = new Looks();
    const compiled = compileRules(rules, today ? { today, timeZone } : { timeZone });
    const fields = shown.map(c => c.field);
    const subtotalled = shown.map(c => (c.subtotal && SUBTOTAL_FUNCTION[c.subtotal] && !isMixedCurrency(c) ? c : null));
    // Subtotal and Total rows only when some column has a subtotal: the grid shows none otherwise.
    const hasTotals = subtotalled.some(Boolean);

    // ---- columns and header
    const sheetColumns = [];
    if (grouped) sheetColumns.push({ width: widthInCharacters(220) });
    sheetColumns.push({ width: 20 }); // an 18-character record Id
    shown.forEach(c => sheetColumns.push({ width: widthInCharacters(c.width) }));
    const header = looks.get({ bold: true, fill: HEADER_FILL, borderBottom: { style: 'thin', color: LINE } });
    const headerRight = looks.get({
        bold: true,
        fill: HEADER_FILL,
        borderBottom: { style: 'thin', color: LINE },
        align: 'right'
    });
    const headerCenter = looks.get({
        bold: true,
        fill: HEADER_FILL,
        borderBottom: { style: 'thin', color: LINE },
        align: 'center'
    });
    const headerCells = [];
    if (grouped) headerCells.push({ v: 'Group', t: 's', style: header });
    headerCells.push({ v: 'Id', t: 's', style: header });
    shown.forEach(c => {
        const type = c.type || 'text';
        const style = isNumericType(type)
            ? headerRight
            : type === 'checkbox' || type === 'boolean'
              ? headerCenter
              : header;
        headerCells.push({ v: c.label || c.field, t: 's', style });
    });
    const rows = [{ level: 0, cells: headerCells }];

    // ---- data rows, group headings and subtotals
    const open = []; // groups whose rows are being written: { level, header, start, values }
    const totalsBy = shown.map(() => []); // every data row's values, for the Total row
    const subtotalCells = (from, to, valuesBy, label, look, indent, level) => {
        const cells = [];
        if (grouped) cells.push({ v: label, t: 's', style: looks.get({ ...look, indent }) });
        cells.push({ v: grouped ? null : label, t: 's', style: looks.get(look) });
        shown.forEach((c, i) => {
            const sub = subtotalled[i];
            if (!sub || from > to) {
                cells.push({ v: null, style: looks.get(look) });
                return;
            }
            const kind = sub.subtotal;
            const ref = colLetters(lead + i + 1);
            const cached = aggregate(valuesBy[i], kind);
            const numFmt = subtotalFormat(sub, kind);
            cells.push({
                f: `SUBTOTAL(${SUBTOTAL_FUNCTION[kind]},${ref}${from}:${ref}${to})`,
                v: cached,
                style: looks.get({ ...look, numFmt })
            });
        });
        rows.push({ level, cells });
    };
    const closeGroup = () => {
        const g = open.pop();
        // A group's rows run from the row after its heading to the last written.
        if (hasTotals)
            subtotalCells(
                g.start,
                rows.length,
                g.values,
                `Subtotal: ${g.header.label}`,
                { bold: true, borderTop: { style: 'thin', color: LINE } },
                g.level - 1,
                g.level - 1
            );
        // Its values count in the group around it, which passes them on in turn.
        const parent = open[open.length - 1];
        if (parent)
            g.values.forEach((vals, i) => {
                for (const v of vals) parent.values[i].push(v);
            });
    };

    items.forEach(item => {
        if (item.__group) {
            const h = item.__group;
            while (open.length && open[open.length - 1].level >= h.level) closeGroup();
            const look = looks.get({ bold: true, fill: HEADER_FILL });
            const cells = [
                {
                    v: `${h.columnLabel}: ${h.label} (${h.loaded})`,
                    t: 's',
                    style: looks.get({ bold: true, fill: HEADER_FILL, indent: h.level - 1 })
                },
                { v: null, style: look }
            ];
            shown.forEach(() => cells.push({ v: null, style: look }));
            rows.push({ level: h.level - 1, cells });
            open.push({ level: h.level, header: h, start: rows.length + 1, values: shown.map(() => []) });
            return;
        }
        const row = item;
        const format = compiled.length ? ruleLooks(formatsFor(compiled, f => row[f], fields)) : null;
        const tint = format ? format.tint : null;
        const cells = [];
        const barLook = format && format.bar ? { borderLeft: { style: 'thick', color: format.bar } } : null;
        if (grouped) cells.push({ v: null, style: looks.get({ ...(tint ? { fill: tint } : {}), ...(barLook || {}) }) });
        const idLook = { ...(tint ? { fill: tint } : {}), ...(!grouped && barLook ? barLook : {}) };
        cells.push({ v: row.Id || null, t: 's', style: Object.keys(idLook).length ? looks.get(idLook) : null });
        shown.forEach((c, i) => {
            const val = cellValue(row[c.field], c, row, names, timeZone);
            const look = {};
            if (val && val.numFmt !== undefined && val.numFmt !== 0) look.numFmt = val.numFmt;
            if (val && val.align) look.align = val.align;
            if (c.wrapped) {
                look.wrap = true;
                look.top = true;
            }
            if (tint) look.fill = tint;
            if (format && format.cells[c.field]) Object.assign(look, format.cells[c.field]);
            const style = Object.keys(look).length ? looks.get(look) : null;
            cells.push(val ? { v: val.v, t: val.t, style } : style ? { v: null, style } : null);
            if (val) {
                totalsBy[i].push(val.v);
                if (open.length) open[open.length - 1].values[i].push(val.v);
            }
        });
        rows.push({ level: open.length, cells });
    });
    while (open.length) closeGroup();
    // The header and the records: the Total row below stays out of the filter, so a sort leaves it last.
    const filtered = rows.length;
    if (hasTotals && items.length) {
        subtotalCells(
            2,
            rows.length,
            totalsBy,
            'Total',
            { bold: true, fill: HEADER_FILL, borderTop: { style: 'thin', color: LINE } },
            0,
            0
        );
    }

    const frozen = Number(view && view.frozen) || 0;
    return {
        name: title,
        title,
        columns: sheetColumns,
        freeze: { rows: 1, columns: frozen > 0 ? lead + frozen : 0 },
        // Filters over a report of groups and subtotals would mix them in: only an ungrouped sheet has them.
        autoFilter: grouped ? false : filtered,
        rows
    };
}

/** A subtotal's number format: the column's, two decimals at least for an average, whole for a count. */
function subtotalFormat(column, kind) {
    if (kind === 'count') return '#,##0';
    const type = column.type || 'text';
    const scale = Number.isInteger(column.scale) ? column.scale : null;
    if (type === 'percent') return percentFormat(kind === 'average' ? Math.max(scale || 0, 2) : scale);
    if (type === 'currency') {
        // One currency in an org with one: the user's, by its symbol.
        const { code, byCode } = currencyFor({ ...column, currencyField: null }, null);
        return currencyFormat(code, byCode || Boolean(column.currencyCode), scale === null ? 2 : scale);
    }
    if (isNumericType(type)) return numberFormat(kind === 'average' ? Math.max(scale || 0, 2) : scale);
    // A date's earliest or latest keeps its format; anything else is a plain number.
    if (type === 'date') return DATE_FORMAT;
    if (type === 'datetime') return DATETIME_FORMAT;
    return 0;
}

/** A column's letters: 1 is A. */
function colLetters(n) {
    let s = '';
    let k = n;
    while (k > 0) {
        const m = (k - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        k = Math.floor((k - 1) / 26);
    }
    return s;
}
