/**
 * gridFormat — how a value is shown, compared and linked. Pure functions.
 *
 * Shared by the table core and by the cell-editor library, so a value renders
 * the same in a table cell as in a standalone editor. It lives in its own module
 * rather than in gridTable so that the cell components can use it without
 * importing the table (HR-27).
 *
 * The edge cases each function handles are named by test-case number; the
 * records are in test-data/data/Rowhouse_Test_Record__c.csv.
 */
import LOCALE from '@salesforce/i18n/locale';
import CURRENCY from '@salesforce/i18n/currency';
import TIME_ZONE from '@salesforce/i18n/timeZone';

const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'double', 'integer', 'long']);
const TEXT_TYPES = new Set(['text', 'string', 'textarea', 'email', 'phone', 'url', 'id', 'reference', 'combobox']);

export function isNumericType(type) {
    return NUMERIC_TYPES.has(type);
}

const CENTERED_TYPES = new Set(['checkbox', 'boolean']);

/**
 * How a column's values and its header line up, by type: numbers right so
 * digits line up, checkboxes centred so a narrow column of ticks reads
 * as a column, everything else left, dates and picklists included.
 */
export function alignmentFor(type) {
    if (NUMERIC_TYPES.has(type)) return 'right';
    if (CENTERED_TYPES.has(type)) return 'center';
    return 'left';
}

export function isTextType(type) {
    return !type || TEXT_TYPES.has(type);
}

/**
 * TC-001 / TC-002. Null and undefined are "no value". The empty string is kept
 * distinct here because a caller may need the difference — but note that the
 * platform stores '' as null for text fields, so the distinction never survives
 * a save.
 */
export function isBlank(value) {
    return value === null || value === undefined || value === '';
}

// ---------------------------------------------------------------- numbers

// A plain decimal literal: optional sign, digits, optional fraction.
const DECIMAL_RE = /^[-+]?\d+(\.\d+)?$/;

/**
 * TC-024. 18 significant digits is beyond Number.MAX_SAFE_INTEGER, so a value
 * that arrives as a string must stay a string. Anything that fits safely is
 * returned as a number; anything else is returned unchanged.
 */
export function toSafeNumeric(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || !DECIMAL_RE.test(value.trim())) return value;
    const digits = value.replace(/[^0-9]/g, '').replace(/^0+/, '');
    return digits.length > 15 ? value.trim() : Number(value);
}

/**
 * TC-023. Round a number to a field's decimal places, exactly and half up
 * (away from zero), which is the rule Salesforce documents for its own
 * rounding. It works on the decimal digits, never on a binary float: as a
 * float, 1.005 is 1.00499999999999989 and would round down to 1.00, where
 * Salesforce, the user and the server all expect 1.01. A number goes through
 * its shortest string form (String(1.005) is "1.005"), which is the value the
 * user typed or the server sent.
 *
 * Returns a decimal string when anything was rounded, otherwise the value
 * unchanged. Values that are not plain decimals are returned unchanged.
 */
export function roundDecimal(value, scale) {
    if (isBlank(value) || !Number.isInteger(scale) || scale < 0) return value;
    const text = String(value).trim();
    if (!DECIMAL_RE.test(text)) return value;
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace(/^[-+]/, '').split('.');
    if (fraction.length <= scale) return value;
    const digits = (whole + fraction.slice(0, scale)).split('');
    if (fraction.charCodeAt(scale) >= 53) {
        // the first dropped digit is 5 or more
        let i = digits.length - 1;
        while (i >= 0 && digits[i] === '9') digits[i--] = '0';
        if (i < 0) digits.unshift('1');
        else digits[i] = String(Number(digits[i]) + 1);
    }
    const cut = digits.length - scale;
    let out =
        digits
            .slice(0, cut)
            .join('')
            .replace(/^0+(?=\d)/, '') || '0';
    if (scale > 0) out += '.' + digits.slice(cut).join('');
    return negative && /[1-9]/.test(out) ? '-' + out : out;
}

/**
 * Formatters, made once and kept. Building an Intl formatter is far slower
 * than using one, and a table formats every number and date cell on every
 * redraw: new ones each time were a fifth of a redraw's time in a profile.
 * The locale, currency and time zone are fixed for the page,
 * so a formatter is keyed only by what varies: the kind, the scale, the
 * currency code.
 */
const formatters = new Map();
function formatter(key, make) {
    let f = formatters.get(key);
    if (!f) {
        f = make();
        formatters.set(key, f);
    }
    return f;
}

let numberParts;
function separators() {
    if (!numberParts) {
        const parts = new Intl.NumberFormat(LOCALE).formatToParts(12345.6);
        numberParts = {
            group: (parts.find(p => p.type === 'group') || { value: ',' }).value,
            decimal: (parts.find(p => p.type === 'decimal') || { value: '.' }).value
        };
    }
    return numberParts;
}

/** Group a decimal string by hand — used only when Number would lose digits. */
function formatDecimalString(str, fractionDigits) {
    const { group, decimal } = separators();
    const negative = str.startsWith('-');
    let [intPart, fracPart = ''] = str.replace(/^[-+]/, '').split('.');
    intPart = intPart.replace(/^0+(?=\d)/, '');
    if (fractionDigits !== undefined && fractionDigits !== null) {
        fracPart = fracPart.padEnd(fractionDigits, '0').slice(0, fractionDigits);
    }
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    return (negative ? '-' : '') + grouped + (fracPart ? decimal + fracPart : '');
}

/** A whole count, grouped for the locale ("1,234"): record counts, row counts. */
export function formatCount(n) {
    return formatter('count', () => new Intl.NumberFormat(LOCALE)).format(n);
}

/**
 * Format a number, currency or percent.
 *
 * TC-003: zero renders as "0" (or "0.00" when the field has scale 2), never blank.
 * TC-022: negatives follow the locale.
 * TC-025: Salesforce stores 50 for 50% — displayed as "50%", never multiplied.
 */
export function formatNumber(value, { type = 'number', scale, currencyCode } = {}) {
    if (isBlank(value)) return '';
    const hasScale = Number.isInteger(scale);
    // Round the decimal digits first (TC-023); the formatter then only lays
    // out digits that are already right, so its own float rounding never acts.
    const safe = toSafeNumeric(hasScale ? roundDecimal(value, scale) : value);
    if (typeof safe === 'string') {
        if (!DECIMAL_RE.test(safe)) return safe; // not a number at all; show as-is
        const text = formatDecimalString(safe, hasScale ? scale : undefined);
        if (type === 'percent') return text + '%';
        if (type === 'currency') return (currencyCode || CURRENCY) + ' ' + text;
        return text;
    }
    if (!Number.isFinite(safe)) return String(value);
    const options = hasScale
        ? { minimumFractionDigits: scale, maximumFractionDigits: scale }
        : { maximumFractionDigits: 6 };
    if (type === 'currency') {
        const currency = currencyCode || CURRENCY;
        return formatter(
            'currency|' + currency + '|' + (hasScale ? scale : ''),
            () =>
                new Intl.NumberFormat(LOCALE, {
                    style: 'currency',
                    currency,
                    ...(hasScale ? options : {})
                })
        ).format(safe);
    }
    const text = formatter('number|' + (hasScale ? scale : ''), () => new Intl.NumberFormat(LOCALE, options)).format(
        safe
    );
    return type === 'percent' ? text + '%' : text;
}

// ------------------------------------------------------------------ dates

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * TC-027 / TC-028 / TC-033 / TC-034. A Date has no timezone. It is formatted in
 * UTC from its own components, so no offset can move it across midnight.
 */
export function formatDate(value) {
    if (isBlank(value)) return '';
    const m = DATE_RE.exec(String(value));
    if (!m) return String(value);
    const instant = new Date(0);
    instant.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return formatter(
        'date',
        () =>
            new Intl.DateTimeFormat(LOCALE, {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                timeZone: 'UTC'
            })
    ).format(instant);
}

/** A DateTime is an instant, shown in the running user's timezone (TC-029..031). */
export function formatDateTime(value) {
    if (isBlank(value)) return '';
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return String(value);
    return formatter(
        'datetime',
        () =>
            new Intl.DateTimeFormat(LOCALE, {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: TIME_ZONE
            })
    ).format(instant);
}

const TIME_VALUE_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?$/;

/**
 * A Time field's value, "17:30:00.000Z" as Salesforce sends it, in the
 * locale's words: "5:30 PM". A Time has no time zone, whatever the Z
 * says, so it is formatted in UTC.
 */
export function formatTime(value) {
    if (isBlank(value)) return '';
    const m = TIME_VALUE_RE.exec(String(value).trim());
    if (!m) return String(value);
    const instant = new Date(Date.UTC(1970, 0, 1, Number(m[1]), Number(m[2])));
    return formatter(
        'time',
        () => new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    ).format(instant);
}

// ------------------------------------------------------------------- links

/**
 * TC-046. A URL field can hold `javascript:` — the platform accepts it. Only
 * schemes that cannot execute are ever made clickable; anything else renders as
 * text. Returns null when the value must not become a link.
 */
export function safeHref(value) {
    if (isBlank(value)) return null;
    const text = String(value).trim();
    // Strip characters browsers ignore inside a scheme ("java\tscript:").
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    const probe = text.replace(/[\x00-\x20\x7f-\x9f]/g, '').toLowerCase();
    if (/^(https?:|mailto:|tel:)/.test(probe)) return text;
    if (/^[a-z][a-z0-9+.-]*:/.test(probe)) return null; // any other scheme
    // No scheme: treat as a host or path and make it an https link, as the
    // standard UI does for a URL field without one.
    return 'https://' + text.replace(/^\/+/, '');
}

// ------------------------------------------------------------------ display

/**
 * The text a cell shows for a value. Returns a string; never throws.
 * options: { type, scale, options (picklist values), currencyCode }
 */
export function formatValue(value, column = {}) {
    const type = column.type || 'text';
    if (isBlank(value)) return '';
    switch (type) {
        case 'number':
        case 'double':
        case 'integer':
        case 'long':
            return formatNumber(value, { type: 'number', scale: column.scale });
        case 'currency':
            return formatNumber(value, { type: 'currency', scale: column.scale, currencyCode: column.currencyCode });
        case 'percent':
            return formatNumber(value, { type: 'percent', scale: column.scale });
        case 'date':
            return formatDate(value);
        case 'datetime':
            return formatDateTime(value);
        case 'time':
            return formatTime(value);
        case 'checkbox':
        case 'boolean':
            return value === true || value === 'true' ? 'Checked' : 'Not checked';
        case 'picklist':
            return picklistLabel(value, column.options);
        case 'multipicklist':
            return String(value)
                .split(';')
                .map(v => picklistLabel(v, column.options))
                .join(', ');
        default:
            return String(value);
    }
}

/**
 * TC-036. A stored value that is no longer in the active set is shown as it is
 * stored — never blanked. Blanking it is silent data loss.
 */
export function picklistLabel(value, options) {
    if (isBlank(value)) return '';
    const match = (options || []).find(o => o.value === value);
    return match ? match.label : String(value);
}

/** Code points, not UTF-16 units (TC-012): an emoji counts as one. */
export function codePointLength(value) {
    return isBlank(value) ? 0 : [...String(value)].length;
}

// ---------------------------------------------------------------- sorting

let collator;
function textCollator() {
    // TC-049..054: case-insensitive, accents after their base letter, and text
    // "10" before "9" (no numeric collation — that is what the Number column is for).
    if (!collator) collator = new Intl.Collator(LOCALE, { sensitivity: 'accent', numeric: false });
    return collator;
}

/** Compare two decimal strings exactly, without going through a float. */
function compareDecimalStrings(a, b) {
    const norm = s => {
        const neg = s.trim().startsWith('-');
        const [i, f = ''] = s.trim().replace(/^[-+]/, '').split('.');
        return { neg, i: i.replace(/^0+(?=\d)/, ''), f: f.replace(/0+$/, '') };
    };
    const x = norm(a);
    const y = norm(b);
    const isZero = v => /^0*$/.test(v.i) && v.f === '';
    if (isZero(x) && isZero(y)) return 0;
    if (x.neg !== y.neg) return x.neg ? -1 : 1;
    let c;
    if (x.i.length !== y.i.length) c = x.i.length < y.i.length ? -1 : 1;
    else if (x.i !== y.i) c = x.i < y.i ? -1 : 1;
    else {
        const len = Math.max(x.f.length, y.f.length);
        const fa = x.f.padEnd(len, '0');
        const fb = y.f.padEnd(len, '0');
        c = fa === fb ? 0 : fa < fb ? -1 : 1;
    }
    return x.neg ? -c : c;
}

function compareNumbers(a, b) {
    const x = toSafeNumeric(a);
    const y = toSafeNumeric(b);
    if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1;
    return compareDecimalStrings(String(a), String(b));
}

/**
 * { [value]: position } for a picklist's values, in the field's own order,
 * keyed in lower case. SOQL's ORDER BY sorts a picklist this way, so a
 * sort in the browser must too, or the order would change when the last page
 * arrived (measured: Opportunity stages came back Prospecting, Qualification
 * ... Closed Won).
 */
export function picklistRanks(options) {
    const ranks = new Map();
    (options || []).forEach(o => {
        const key = String(o.value).trim().toLowerCase();
        if (!ranks.has(key)) ranks.set(key, ranks.size);
    });
    return ranks;
}

/** Two picklist values by the field's order; a value no longer in the list after every one that is, by its text. */
function comparePicklist(a, b, ranks) {
    const ka = String(a).trim().toLowerCase();
    const kb = String(b).trim().toLowerCase();
    const ra = ranks.has(ka) ? ranks.get(ka) : ranks.size;
    const rb = ranks.has(kb) ? ranks.get(kb) : ranks.size;
    if (ra !== rb) return ra - rb;
    return ra === ranks.size ? textCollator().compare(String(a), String(b)) : 0;
}

/**
 * Compare two values of one column. Nulls sort LAST in both directions — the
 * same rule GridDataService emits as NULLS LAST, so client and server agree.
 * `ranks` (picklistRanks) puts a picklist in its own order.
 */
export function compareValues(a, b, type = 'text', direction = 'asc', ranks = null) {
    const aBlank = isBlank(a);
    const bBlank = isBlank(b);
    if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1;
    let c;
    if (ranks && type === 'picklist') c = comparePicklist(a, b, ranks);
    else if (isNumericType(type)) c = compareNumbers(a, b);
    else if (type === 'date') c = a === b ? 0 : a < b ? -1 : 1;
    else if (type === 'datetime') c = Date.parse(a) - Date.parse(b);
    else if (type === 'checkbox' || type === 'boolean') c = (a === true ? 1 : 0) - (b === true ? 1 : 0);
    else c = textCollator().compare(String(a), String(b));
    c = Math.sign(c);
    return direction === 'desc' ? -c : c;
}

/**
 * A stable, deterministic multi-key sort that returns a NEW array. Ties fall
 * back to the key field so two runs over the same data always agree (TC-047/048).
 *
 * @param {Array<object>} rows
 * @param {Array<{field,type,direction,names?,ranks?}>} keys  primary first
 * @param {string} keyField
 */
export function sortRows(rows, keys, keyField = 'Id') {
    if (!keys || !keys.length) return rows.slice();
    // A lookup sorts by the name shown, not the Id stored: `names` is
    // { [recordId]: name } for keys on a lookup or owner column.
    const valueOf = (row, k) =>
        k.names && !isBlank(row[k.field]) ? k.names[row[k.field]] || row[k.field] : row[k.field];
    return rows.slice().sort((r1, r2) => {
        for (const k of keys) {
            const c = compareValues(valueOf(r1, k), valueOf(r2, k), k.type, k.direction, k.ranks || null);
            if (c !== 0) return c;
        }
        const i1 = String(r1[keyField]);
        const i2 = String(r2[keyField]);
        return i1 === i2 ? 0 : i1 < i2 ? -1 : 1;
    });
}
