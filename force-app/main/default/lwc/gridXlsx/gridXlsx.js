/**
 * gridXlsx — reads a worksheet of an Excel .xlsx file: the first, or
 * the one the user chooses.
 *
 * Our own reader, not a library (HR-26: no third-party JavaScript). An .xlsx
 * file is a ZIP archive of XML parts, so this module does three things:
 *   1. finds the parts in the ZIP's central directory and inflates them
 *      (DEFLATE, RFC 1951, written here; stored parts are copied);
 *   2. decodes UTF-8 and reads the few SpreadsheetML elements it needs with a
 *      small tag scanner (no DOMParser, which Lightning Locker may not offer);
 *   3. turns cells into values: shared and inline strings, numbers, booleans,
 *      and dates, which Excel stores as numbers with a date format, so the
 *      cell's number format is read from styles.xml.
 *
 * readXlsx(bytes, sheetName) returns { sheet, sheets, rows }: the sheet read,
 * every sheet's name, and the rows, an array of rows in which
 * each cell is { t, v }: t is 's' (text), 'n' (a number, written plainly as
 * 1234.5), 'd' (a date, 2026-12-31, or a date and time, 2026-12-31T09:30:00),
 * or 'b' (true or false). Empty cells are null. It throws an Error whose
 * message a user can act on when the file is not an .xlsx workbook.
 *
 * Not read: formulas (their last computed value is used), merged cells (only
 * the top-left cell holds the value), and the old binary .xls format.
 */

// ------------------------------------------------------------------ inflate

const LENGTH_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const MAX_BITS = 15;

function corrupt() {
    return new Error('This file could not be read: it is damaged, or it is not an Excel .xlsx workbook.');
}

/** A canonical Huffman code from code lengths: counts per length and symbols in code order. */
function huffman(lengths) {
    const counts = new Uint16Array(MAX_BITS + 1);
    lengths.forEach(len => {
        counts[len]++;
    });
    counts[0] = 0;
    const offsets = new Uint16Array(MAX_BITS + 2);
    for (let len = 1; len <= MAX_BITS; len++) offsets[len + 1] = offsets[len] + counts[len];
    const symbols = new Uint16Array(lengths.length);
    lengths.forEach((len, symbol) => {
        if (len) symbols[offsets[len]++] = symbol;
    });
    return { counts, symbols };
}

let fixedCodes = null;
function fixed() {
    if (!fixedCodes) {
        const lit = [];
        for (let i = 0; i < 288; i++) lit.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
        fixedCodes = { lit: huffman(lit), dist: huffman(new Array(30).fill(5)) };
    }
    return fixedCodes;
}

/**
 * Inflate raw DEFLATE data (no zlib or gzip header). `size`, when known, is
 * the inflated length, so the output is allocated once.
 */
export function inflateRaw(input, size = 0) {
    const src = input;
    let pos = 0;
    let bitBuf = 0;
    let bitCount = 0;
    let out = new Uint8Array(size > 0 ? size : Math.max(1024, src.length * 4));
    let length = 0;

    const need = n => {
        while (bitCount < n) {
            if (pos >= src.length) throw corrupt();
            bitBuf |= src[pos++] << bitCount;
            bitCount += 8;
        }
    };
    const bits = n => {
        if (!n) return 0;
        need(n);
        const value = bitBuf & ((1 << n) - 1);
        bitBuf >>>= n;
        bitCount -= n;
        return value;
    };
    const room = n => {
        if (length + n <= out.length) return;
        let next = out.length * 2;
        while (next < length + n) next *= 2;
        const bigger = new Uint8Array(next);
        bigger.set(out.subarray(0, length));
        out = bigger;
    };
    const decode = code => {
        let value = 0;
        let first = 0;
        let index = 0;
        for (let len = 1; len <= MAX_BITS; len++) {
            value |= bits(1);
            const count = code.counts[len];
            if (value - first < count) return code.symbols[index + value - first];
            index += count;
            first = (first + count) << 1;
            value <<= 1;
        }
        throw corrupt();
    };
    const block = (lit, dist) => {
        for (;;) {
            const symbol = decode(lit);
            if (symbol < 256) {
                room(1);
                out[length++] = symbol;
            } else if (symbol === 256) {
                return;
            } else {
                const i = symbol - 257;
                if (i >= LENGTH_BASE.length) throw corrupt();
                const len = LENGTH_BASE[i] + bits(LENGTH_EXTRA[i]);
                const d = decode(dist);
                if (d >= DIST_BASE.length) throw corrupt();
                const back = DIST_BASE[d] + bits(DIST_EXTRA[d]);
                if (back > length) throw corrupt();
                room(len);
                for (let k = 0; k < len; k++) {
                    out[length] = out[length - back];
                    length++;
                }
            }
        }
    };

    let last = 0;
    while (!last) {
        last = bits(1);
        const type = bits(2);
        if (type === 0) {
            bitBuf = 0;
            bitCount = 0; // a stored block starts on a byte boundary
            if (pos + 4 > src.length) throw corrupt();
            const len = src[pos] | (src[pos + 1] << 8);
            const nlen = src[pos + 2] | (src[pos + 3] << 8);
            pos += 4;
            if ((len ^ 0xffff) !== nlen || pos + len > src.length) throw corrupt();
            room(len);
            out.set(src.subarray(pos, pos + len), length);
            length += len;
            pos += len;
        } else if (type === 1) {
            const f = fixed();
            block(f.lit, f.dist);
        } else if (type === 2) {
            const nlit = bits(5) + 257;
            const ndist = bits(5) + 1;
            const ncode = bits(4) + 4;
            const codeLengths = new Array(19).fill(0);
            for (let i = 0; i < ncode; i++) codeLengths[CODE_LENGTH_ORDER[i]] = bits(3);
            const lengthCode = huffman(codeLengths);
            const lengths = [];
            while (lengths.length < nlit + ndist) {
                const symbol = decode(lengthCode);
                if (symbol < 16) {
                    lengths.push(symbol);
                } else if (symbol === 16) {
                    if (!lengths.length) throw corrupt();
                    const previous = lengths[lengths.length - 1];
                    for (let n = 3 + bits(2); n > 0; n--) lengths.push(previous);
                } else {
                    for (let n = symbol === 17 ? 3 + bits(3) : 11 + bits(7); n > 0; n--) lengths.push(0);
                }
            }
            if (lengths.length > nlit + ndist) throw corrupt();
            block(huffman(lengths.slice(0, nlit)), huffman(lengths.slice(nlit)));
        } else {
            throw corrupt();
        }
    }
    return out.subarray(0, length);
}

// ------------------------------------------------------------------ zip

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/**
 * The files in a ZIP archive, by name: { name: () => Uint8Array }. Each is
 * inflated only when asked for, so parts the reader does not need cost nothing.
 */
export function readZip(bytes) {
    const b = bytes;
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
        if (u32(b, i) === 0x06054b50) {
            end = i;
            break;
        }
    }
    if (end < 0) throw corrupt();
    const entries = u16(b, end + 10);
    let at = u32(b, end + 16);
    const files = {};
    for (let n = 0; n < entries; n++) {
        if (at + 46 > b.length || u32(b, at) !== 0x02014b50) throw corrupt();
        const method = u16(b, at + 10);
        const compressed = u32(b, at + 20);
        const size = u32(b, at + 24);
        const nameLength = u16(b, at + 28);
        const extraLength = u16(b, at + 30);
        const commentLength = u16(b, at + 32);
        const local = u32(b, at + 42);
        const name = utf8(b.subarray(at + 46, at + 46 + nameLength));
        at += 46 + nameLength + extraLength + commentLength;
        if (local + 30 > b.length || u32(b, local) !== 0x04034b50) throw corrupt();
        const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const data = b.subarray(start, start + compressed);
        files[name] = () => {
            if (method === 0) return data;
            if (method === 8) return inflateRaw(data, size);
            throw corrupt();
        };
    }
    return files;
}

// ------------------------------------------------------------------ text

/** UTF-8 bytes as a string, without TextDecoder, which Lightning Locker may not offer. */
export function utf8(bytes) {
    const b = bytes;
    const parts = [];
    let units = [];
    let i = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
    while (i < b.length) {
        const c = b[i++];
        let cp;
        if (c < 0x80) cp = c;
        else if (c >= 0xc0 && c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
        else if (c >= 0xe0 && c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
        else if (c >= 0xf0)
            cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
        else cp = 0xfffd;
        if (cp > 0xffff) {
            cp -= 0x10000;
            units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else {
            units.push(cp);
        }
        if (units.length >= 8192) {
            parts.push(String.fromCharCode.apply(null, units));
            units = [];
        }
    }
    parts.push(String.fromCharCode.apply(null, units));
    return parts.join('');
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * XML text as a string: the five named entities, numeric references, and
 * Excel's own _xHHHH_ escape for characters XML cannot hold (a carriage return
 * is _x000D_; a literal "_x" is written _x005F_x).
 */
export function xmlText(raw) {
    return raw
        .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
            if (e[0] !== '#') return ENTITIES[e];
            const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return String.fromCodePoint(cp);
        })
        .replace(/_x([0-9a-fA-F]{4})_/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** An element's attributes, prefixes dropped: { name: value }. */
function attributes(text) {
    const out = {};
    const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(text))) {
        const name = m[1].includes(':') ? m[1].slice(m[1].indexOf(':') + 1) : m[1];
        out[name] = xmlText(m[3] !== undefined ? m[3] : m[4]);
    }
    return out;
}

/** Every element `name` (any namespace prefix): [{ attrs, body }]; body is '' when self-closing. */
function elements(xml, name) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(xml))) out.push({ attrs: attributes(m[1] || ''), body: m[2] || '' });
    return out;
}

/** The text of a string item: every <t> run, but not phonetic guides (<rPh>). */
function runText(body) {
    const plain = body.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, '');
    return elements(plain, 't')
        .map(t => xmlText(t.body))
        .join('');
}

// ------------------------------------------------------------------ dates

// Built-in number formats that are dates or times (ECMA-376 18.8.30), and the
// East Asian date formats Excel writes with ids 27 to 36 and 50 to 58.
const DATE_FORMAT_IDS = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
    57, 58
]);

/** Whether a custom number format shows a date or time. */
export function isDateFormat(code) {
    const plain = String(code || '')
        .replace(/"[^"]*"/g, '')
        .replace(/\\./g, '')
        .replace(/\[(?![hms]+\])[^\]]*\]/gi, '');
    return /[ymdhs]/i.test(plain) && !/^general$/i.test(plain.trim());
}

const pad = n => String(n).padStart(2, '0');

/** An Excel serial date as ISO: the date alone, or with the time when there is one. */
export function serialToIso(serial, date1904 = false) {
    let days = Math.floor(serial);
    const fraction = serial - days;
    let base;
    if (date1904) {
        base = Date.UTC(1904, 0, 1);
    } else {
        // Excel counts 29 February 1900, which never was, so serials from 61
        // count from 30 December 1899 and serials below 60 from the day after.
        base = days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    }
    let seconds = Math.round(fraction * 86400);
    if (seconds >= 86400) {
        days += 1;
        seconds -= 86400;
    }
    const d = new Date(base + days * 86400000);
    const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    if (!seconds) return iso;
    return `${iso}T${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

/** A number as Excel stored it, written without an exponent: "1.5E-3" is "0.0015". */
export function plainNumber(text) {
    const s = String(text).trim();
    if (!/e/i.test(s)) return s;
    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

// ------------------------------------------------------------------ workbook

/** Column letters as a 0-based index: A is 0, Z is 25, AA is 26. */
export function columnIndex(ref) {
    const letters = /^[A-Za-z]+/.exec(ref || '');
    if (!letters) return -1;
    let n = 0;
    for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function part(files, name) {
    const read = files[name];
    return read ? utf8(read()) : null;
}

/**
 * A worksheet's part name, through the workbook and its relationships: the
 * one named `wanted`, else the first (the user chooses the sheet).
 * Also every sheet's name, in the workbook's order.
 */
function findSheet(files, wanted) {
    const workbook = part(files, 'xl/workbook.xml');
    if (workbook === null) throw corrupt();
    const all = elements(workbook, 'sheet');
    if (!all.length) throw new Error('This workbook has no worksheets.');
    const sheet = (wanted && all.find(s => xmlText(s.attrs.name || '') === wanted)) || all[0];
    const names = all.map(s => xmlText(s.attrs.name || ''));
    const rels = part(files, 'xl/_rels/workbook.xml.rels') || '';
    const rel = elements(rels, 'Relationship').find(r => r.attrs.Id === sheet.attrs.id);
    let target = rel ? rel.attrs.Target : 'worksheets/sheet1.xml';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const pr = elements(workbook, 'workbookPr')[0];
    const date1904 = Boolean(pr && /^(1|true)$/i.test(pr.attrs.date1904 || ''));
    return { name: xmlText(sheet.attrs.name || 'Sheet1'), path: target, date1904, names };
}

/** For each cell style (the s attribute), whether it shows a date. */
function dateStyles(files) {
    const styles = part(files, 'xl/styles.xml');
    if (!styles) return [];
    const custom = {};
    elements(styles, 'numFmt').forEach(f => {
        custom[f.attrs.numFmtId] = f.attrs.formatCode;
    });
    const cellXfs = elements(styles, 'cellXfs')[0];
    if (!cellXfs) return [];
    return elements(cellXfs.body, 'xf').map(xf => {
        const id = Number(xf.attrs.numFmtId || 0);
        return DATE_FORMAT_IDS.has(id) || (custom[id] !== undefined && isDateFormat(custom[id]));
    });
}

/**
 * A worksheet of an .xlsx file: { sheet, sheets, rows }, the sheet named
 * `sheetName`, or the first; `sheets` lists every sheet's name.
 * `bytes` is a Uint8Array or an ArrayBuffer.
 */
export function readXlsx(bytes, sheetName = null) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 4 || u32(b, 0) !== 0x04034b50) {
        throw new Error(
            'This is not an .xlsx file. Save it from Excel as "Excel Workbook (.xlsx)" or as CSV, then try again.'
        );
    }
    const files = readZip(b);
    const sheet = findSheet(files, sheetName);
    const xml = part(files, sheet.path);
    if (xml === null) throw corrupt();
    const sharedXml = part(files, 'xl/sharedStrings.xml');
    const shared = sharedXml ? elements(sharedXml, 'si').map(si => runText(si.body)) : [];
    const isDate = dateStyles(files);

    const rows = [];
    let rowNumber = 0;
    elements(xml, 'row').forEach(row => {
        rowNumber = row.attrs.r ? Number(row.attrs.r) : rowNumber + 1;
        const cells = [];
        let col = -1;
        elements(row.body, 'c').forEach(c => {
            col = c.attrs.r ? columnIndex(c.attrs.r) : col + 1;
            const cell = readCell(c, shared, isDate, sheet.date1904);
            if (cell) cells[col] = cell;
        });
        for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
        rows[rowNumber - 1] = cells;
    });
    for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
    return { sheet: sheet.name, sheets: sheet.names, rows };
}

function readCell(c, shared, isDate, date1904) {
    const type = c.attrs.t || 'n';
    if (type === 'inlineStr') {
        const is = elements(c.body, 'is')[0];
        const text = is ? runText(is.body) : '';
        return text === '' ? null : { t: 's', v: text };
    }
    const v = elements(c.body, 'v')[0];
    if (!v) return null;
    const raw = xmlText(v.body);
    if (type === 's') {
        const text = shared[Number(raw)];
        return text === undefined || text === '' ? null : { t: 's', v: text };
    }
    if (type === 'str' || type === 'e') return raw === '' ? null : { t: 's', v: raw };
    if (type === 'b') return { t: 'b', v: raw === '1' || raw.toLowerCase() === 'true' ? 'true' : 'false' };
    if (type === 'd') return raw === '' ? null : { t: 'd', v: raw.replace(/T00:00(:00(\.0+)?)?Z?$/, '') }; // ISO 8601 cells (strict files)
    if (raw.trim() === '') return null;
    const style = Number(c.attrs.s || 0);
    if (isDate[style] && Number.isFinite(Number(raw))) return { t: 'd', v: serialToIso(Number(raw), date1904) };
    return { t: 'n', v: plainNumber(raw) };
}
