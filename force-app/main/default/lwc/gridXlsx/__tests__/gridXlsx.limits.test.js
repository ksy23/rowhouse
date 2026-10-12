/**
 * The .xlsx reader's limits: a small file that names a cell a billion rows
 * down, unpacks to hundreds of megabytes, or is written to make a regular
 * expression search the rest of the file for every tag, is refused or read
 * quickly, never left to freeze the browser tab. Files are built here, part
 * by part, and zipped with Node's own zlib.
 */
import {
    inflateRaw,
    readZip,
    readXlsx,
    utf8,
    MAX_ROWS,
    MAX_COLUMNS,
    MAX_PART_BYTES,
    MAX_UNPACKED_BYTES,
    MAX_CELLS
} from 'c/gridXlsx';

/* global require, Buffer -- Jest runs in Node, where the test builds its own files. */
const zlib = require('zlib');

const DAMAGED = 'This file could not be read: it is damaged, or it is not an Excel .xlsx workbook.';
const TOO_LARGE = 'This workbook is too large to read. Split it, or import fewer columns.';

/**
 * A ZIP archive of text files; `store` keeps them uncompressed, `declared`
 * names a size to write in the central directory instead of the real one,
 * and `deflated` gives a file's DEFLATE data ready made.
 */
function zip(files, { store = false, declared = {}, deflated = {} } = {}) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    Object.keys(files).forEach(name => {
        const data = Buffer.from(files[name], 'utf8');
        const body = deflated[name] || (store ? data : zlib.deflateRawSync(data));
        const size = declared[name] === undefined ? data.length : declared[name];
        const nameBytes = Buffer.from(name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(store ? 0 : 8, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(store ? 0 : 8, 10);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, body);
        centrals.push(central, nameBytes);
        offset += local.length + nameBytes.length + body.length;
    });
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const SHEET = 'xl/worksheets/sheet1.xml';
const WORKBOOK = '<workbook><sheets><sheet name="Consignments" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';

/** A one-sheet workbook whose sheetData is `data`; `parts` adds or replaces parts. */
function book(data, parts = {}, options) {
    return zip(
        {
            'xl/workbook.xml': WORKBOOK,
            'xl/_rels/workbook.xml.rels': RELS,
            [SHEET]: `<worksheet><sheetData>${data}</sheetData></worksheet>`,
            ...parts
        },
        options
    );
}

/** How long `read` takes, in milliseconds. */
function timed(read) {
    const started = Date.now();
    read();
    return Date.now() - started;
}

describe("Excel's own sheet: rows 1 to 1,048,576 and columns A to XFD", () => {
    it('are the limits', () => {
        expect(MAX_ROWS).toBe(1048576);
        expect(MAX_COLUMNS).toBe(16384);
    });

    it('refuses a row a billion rows down as a damaged file, at once', () => {
        // 702 bytes once zipped: it used to make an array a billion rows long.
        const bytes = book('<row r="1000000000"><c r="A1000000000"><v>1</v></c></row>');
        expect(bytes.length).toBeLessThan(1024);
        let error;
        expect(
            timed(() => {
                try {
                    readXlsx(bytes);
                } catch (e) {
                    error = e;
                }
            })
        ).toBeLessThan(1000);
        expect(error.message).toBe(DAMAGED);
    });

    it.each(['1048577', '0', '-3', '1.5', 'one', '1e400'])('refuses row %s', r => {
        expect(() => readXlsx(book(`<row r="${r}"><c><v>1</v></c></row>`))).toThrow(DAMAGED);
    });

    it("reads Excel's last row", () => {
        const { rows } = readXlsx(book(`<row r="${MAX_ROWS}"><c r="A${MAX_ROWS}"><v>7</v></c></row>`));
        expect(rows).toHaveLength(MAX_ROWS);
        expect(rows[MAX_ROWS - 1]).toEqual([{ t: 'n', v: '7' }]);
        expect(rows[0]).toEqual([]);
    });

    it("reads Excel's last column, XFD", () => {
        const { rows } = readXlsx(book('<row r="1"><c r="XFD1"><v>7</v></c></row>'));
        expect(rows[0]).toHaveLength(MAX_COLUMNS);
        expect(rows[0][MAX_COLUMNS - 1]).toEqual({ t: 'n', v: '7' });
        expect(rows[0][0]).toBeNull();
    });

    it.each([
        ['past XFD', '<c r="XFE1"><v>1</v></c>'],
        ['far past XFD', `<c r="${'Z'.repeat(40)}1"><v>1</v></c>`],
        ['with no column letters', '<c r="1"><v>1</v></c>'],
        ['one after XFD, unnamed', '<c r="XFD1"><v>1</v></c><c><v>2</v></c>']
    ])('refuses a cell %s', (label, cells) => {
        expect(() => readXlsx(book(`<row r="1">${cells}</row>`))).toThrow(DAMAGED);
    });
});

describe('cells across the sheet', () => {
    it(`refuses a sheet whose rows hold more than ${MAX_CELLS} cells, empty ones included`, () => {
        // Each row is as wide as XFD; together they pass the limit.
        const rows = Math.ceil(MAX_CELLS / MAX_COLUMNS) + 1;
        const bytes = book('<row><c r="XFD1"><v>1</v></c></row>'.repeat(rows));
        expect(bytes.length).toBeLessThan(10 * 1024);
        expect(() => readXlsx(bytes)).toThrow(TOO_LARGE);
    });
});

describe('unpacked size', () => {
    it('allows 100 MB for one part and 150 MB for all the parts one sheet reads', () => {
        expect(MAX_PART_BYTES).toBe(100 * 1024 * 1024);
        expect(MAX_UNPACKED_BYTES).toBe(150 * 1024 * 1024);
    });

    it('refuses a part that says it unpacks to more than the limit, before unpacking anything', () => {
        const bytes = book('<row><c><v>1</v></c></row>', {}, { declared: { [SHEET]: MAX_PART_BYTES + 1 } });
        expect(() => readXlsx(bytes)).toThrow(TOO_LARGE);
    });

    it('stops unpacking a 200 KB file at the limit when it says it is small but unpacks to 200 MB', () => {
        // 1 MB of spaces, deflated without a final block, 200 times over, then
        // a final empty block: one DEFLATE stream of 200 MB, made without
        // holding 200 MB here.
        const mega = zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 0x20), {
            finishFlush: zlib.constants.Z_SYNC_FLUSH
        });
        const bomb = Buffer.concat([...new Array(200).fill(mega), zlib.deflateRawSync(Buffer.alloc(0))]);
        const bytes = book('', {}, { deflated: { [SHEET]: bomb }, declared: { [SHEET]: 1000 } });
        expect(bytes.length).toBeLessThan(250 * 1024);
        expect(() => readXlsx(bytes)).toThrow(TOO_LARGE);
        // Made the same way, two of them unpack to 2 MB: so two hundred are 200 MB.
        const two = Buffer.concat([mega, mega, zlib.deflateRawSync(Buffer.alloc(0))]);
        expect(inflateRaw(new Uint8Array(two), 0, 4 * 1024 * 1024)).toHaveLength(2 * 1024 * 1024);
    });

    it('stops inflating at its limit, and inflates exactly up to it', () => {
        const data = zlib.deflateRawSync(Buffer.alloc(10000, 0x61));
        expect(() => inflateRaw(new Uint8Array(data), 0, 9999)).toThrow(TOO_LARGE);
        expect(() => inflateRaw(new Uint8Array(data), 10000, 9999)).toThrow(TOO_LARGE); // declared, before allocating
        expect(inflateRaw(new Uint8Array(data), 0, 10000)).toHaveLength(10000);
        expect(inflateRaw(new Uint8Array(data), 5, 10000)).toHaveLength(10000); // a size given too small still grows
    });

    it('counts every part read from one archive, stored or compressed, against the total', () => {
        const text = 'x'.repeat(400);
        const deflated = readZip(zip({ a: text, b: text, c: text }), { part: 1000, total: 1000 });
        expect(utf8(deflated.a())).toBe(text);
        expect(utf8(deflated.b())).toBe(text);
        expect(() => deflated.c()).toThrow(TOO_LARGE);
        const stored = readZip(zip({ a: text, b: text, c: text }, { store: true }), { part: 1000, total: 1000 });
        stored.a();
        stored.b();
        expect(() => stored.c()).toThrow(TOO_LARGE);
        expect(() => readZip(zip({ a: text }, { store: true }), { part: 399 }).a()).toThrow(TOO_LARGE);
    });

    it("reads a part whose size is ZIP64's stand-in, within the limit", () => {
        const bytes = book('<row><c><v>1</v></c></row>', {}, { declared: { [SHEET]: 0xffffffff } });
        expect(readXlsx(bytes).rows).toEqual([[{ t: 'n', v: '1' }]]);
    });
});

describe('tags found in one pass', () => {
    // Each of these took the old regular expressions many seconds: the time
    // grew with the square of the count. Read in one pass, they take
    // milliseconds; the bound leaves room for a slow test runner.
    it('reads 120,000 rows that never close', () => {
        const bytes = book('<row>'.repeat(120000));
        let rows;
        expect(timed(() => ({ rows } = readXlsx(bytes)))).toBeLessThan(2000);
        expect(rows).toEqual([]);
    });

    it('reads 120,000 opening tags with no ">"', () => {
        const bytes = book('<row '.repeat(120000));
        expect(timed(() => readXlsx(bytes))).toBeLessThan(2000);
    });

    it('reads 120,000 cells that never close inside one row', () => {
        const bytes = book(`<row>${'<c><v>1</v>'.repeat(120000)}</row>`);
        let rows;
        expect(timed(() => ({ rows } = readXlsx(bytes)))).toBeLessThan(2000);
        expect(rows).toEqual([[]]); // no cell closes, so none is read, as before
    });

    it('reads an attribute name 1,000,000 letters long', () => {
        const bytes = book(`<row r="1" ${'a'.repeat(1000000)}><c r="A1"><v>1</v></c></row>`);
        let rows;
        expect(timed(() => ({ rows } = readXlsx(bytes)))).toBeLessThan(2000);
        expect(rows).toEqual([[{ t: 'n', v: '1' }]]);
    });

    it('reads a shared string with 120,000 phonetic guides that never close', () => {
        const bytes = book('<row><c t="s"><v>0</v></c></row>', {
            'xl/sharedStrings.xml': `<sst><si><t>Tokyo</t>${'<rPh>'.repeat(120000)}</si></sst>`
        });
        let rows;
        expect(timed(() => ({ rows } = readXlsx(bytes)))).toBeLessThan(2000);
        expect(rows).toEqual([[{ t: 's', v: 'Tokyo' }]]);
    });
});
