/**
 * gridCsv — CSV export. Correctness, plus one security rule.
 *
 * THE SECURITY RULE (TC-019 / TC-020)
 * A cell that begins with = + - @ (or a tab or carriage return) is executed as a
 * formula when the file is opened in a spreadsheet, and =HYPERLINK can send the
 * contents of other cells to an external URL. That is an exfiltration vector,
 * not a formatting nit.
 *
 * QUOTING IS NOT NEUTRALISATION. Excel strips CSV quotes before it evaluates the
 * cell, so "=1+1" in quotes still executes. The value itself must change: this
 * module prefixes it with a single quote, the prefix OWASP recommends, which
 * spreadsheets treat as "this is text". The prefix is the only change, so the
 * original is recoverable by removing one leading apostrophe.
 *
 * Numbers typed as numbers are NOT prefixed — "-1234" in a Number column is a
 * number, not a formula, and prefixing it would corrupt numeric data. Strings are
 * always checked, including strings that merely look numeric: in a text field,
 * "-1234" is just text and costs nothing to neutralise.
 *
 * FIELD-LEVEL SECURITY
 * toCsv writes only the fields it is given. The caller passes the columns the
 * user can actually read — the rows themselves may carry more, and anything not
 * named is never written.
 */
import { isNumericType } from 'c/gridFormat';

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
// LF, not RFC 4180's CRLF. Every spreadsheet in use reads both, and LF keeps a
// quoted multi-line value (TC-008) byte-identical to the stored value.
const EOL = '\n';

/** Neutralise a formula prefix. Exported so the rule can be tested on its own. */
export function neutralise(value) {
    return DANGEROUS_PREFIX.test(value) ? "'" + value : value;
}

function quote(text) {
    // Every field is quoted. Quoting everything is never wrong, and it means a
    // comma, quote or newline inside a value (TC-006/007/008) can never change the
    // number of columns or rows.
    return '"' + text.replace(/"/g, '""') + '"';
}

function cell(value, type) {
    if (value === null || value === undefined) return '""';
    if (typeof value === 'boolean') return quote(value ? 'true' : 'false');
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '""';
    const text = String(value);
    // TC-024: a large number arrives as a string. In a numeric column, a plain
    // decimal string is written raw so the spreadsheet reads it as a number.
    if (isNumericType(type) && PLAIN_NUMBER.test(text)) return text;
    return quote(neutralise(text));
}

/**
 * @param {Array<object>} rows
 * @param {Array<string|{field:string,label?:string,type?:string}>} columns
 * @returns {string} CSV with a header row and LF line endings (no BOM; see downloadCsv)
 */
export function toCsv(rows, columns) {
    const cols = (columns || []).map(c => (typeof c === 'string' ? { field: c } : c));
    const header = cols.map(c => quote(neutralise(c.label || c.field))).join(',');
    const lines = [header];
    for (const row of rows || []) {
        lines.push(cols.map(c => cell(row[c.field], c.type)).join(','));
    }
    return lines.join(EOL) + EOL;
}

/**
 * Hand the file to the browser, through a temporary link. The BOM makes Excel
 * read UTF-8 correctly (TC-012..015).
 *
 * The link points at a Blob (a blob: URL). Lightning Web Security refuses a
 * data: URL on a link ("HTMLAnchorElement href does not support data:"), which
 * broke Export in Lightning Experience, and it makes a URL only for a few types
 * of Blob: text/csv is refused ("Unsupported MIME type"), so the Blob is a
 * plain download (application/octet-stream); the file name keeps the .csv.
 * Where the Blob or its URL is refused (Lightning Locker restricts them), the
 * file goes as a data: URL instead. The blob: URL is let go a moment after the
 * click, once the browser has it.
 *
 * `container` is an element the caller owns (a `lwc:dom="manual"` div in its own
 * template), so the temporary link never touches the page outside the
 * component. It falls back to document.body only for callers without one.
 *
 * @returns {boolean} true once the browser was handed the file; false if both
 *   ways were refused, so the caller can say so.
 */
export function downloadCsv(csv, fileName, container) {
    // The byte order mark, as a code point. Written as an escape in source, it
    // reached the org as the invisible character itself.
    const text = String.fromCharCode(0xfeff) + csv;
    const host = container || document.body;
    const link = document.createElement('a');
    let blobUrl = null;
    try {
        blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
        link.href = blobUrl;
    } catch {
        blobUrl = null;
        try {
            link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(text);
        } catch {
            return false;
        }
    }
    link.download = fileName || 'export.csv';
    link.rel = 'noopener';
    link.style.display = 'none';
    host.appendChild(link);
    link.click();
    host.removeChild(link);
    if (blobUrl) {
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- release the file once the browser has taken it
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
    return true;
}
