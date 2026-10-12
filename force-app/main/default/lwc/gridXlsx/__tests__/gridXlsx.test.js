/**
 * The .xlsx reader. Workbooks are built here, part by part, and zipped
 * with Node's own zlib, so the inflater is checked against a real DEFLATE
 * encoder: stored, fixed-Huffman and dynamic-Huffman blocks.
 */
import {
    inflateRaw,
    readZip,
    readXlsx,
    utf8,
    xmlText,
    isDateFormat,
    serialToIso,
    plainNumber,
    columnIndex
} from 'c/gridXlsx';

/* global require, Buffer -- Jest runs in Node, where the test builds its own files. */
const zlib = require('zlib');

/** A ZIP archive of text files; `store` keeps them uncompressed. */
function zip(files, { store = false } = {}) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    Object.keys(files).forEach(name => {
        const data = Buffer.from(files[name], 'utf8');
        const body = store ? data : zlib.deflateRawSync(data);
        const nameBytes = Buffer.from(name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(store ? 0 : 8, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(store ? 0 : 8, 10);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(data.length, 24);
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

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/><sheets><sheet name="Consignments" sheetId="1" r:id="rId1"/><sheet name="Rates" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
const STYLES = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="&quot;Qty &quot;0"/></numFmts>
<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="22"/></cellXfs>
</styleSheet>`;
const SHARED = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
<si><t>Name</t></si><si><t>Freight Charge</t></si>
<si><r><rPr><b/></rPr><t>Pratt, </t></r><r><t xml:space="preserve">Fogg &amp; Sons</t></r></si>
<si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si>
<si><t>Leave at side door_x000D_
Call on arrival</t></si>
</sst>`;
const SHEET = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Ship Date</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1234.5</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2" t="b"><v>1</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>1.5E-3</v></c><c r="C3" s="2"><v>45001</v></c><c r="E3" s="3"><v>7</v></c></row>
<row r="5"><c r="A5" t="s"><v>4</v></c><c r="C5" s="4"><v>45000.5</v></c><c r="D5" t="str"><f>A1&amp;"!"</f><v>Name!</v></c><c r="F5" t="e"><v>#N/A</v></c></row>
</sheetData></worksheet>`;

function workbook(overrides = {}, options) {
    return zip(
        {
            '[Content_Types].xml': '<Types/>',
            'xl/workbook.xml': WORKBOOK,
            'xl/_rels/workbook.xml.rels': RELS,
            'xl/styles.xml': STYLES,
            'xl/sharedStrings.xml': SHARED,
            'xl/worksheets/sheet1.xml': SHEET,
            'xl/worksheets/sheet2.xml':
                '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Lane</t></is></c></row></sheetData></worksheet>',
            ...overrides
        },
        options
    );
}

describe('inflateRaw', () => {
    const roundTrip = (data, options) =>
        Buffer.from(inflateRaw(new Uint8Array(zlib.deflateRawSync(data, options)))).equals(data);

    it('reads dynamic-Huffman blocks, as large repetitive text compresses to', () => {
        const text = Buffer.from(Array.from({ length: 5000 }, (_, i) => `<c r="A${i}"><v>${i * 7}</v></c>`).join(''));
        expect(roundTrip(text)).toBe(true);
    });

    it('reads fixed-Huffman blocks, as short text compresses to', () => {
        expect(roundTrip(Buffer.from('Bath'))).toBe(true);
        expect(roundTrip(Buffer.from('------------------------------'))).toBe(true);
    });

    it('reads stored blocks, more than one of them', () => {
        const bytes = Buffer.alloc(150000);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
        expect(roundTrip(bytes, { level: 0 })).toBe(true);
    });

    it('reads bytes that do not compress', () => {
        const bytes = Buffer.alloc(70000);
        let x = 12345;
        for (let i = 0; i < bytes.length; i++) {
            x = (x * 1103515245 + 12345) % 2147483648;
            bytes[i] = x >> 16;
        }
        expect(roundTrip(bytes)).toBe(true);
    });

    it('says the file is damaged rather than looping or returning rubbish', () => {
        const good = zlib.deflateRawSync(Buffer.from('Kennebec Lumber, Kennebec Lumber'));
        expect(() => inflateRaw(new Uint8Array(good.subarray(0, 3)))).toThrow('damaged');
        expect(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff]))).toThrow('damaged');
    });
});

describe('the pieces', () => {
    it('decodes UTF-8, emoji and a byte order mark included', () => {
        expect(utf8(new Uint8Array(Buffer.from(String.fromCharCode(0xfeff) + 'Delivered 🎉 東京 é', 'utf8')))).toBe(
            'Delivered 🎉 東京 é'
        );
    });

    it('decodes XML entities and Excel’s own escapes', () => {
        expect(xmlText('Pratt &amp; Fogg &lt;dock 4&gt; &quot;Fragile&quot; &#80;&#x52;O _x000D_ _x005F_x0041_')).toBe(
            'Pratt & Fogg <dock 4> "Fragile" PRO \r _x0041_'
        );
    });

    it('knows a date format from a number format', () => {
        ['yyyy-mm-dd', 'd/m/yy', '[h]:mm:ss', 'mmm yyyy', 'dd"."mm'].forEach(f => expect(isDateFormat(f)).toBe(true));
        ['0.00', '#,##0', '"Qty "0', '[Red]0.00', 'General', '0.00E+00', '@'].forEach(f =>
            expect(isDateFormat(f)).toBe(false)
        );
    });

    it('turns serial dates into ISO dates, across Excel’s 1900 leap-year bug and in the 1904 system', () => {
        expect(serialToIso(1)).toBe('1900-01-01');
        expect(serialToIso(59)).toBe('1900-02-28');
        expect(serialToIso(61)).toBe('1900-03-01');
        expect(serialToIso(45000)).toBe('2023-03-15');
        expect(serialToIso(45000.5)).toBe('2023-03-15T12:00:00');
        expect(serialToIso(0, true)).toBe('1904-01-01');
    });

    it('writes numbers without an exponent, and column letters as indexes', () => {
        expect(plainNumber('1.5E-3')).toBe('0.0015');
        expect(plainNumber('1234.5')).toBe('1234.5');
        expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA1'), columnIndex('AB12')]).toEqual([
            0, 25, 26, 27
        ]);
    });

    it('finds the files in a ZIP, compressed or stored', () => {
        const files = readZip(
            zip({ 'notes.txt': 'Leave at side door', 'docProps/app.xml': '<Properties/>' }, { store: true })
        );
        expect(Object.keys(files).sort()).toEqual(['docProps/app.xml', 'notes.txt']);
        expect(utf8(files['notes.txt']())).toBe('Leave at side door');
        expect(utf8(readZip(zip({ 'manifest.txt': 'Bangor to Portland' }))['manifest.txt']())).toBe(
            'Bangor to Portland'
        );
    });
});

describe('readXlsx', () => {
    it('reads the first sheet by the workbook’s order, not the file name', () => {
        const { sheet, rows } = readXlsx(workbook());
        expect(sheet).toBe('Consignments');
        expect(rows[0]).toEqual([
            { t: 's', v: 'Name' },
            { t: 's', v: 'Freight Charge' },
            { t: 's', v: 'Ship Date' }
        ]);
    });

    it('reads strings, numbers, booleans and dates as typed cells', () => {
        const { rows } = readXlsx(workbook());
        expect(rows[1]).toEqual([
            { t: 's', v: 'Pratt, Fogg & Sons' }, // rich text runs joined
            { t: 'n', v: '1234.5' },
            { t: 'd', v: '2023-03-15' }, // built-in date format 14
            { t: 'b', v: 'true' }
        ]);
        expect(rows[2]).toEqual([
            { t: 's', v: '東京' }, // the phonetic guide is not part of the text
            { t: 'n', v: '0.0015' },
            { t: 'd', v: '2023-03-16' }, // a custom date format
            null,
            { t: 'n', v: '7' } // "Qty "0 is a number format, not a date
        ]);
    });

    it('keeps empty rows and cells in place, and reads formula results and errors as text', () => {
        const { rows } = readXlsx(workbook());
        expect(rows[3]).toEqual([]);
        expect(rows[4]).toEqual([
            { t: 's', v: 'Leave at side door\r\nCall on arrival' },
            null,
            { t: 'd', v: '2023-03-15T12:00:00' },
            { t: 's', v: 'Name!' },
            null,
            { t: 's', v: '#N/A' }
        ]);
    });

    it('reads a workbook written with namespace prefixes, an absolute part name and the 1904 date system', () => {
        const prefixed = SHEET.replace(/<(\/?)(worksheet|sheetData|row|c|v|is|t|f)\b/g, '<$1x:$2');
        const bytes = workbook({
            'xl/workbook.xml': WORKBOOK.replace('<workbookPr/>', '<workbookPr date1904="1"/>'),
            'xl/_rels/workbook.xml.rels': RELS.replace(
                'Target="worksheets/sheet1.xml"',
                'Target="/xl/worksheets/prefixed.xml"'
            ),
            'xl/worksheets/prefixed.xml': prefixed
        });
        const { rows } = readXlsx(bytes);
        expect(rows[1][0]).toEqual({ t: 's', v: 'Pratt, Fogg & Sons' });
        expect(rows[1][2]).toEqual({ t: 'd', v: serialToIso(45000, true) });
        expect(serialToIso(45000, true)).toBe('2027-03-16');
    });

    it('reads a workbook with no shared strings or styles', () => {
        const bytes = zip({
            'xl/workbook.xml': WORKBOOK,
            'xl/_rels/workbook.xml.rels': RELS,
            'xl/worksheets/sheet1.xml':
                '<worksheet><sheetData><row><c t="inlineStr"><is><t>Bath</t></is></c><c><v>2</v></c></row></sheetData></worksheet>'
        });
        expect(readXlsx(bytes).rows).toEqual([
            [
                { t: 's', v: 'Bath' },
                { t: 'n', v: '2' }
            ]
        ]);
    });

    it('says what to do with a file that is not an .xlsx workbook', () => {
        expect(() => readXlsx(new Uint8Array(Buffer.from('Name,Pieces\nKennebec Lumber,12')))).toThrow(
            'Save it from Excel as "Excel Workbook (.xlsx)" or as CSV'
        );
        expect(() => readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toThrow(
            'not an .xlsx file'
        ); // old .xls
        const noWorkbook = zip({ 'word/document.xml': '<w:document/>' });
        expect(() => readXlsx(noWorkbook)).toThrow('not an Excel .xlsx workbook');
    });
});

describe('readXlsx with more than one sheet', () => {
    it('names every sheet, reads the first by default and another when asked', () => {
        const first = readXlsx(workbook());
        expect(first.sheets).toEqual(['Consignments', 'Rates']);
        expect(first.sheet).toBe('Consignments');
        const other = readXlsx(workbook(), 'Rates');
        expect(other.sheet).toBe('Rates');
        expect(other.rows).toEqual([[{ t: 's', v: 'Lane' }]]);
    });

    it('reads the first sheet when the one asked for is not there', () => {
        expect(readXlsx(workbook(), 'Claims').sheet).toBe('Consignments');
    });
});
