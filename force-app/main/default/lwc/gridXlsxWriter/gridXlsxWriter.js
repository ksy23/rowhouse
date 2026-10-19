/**
 * gridXlsxWriter — writes an Excel workbook (.xlsx) of one sheet.
 *
 * Our own writer, not a library (HR-26: no third-party JavaScript), the
 * other half of c/gridXlsx, which reads one. An .xlsx file is a ZIP archive
 * of XML parts, so this module:
 *   1. writes the parts: the workbook, one worksheet, its styles, and the
 *      package's content types and relationships (SpreadsheetML, ECMA-376);
 *   2. compresses each part with DEFLATE (RFC 1951, fixed Huffman codes and
 *      LZ77 matches, written here), or stores it when that is no smaller;
 *   3. packs them into a ZIP archive with each part's CRC-32.
 * Nothing depends on a browser API beyond typed arrays, so it works under
 * Lightning Web Security and Lightning Locker alike.
 *
 * THE SHEET IT IS GIVEN (c/gridExcel builds it from the grid)
 *   { name, title,
 *     columns: [{ width }],            width in Excel's characters
 *     freeze: { rows, columns },       panes frozen at the top and left
 *     autoFilter: true|false|n,        filter buttons on the first row, over every
 *                                      row (true) or the first n (a Total row below
 *                                      stays out of the filter and its sort)
 *     rows: [{ level, cells }] }       level: the row's outline level, 0 to 7
 * Each cell is null (nothing written) or
 *   { v, t, f, style }
 *   t      's' text, 'n' a number, 'b' true or false; a number may be a
 *          decimal string, written as it is, so no digit is lost on the way
 *   f      a formula (no leading =), with v as its last value
 *   style  { numFmt (a format code, or a built-in format's number), bold,
 *            italic, color, fill, align, indent, wrap, top, borderTop,
 *            borderBottom, borderLeft: { style, color } }; colors as RRGGBB.
 *          Cells that look alike should share one style object: the
 *          format each object stands for is worked out once.
 *
 * Text cells are inline strings, never shared strings, so no value is ever
 * read as a formula: a text that begins with = is text in this file (the
 * CSV export has to neutralise it; this one does not).
 */

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Excel's own limits. */
export const MAX_TEXT = 32767;
export const MAX_SHEET_NAME = 31;
export const MAX_OUTLINE = 7;

// ================================================================ bytes

/**
 * A growing byte buffer, written as UTF-8. TextEncoder is not relied on:
 * a lone half of a surrogate pair becomes U+FFFD, as TextEncoder would.
 */
class Bytes {
    constructor(size = 65536) {
        this.buf = new Uint8Array(size);
        this.length = 0;
    }

    ensure(more) {
        if (this.length + more <= this.buf.length) return;
        let size = this.buf.length * 2;
        while (size < this.length + more) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buf.subarray(0, this.length));
        this.buf = next;
    }

    text(s) {
        const n = s.length;
        this.ensure(n * 3);
        const b = this.buf;
        let p = this.length;
        for (let i = 0; i < n; i++) {
            let c = s.charCodeAt(i);
            if (c < 0x80) {
                b[p++] = c;
            } else if (c < 0x800) {
                b[p++] = 0xc0 | (c >> 6);
                b[p++] = 0x80 | (c & 63);
            } else if (c >= 0xd800 && c <= 0xdfff) {
                const next = i + 1 < n ? s.charCodeAt(i + 1) : 0;
                if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
                    c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
                    i++;
                    b[p++] = 0xf0 | (c >> 18);
                    b[p++] = 0x80 | ((c >> 12) & 63);
                    b[p++] = 0x80 | ((c >> 6) & 63);
                    b[p++] = 0x80 | (c & 63);
                } else {
                    b[p++] = 0xef; // U+FFFD
                    b[p++] = 0xbf;
                    b[p++] = 0xbd;
                }
            } else {
                b[p++] = 0xe0 | (c >> 12);
                b[p++] = 0x80 | ((c >> 6) & 63);
                b[p++] = 0x80 | (c & 63);
            }
        }
        this.length = p;
        return this;
    }

    bytes() {
        return this.buf.slice(0, this.length);
    }
}

/** UTF-8 bytes of a string. */
export function utf8Encode(text) {
    return new Bytes(Math.max(16, text.length + 16)).text(text).bytes();
}

// ================================================================ CRC-32

let crcTable = null;

/** CRC-32 (ISO 3309, the ZIP checksum) of the bytes. */
export function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

// ================================================================ DEFLATE

const LENGTH_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

const WINDOW = 32768;
const WINDOW_MASK = WINDOW - 1;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const MAX_MATCH = 258;
const MIN_MATCH = 3;
/** How many earlier places a match is looked for at: more compresses a little better, slower. */
const MAX_CHAIN = 24;

let fixedCodes = null;

function reverse(code, bits) {
    let r = 0;
    for (let i = 0; i < bits; i++) {
        r = (r << 1) | (code & 1);
        code >>= 1;
    }
    return r;
}

/** The fixed Huffman codes (RFC 1951 3.2.6), bit-reversed for writing least significant bit first. */
function codes() {
    if (fixedCodes) return fixedCodes;
    const lit = new Uint16Array(288);
    const litBits = new Uint8Array(288);
    for (let i = 0; i < 288; i++) {
        let code;
        let bits;
        if (i < 144) {
            code = 0x30 + i;
            bits = 8;
        } else if (i < 256) {
            code = 0x190 + (i - 144);
            bits = 9;
        } else if (i < 280) {
            code = i - 256;
            bits = 7;
        } else {
            code = 0xc0 + (i - 280);
            bits = 8;
        }
        lit[i] = reverse(code, bits);
        litBits[i] = bits;
    }
    const dist = new Uint16Array(30);
    for (let i = 0; i < 30; i++) dist[i] = reverse(i, 5);
    // The length code for each match length, 3 to 258.
    const lengthCode = new Uint8Array(MAX_MATCH + 1);
    for (let code = 0; code < 29; code++) {
        const top = code === 28 ? 258 : LENGTH_BASE[code + 1] - 1;
        for (let len = LENGTH_BASE[code]; len <= top && len <= MAX_MATCH; len++) lengthCode[len] = code;
    }
    lengthCode[258] = 28;
    fixedCodes = { lit, litBits, dist, lengthCode };
    return fixedCodes;
}

function distanceCode(d) {
    let lo = 0;
    let hi = 29;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (DIST_BASE[mid] <= d) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/**
 * Raw DEFLATE (no zlib header) of the bytes: one block of fixed Huffman
 * codes, with LZ77 matches found through a hash of the next three bytes.
 * XML of a sheet compresses to about a tenth.
 */
export function deflateRaw(input) {
    const { lit, litBits, dist, lengthCode } = codes();
    const n = input.length;
    let out = new Uint8Array(n + (n >> 3) + 1024);
    let pos = 0;
    let bitBuf = 0;
    let bitCount = 0;
    const put = (value, bits) => {
        bitBuf |= value << bitCount;
        bitCount += bits;
        while (bitCount >= 8) {
            if (pos >= out.length) {
                const grown = new Uint8Array(out.length * 2);
                grown.set(out);
                out = grown;
            }
            out[pos++] = bitBuf & 255;
            bitBuf >>>= 8;
            bitCount -= 8;
        }
    };
    put(1, 1); // the last block
    put(1, 2); // fixed Huffman codes
    const head = new Int32Array(HASH_SIZE).fill(-1);
    const prev = new Int32Array(WINDOW);
    const hashAt = i => ((input[i] << 10) ^ (input[i + 1] << 5) ^ input[i + 2]) & (HASH_SIZE - 1);
    const insert = i => {
        const h = hashAt(i);
        prev[i & WINDOW_MASK] = head[h];
        head[h] = i;
    };
    let i = 0;
    while (i < n) {
        let best = 0;
        let bestDist = 0;
        if (i + MIN_MATCH <= n) {
            const max = Math.min(MAX_MATCH, n - i);
            let candidate = head[hashAt(i)];
            let chain = MAX_CHAIN;
            while (candidate >= 0 && i - candidate <= WINDOW && chain-- > 0) {
                if (input[candidate + best] === input[i + best] && input[candidate] === input[i]) {
                    let len = 0;
                    while (len < max && input[candidate + len] === input[i + len]) len++;
                    if (len > best) {
                        best = len;
                        bestDist = i - candidate;
                        if (len >= max) break;
                    }
                }
                const older = prev[candidate & WINDOW_MASK];
                if (older >= candidate) break; // the slot was reused for a later place
                candidate = older;
            }
            insert(i);
        }
        if (best >= MIN_MATCH) {
            const code = lengthCode[best];
            put(lit[257 + code], litBits[257 + code]);
            if (LENGTH_EXTRA[code]) put(best - LENGTH_BASE[code], LENGTH_EXTRA[code]);
            const dc = distanceCode(bestDist);
            put(dist[dc], 5);
            if (DIST_EXTRA[dc]) put(bestDist - DIST_BASE[dc], DIST_EXTRA[dc]);
            for (let k = 1; k < best; k++) if (i + k + MIN_MATCH <= n) insert(i + k);
            i += best;
        } else {
            put(lit[input[i]], litBits[input[i]]);
            i++;
        }
    }
    put(lit[256], litBits[256]); // end of block
    if (bitCount > 0) put(0, 8 - bitCount);
    return out.slice(0, pos);
}

// ================================================================ ZIP

function dosDateTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
}

/**
 * A ZIP archive of the files ([{ name, data }]), each deflated, or stored
 * when deflating makes it no smaller.
 */
export function zip(files, date = new Date()) {
    const { time, date: day } = dosDateTime(date);
    const entries = files.map(f => {
        const name = utf8Encode(f.name);
        const crc = crc32(f.data);
        const packed = deflateRaw(f.data);
        const stored = packed.length >= f.data.length;
        return { name, crc, size: f.data.length, method: stored ? 0 : 8, body: stored ? f.data : packed };
    });
    let total = 22;
    entries.forEach(e => {
        total += 30 + e.name.length + e.body.length + 46 + e.name.length;
    });
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let p = 0;
    const u16 = v => {
        view.setUint16(p, v, true);
        p += 2;
    };
    const u32 = v => {
        view.setUint32(p, v >>> 0, true);
        p += 4;
    };
    entries.forEach(e => {
        e.offset = p;
        u32(0x04034b50);
        u16(20); // version needed: 2.0
        u16(0); // flags
        u16(e.method);
        u16(time);
        u16(day);
        u32(e.crc);
        u32(e.body.length);
        u32(e.size);
        u16(e.name.length);
        u16(0);
        out.set(e.name, p);
        p += e.name.length;
        out.set(e.body, p);
        p += e.body.length;
    });
    const central = p;
    entries.forEach(e => {
        u32(0x02014b50);
        u16(20); // made by
        u16(20); // needed
        u16(0);
        u16(e.method);
        u16(time);
        u16(day);
        u32(e.crc);
        u32(e.body.length);
        u32(e.size);
        u16(e.name.length);
        u16(0); // extra
        u16(0); // comment
        u16(0); // disk
        u16(0); // internal attributes
        u32(0); // external attributes
        u32(e.offset);
        out.set(e.name, p);
        p += e.name.length;
    });
    const centralSize = p - central;
    u32(0x06054b50);
    u16(0);
    u16(0);
    u16(entries.length);
    u16(entries.length);
    u32(centralSize);
    u32(central);
    u16(0);
    return out;
}

// ================================================================ XML

// Characters XML 1.0 does not allow, whatever the escaping.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const NOT_XML = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\ufffe\\uffff]', 'g');

/** Text for an XML element or attribute: escaped, and without characters XML cannot hold. */
export function xmlEscape(value) {
    return String(value)
        .replace(NOT_XML, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** A column's letters: 1 is A, 27 is AA. */
export function columnName(n) {
    let s = '';
    let k = n;
    while (k > 0) {
        const m = (k - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        k = Math.floor((k - 1) / 26);
    }
    return s;
}

/**
 * A sheet name Excel accepts: no [ ] : * ? / \, not blank, not starting or
 * ending with an apostrophe, and 31 characters at most.
 */
export function sheetName(name) {
    const clean = String(name || '')
        .replace(NOT_XML, '')
        .replace(/[[\]:*?/\\]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SHEET_NAME)
        .trim();
    return clean || 'Sheet1';
}

const color = rgb =>
    'FF' +
    String(rgb || '000000')
        .replace(/^#/, '')
        .toUpperCase();

/** The workbook's styles: each distinct look becomes one cell format (xf), shared by every cell that has it. */
class Styles {
    constructor() {
        this.numFmts = new Map(); // format code -> id
        this.fonts = new Map([['', 0]]);
        this.fontXml = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'];
        this.fills = new Map([
            ['none', 0],
            ['gray125', 1]
        ]);
        this.fillXml = [
            '<fill><patternFill patternType="none"/></fill>',
            '<fill><patternFill patternType="gray125"/></fill>'
        ];
        this.borders = new Map([['', 0]]);
        this.borderXml = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
        this.xfs = new Map([['0|0|0|0|', 0]]);
        this.xfXml = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
        this.seen = new WeakMap(); // style object -> its format's index
    }

    numFmt(code) {
        if (code === undefined || code === null || code === '') return 0;
        if (typeof code === 'number') return code; // a built-in format
        if (!this.numFmts.has(code)) this.numFmts.set(code, 164 + this.numFmts.size);
        return this.numFmts.get(code);
    }

    font(s) {
        const key = [s.bold ? 'b' : '', s.italic ? 'i' : '', s.color || ''].join('|');
        if (key === '||') return 0;
        if (!this.fonts.has(key)) {
            this.fonts.set(key, this.fontXml.length);
            this.fontXml.push(
                '<font>' +
                    (s.bold ? '<b/>' : '') +
                    (s.italic ? '<i/>' : '') +
                    '<sz val="11"/>' +
                    (s.color ? `<color rgb="${color(s.color)}"/>` : '<color theme="1"/>') +
                    '<name val="Calibri"/><family val="2"/></font>'
            );
        }
        return this.fonts.get(key);
    }

    fill(rgb) {
        if (!rgb) return 0;
        if (!this.fills.has(rgb)) {
            this.fills.set(rgb, this.fillXml.length);
            this.fillXml.push(
                `<fill><patternFill patternType="solid"><fgColor rgb="${color(rgb)}"/><bgColor indexed="64"/></patternFill></fill>`
            );
        }
        return this.fills.get(rgb);
    }

    border(s) {
        const left = s.borderLeft ? `${s.borderLeft.style || 'thin'}:${s.borderLeft.color || ''}` : '';
        const top = s.borderTop ? `${s.borderTop.style || 'thin'}:${s.borderTop.color || ''}` : '';
        const bottom = s.borderBottom ? `${s.borderBottom.style || 'thin'}:${s.borderBottom.color || ''}` : '';
        const key = [left, top, bottom].join('|');
        if (key === '||') return 0;
        if (!this.borders.has(key)) {
            const side = (name, b) =>
                b
                    ? `<${name} style="${b.style || 'thin'}">` +
                      (b.color ? `<color rgb="${color(b.color)}"/>` : '<color indexed="64"/>') +
                      `</${name}>`
                    : `<${name}/>`;
            this.borders.set(key, this.borderXml.length);
            this.borderXml.push(
                '<border>' +
                    side('left', s.borderLeft) +
                    '<right/>' +
                    side('top', s.borderTop) +
                    side('bottom', s.borderBottom) +
                    '<diagonal/></border>'
            );
        }
        return this.borders.get(key);
    }

    /** The cell format for a style: its index in cellXfs. */
    id(style) {
        if (!style) return 0;
        const known = this.seen.get(style);
        if (known !== undefined) return known;
        const index = this.make(style);
        this.seen.set(style, index);
        return index;
    }

    make(style) {
        const numFmtId = this.numFmt(style.numFmt);
        const fontId = this.font(style);
        const fillId = this.fill(style.fill);
        const borderId = this.border(style);
        const indent = Number.isInteger(style.indent) && style.indent > 0 ? Math.min(style.indent, 15) : 0;
        const align = [style.align || '', style.wrap ? 'w' : '', style.top ? 't' : '', indent || ''].join('');
        const key = [numFmtId, fontId, fillId, borderId, align].join('|');
        if (!this.xfs.has(key)) {
            this.xfs.set(key, this.xfXml.length);
            const horizontal = style.align || (indent ? 'left' : '');
            const alignment = align
                ? '<alignment' +
                  (horizontal ? ` horizontal="${horizontal}"` : '') +
                  (indent ? ` indent="${indent}"` : '') +
                  (style.top ? ' vertical="top"' : '') +
                  (style.wrap ? ' wrapText="1"' : '') +
                  '/>'
                : '';
            this.xfXml.push(
                `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
                    (numFmtId ? ' applyNumberFormat="1"' : '') +
                    (fontId ? ' applyFont="1"' : '') +
                    (fillId ? ' applyFill="1"' : '') +
                    (borderId ? ' applyBorder="1"' : '') +
                    (alignment ? ` applyAlignment="1">${alignment}</xf>` : '/>')
            );
        }
        return this.xfs.get(key);
    }

    xml() {
        const numFmts = [...this.numFmts.entries()]
            .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`)
            .join('');
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            `<styleSheet xmlns="${MAIN_NS}">` +
            (this.numFmts.size ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : '') +
            `<fonts count="${this.fontXml.length}">${this.fontXml.join('')}</fonts>` +
            `<fills count="${this.fillXml.length}">${this.fillXml.join('')}</fills>` +
            `<borders count="${this.borderXml.length}">${this.borderXml.join('')}</borders>` +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            `<cellXfs count="${this.xfXml.length}">${this.xfXml.join('')}</cellXfs>` +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
            '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
            '</styleSheet>'
        );
    }
}

/** A number as a cell's <v>: a finite number, or a plain decimal string kept as it is. */
function numberText(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
    const s = String(v).trim();
    return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s) ? s : null;
}

function cellXml(ref, cell, styles) {
    const s = styles.id(cell.style);
    const sAttr = s ? ` s="${s}"` : '';
    if (cell.f) {
        const cached = cell.v === null || cell.v === undefined ? null : numberText(cell.v);
        return `<c r="${ref}"${sAttr}><f>${xmlEscape(cell.f)}</f>${cached !== null ? `<v>${cached}</v>` : ''}</c>`;
    }
    const v = cell.v;
    if (v === null || v === undefined || v === '') return s ? `<c r="${ref}"${sAttr}/>` : '';
    if (cell.t === 'n') {
        const text = numberText(v);
        if (text !== null) return `<c r="${ref}"${sAttr}><v>${text}</v></c>`;
    }
    if (cell.t === 'b') return `<c r="${ref}"${sAttr} t="b"><v>${v === true || v === 'true' ? 1 : 0}</v></c>`;
    let text = String(v);
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function paneXml(freeze) {
    const rows = Math.max(0, Number(freeze && freeze.rows) || 0);
    const cols = Math.max(0, Number(freeze && freeze.columns) || 0);
    if (!rows && !cols) return '<sheetView workbookViewId="0"/>';
    const top = columnName(cols + 1) + (rows + 1);
    const pane = rows && cols ? 'bottomRight' : rows ? 'bottomLeft' : 'topRight';
    return (
        '<sheetView workbookViewId="0">' +
        `<pane${cols ? ` xSplit="${cols}"` : ''}${rows ? ` ySplit="${rows}"` : ''} topLeftCell="${top}" activePane="${pane}" state="frozen"/>` +
        `<selection pane="${pane}" activeCell="${top}" sqref="${top}"/>` +
        '</sheetView>'
    );
}

function sheetXml(sheet, styles) {
    const out = new Bytes(1 << 20);
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
    // Loops, not Math.max(...rows): a spread of 100,000 rows can pass the engine's argument limit.
    let width = Math.max(1, columns.length);
    let outline = 0;
    for (const r of rows) {
        if (r.cells && r.cells.length > width) width = r.cells.length;
        const level = Number(r.level) || 0;
        if (level > outline) outline = level;
    }
    outline = Math.min(MAX_OUTLINE, outline);
    const last = columnName(width) + Math.max(1, rows.length);
    const filterRef = filterRange(sheet.autoFilter, width, rows.length);
    out.text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n');
    out.text(`<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`);
    if (outline) out.text('<sheetPr><outlinePr summaryBelow="1"/></sheetPr>');
    out.text(`<dimension ref="A1:${last}"/>`);
    out.text(`<sheetViews>${paneXml(sheet.freeze)}</sheetViews>`);
    out.text(`<sheetFormatPr defaultRowHeight="15"${outline ? ` outlineLevelRow="${outline}"` : ''}/>`);
    if (columns.length) {
        out.text('<cols>');
        columns.forEach((c, i) => {
            const w = Number(c && c.width);
            if (Number.isFinite(w) && w > 0)
                out.text(`<col min="${i + 1}" max="${i + 1}" width="${Math.round(w * 100) / 100}" customWidth="1"/>`);
        });
        out.text('</cols>');
    }
    out.text('<sheetData>');
    rows.forEach((row, r) => {
        const level = Math.min(MAX_OUTLINE, Math.max(0, Number(row.level) || 0));
        out.text(`<row r="${r + 1}"${level ? ` outlineLevel="${level}"` : ''}>`);
        (row.cells || []).forEach((cell, c) => {
            if (cell) out.text(cellXml(columnName(c + 1) + (r + 1), cell, styles));
        });
        out.text('</row>');
    });
    out.text('</sheetData>');
    if (filterRef) out.text(`<autoFilter ref="${filterRef}"/>`);
    out.text('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
    return { bytes: out.bytes(), filterRef };
}

/** The range the filter buttons cover: every row, or the first n; null for none. */
function filterRange(autoFilter, width, rowCount) {
    if (!autoFilter || !rowCount) return null;
    const n = autoFilter === true ? rowCount : Math.min(rowCount, Math.floor(Number(autoFilter)));
    if (!(n >= 1)) return null;
    return `A1:${columnName(width)}${n}`;
}

function workbookXml(name, filterRef) {
    const quoted = "'" + name.replace(/'/g, "''") + "'";
    const absolute = filterRef ? filterRef.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2') : null;
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
        '<workbookPr/><bookViews><workbookView/></bookViews>' +
        `<sheets><sheet name="${xmlEscape(name)}" sheetId="1" r:id="rId1"/></sheets>` +
        (absolute
            ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xmlEscape(
                  quoted + '!' + absolute
              )}</definedName></definedNames>`
            : '') +
        '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
        '</workbook>'
    );
}

const CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

const ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${DOC_REL}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>';

const WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="${DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>';

function coreXml(title, date) {
    const when = (date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date())
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        (title ? `<dc:title>${xmlEscape(title)}</dc:title>` : '') +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>` +
        '</cp:coreProperties>'
    );
}

const APP_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    '<Application>Rowhouse Grid</Application></Properties>';

/**
 * The workbook, as the bytes of an .xlsx file.
 * @param {object} sheet see THE SHEET IT IS GIVEN
 * @param {Date} [date] when it was made: the archive's dates and the file's Created property
 */
export function toXlsx(sheet, date = new Date()) {
    const styles = new Styles();
    const name = sheetName(sheet && sheet.name);
    const { bytes: sheetBytes, filterRef } = sheetXml(sheet || {}, styles);
    return zip(
        [
            { name: '[Content_Types].xml', data: utf8Encode(CONTENT_TYPES) },
            { name: '_rels/.rels', data: utf8Encode(ROOT_RELS) },
            { name: 'docProps/core.xml', data: utf8Encode(coreXml(sheet && (sheet.title || sheet.name), date)) },
            { name: 'docProps/app.xml', data: utf8Encode(APP_XML) },
            { name: 'xl/workbook.xml', data: utf8Encode(workbookXml(name, filterRef)) },
            { name: 'xl/_rels/workbook.xml.rels', data: utf8Encode(WORKBOOK_RELS) },
            { name: 'xl/styles.xml', data: utf8Encode(styles.xml()) },
            { name: 'xl/worksheets/sheet1.xml', data: sheetBytes }
        ],
        date
    );
}
