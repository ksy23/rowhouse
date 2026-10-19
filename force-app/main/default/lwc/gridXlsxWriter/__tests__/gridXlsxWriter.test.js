/**
 * The workbook writer, read back with Rowhouse's own reader (c/gridXlsx),
 * so what Export to Excel writes is what Import reads.
 */
import {
    toXlsx,
    deflateRaw,
    zip,
    crc32,
    utf8Encode,
    xmlEscape,
    columnName,
    sheetName,
    MAX_TEXT
} from 'c/gridXlsxWriter';
import { readXlsx, readZip, inflateRaw, utf8 } from 'c/gridXlsx';

const text = bytes => utf8(bytes);
const parts = bytes => {
    const files = readZip(bytes);
    const out = {};
    Object.keys(files).forEach(name => {
        out[name] = text(files[name]());
    });
    return out;
};

const HEADER = { bold: true, fill: 'F3F3F3' };
const MONEY = { numFmt: '"$"#,##0.00' };

function sheet(extra = {}) {
    return {
        name: 'Open Consignments',
        title: 'Open Consignments',
        columns: [{ width: 20 }, { width: 30 }, { width: 14 }],
        freeze: { rows: 1, columns: 0 },
        autoFilter: true,
        rows: [
            {
                level: 0,
                cells: [
                    { v: 'Id', t: 's', style: HEADER },
                    { v: 'Name', t: 's', style: HEADER },
                    { v: 'Freight Charge', t: 's', style: HEADER }
                ]
            },
            {
                level: 0,
                cells: [
                    { v: 'a00000000000001AAA', t: 's' },
                    { v: 'Kennebec Lumber, load 1', t: 's' },
                    { v: 1250.5, t: 'n', style: MONEY }
                ]
            },
            {
                level: 0,
                cells: [
                    { v: 'a00000000000002AAA', t: 's' },
                    { v: 'Penobscot Paper, load 2', t: 's' },
                    { v: 980, t: 'n', style: MONEY }
                ]
            }
        ],
        ...extra
    };
}

describe('DEFLATE and ZIP', () => {
    it('compresses so that an inflater gets the same bytes back', () => {
        const xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>Kennebec Lumber</t></is></c></row>'.repeat(4000);
        const varied = Array.from({ length: 30000 }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 90))).join('');
        [xml, varied, '', 'a', 'abcabcabcabcabc', 'x'.repeat(70000)].forEach(s => {
            const input = utf8Encode(s);
            const packed = deflateRaw(input);
            expect(Array.from(inflateRaw(packed, input.length))).toEqual(Array.from(input));
        });
        // Repetitive XML packs to a small part of itself.
        expect(deflateRaw(utf8Encode(xml)).length).toBeLessThan(xml.length / 20);
    });

    it('checks each part with CRC-32', () => {
        expect(crc32(utf8Encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it('packs files into an archive the reader opens, storing what does not compress', () => {
        const noise = new Uint8Array(500).map((_, i) => (i * 131 + 7) % 256);
        const bytes = zip([
            { name: 'a.xml', data: utf8Encode('<a>' + 'b'.repeat(1000) + '</a>') },
            { name: 'noise.bin', data: noise }
        ]);
        const files = readZip(bytes);
        expect(text(files['a.xml']())).toBe('<a>' + 'b'.repeat(1000) + '</a>');
        expect(Array.from(files['noise.bin']())).toEqual(Array.from(noise));
    });

    it('writes UTF-8, a character outside the basic plane as one, and a lone surrogate as U+FFFD', () => {
        expect(text(utf8Encode('Café Ünïcode 😀'))).toBe('Café Ünïcode 😀');
        expect(text(utf8Encode('a\ud800b'))).toBe('a�b');
    });
});

describe('the workbook', () => {
    it('is read back by Import as the same rows', () => {
        const { sheet: name, rows } = readXlsx(toXlsx(sheet()));
        expect(name).toBe('Open Consignments');
        expect(rows).toEqual([
            [
                { t: 's', v: 'Id' },
                { t: 's', v: 'Name' },
                { t: 's', v: 'Freight Charge' }
            ],
            [
                { t: 's', v: 'a00000000000001AAA' },
                { t: 's', v: 'Kennebec Lumber, load 1' },
                { t: 'n', v: '1250.5' }
            ],
            [
                { t: 's', v: 'a00000000000002AAA' },
                { t: 's', v: 'Penobscot Paper, load 2' },
                { t: 'n', v: '980' }
            ]
        ]);
    });

    it('has the parts Excel needs, and nothing that runs', () => {
        const p = parts(toXlsx(sheet()));
        expect(Object.keys(p).sort()).toEqual([
            '[Content_Types].xml',
            '_rels/.rels',
            'docProps/app.xml',
            'docProps/core.xml',
            'xl/_rels/workbook.xml.rels',
            'xl/styles.xml',
            'xl/workbook.xml',
            'xl/worksheets/sheet1.xml'
        ]);
        expect(p['[Content_Types].xml']).not.toMatch(/vbaProject|macroEnabled/);
        expect(p['docProps/core.xml']).toContain('<dc:title>Open Consignments</dc:title>');
        expect(p['xl/workbook.xml']).toContain('fullCalcOnLoad="1"');
    });

    it('writes text as text, so a value that begins with = is never a formula', () => {
        const s = sheet();
        s.rows[1].cells[1] = { v: '=HYPERLINK("http://example.com","x")', t: 's' };
        const p = parts(toXlsx(s));
        expect(p['xl/worksheets/sheet1.xml']).toContain(
            '<c r="B2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://example.com&quot;,&quot;x&quot;)</t></is></c>'
        );
        expect(p['xl/worksheets/sheet1.xml']).not.toContain('<f>HYPERLINK');
        expect(readXlsx(toXlsx(s)).rows[1][1]).toEqual({ t: 's', v: '=HYPERLINK("http://example.com","x")' });
    });

    it('freezes the header row and the columns it is told, and puts filter buttons on the header', () => {
        const p = parts(toXlsx(sheet({ freeze: { rows: 1, columns: 2 } })));
        const xml = p['xl/worksheets/sheet1.xml'];
        expect(xml).toContain('<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>');
        expect(xml).toContain('<autoFilter ref="A1:C3"/>');
        expect(p['xl/workbook.xml']).toContain("'Open Consignments'!$A$1:$C$3");
        const top = parts(toXlsx(sheet({ freeze: { rows: 1, columns: 0 }, autoFilter: false })))[
            'xl/worksheets/sheet1.xml'
        ];
        expect(top).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
        expect(top).not.toContain('autoFilter');
    });

    it('puts filter buttons on a range of the sheet, as a report below its header has', () => {
        const s = sheet({ autoFilter: 'B2:C3' });
        const p = parts(toXlsx(s));
        expect(p['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="B2:C3"/>');
        expect(p['xl/workbook.xml']).toContain("'Open Consignments'!$B$2:$C$3");
        expect(parts(toXlsx(sheet({ autoFilter: 'B9:C3' })))['xl/worksheets/sheet1.xml']).not.toContain('autoFilter');
        expect(parts(toXlsx(sheet({ autoFilter: 'not a range' })))['xl/worksheets/sheet1.xml']).not.toContain(
            'autoFilter'
        );
    });

    it('writes a font size and a right border', () => {
        const s = sheet();
        s.rows[1].cells[1].style = { size: 18, color: '56585B', fill: 'F9F9F7' };
        s.rows[2].cells[1].style = { fill: 'F9F9F7', borderRight: { style: 'thin', color: '8E9297' } };
        const styles = parts(toXlsx(s))['xl/styles.xml'];
        expect(styles).toContain(
            '<font><sz val="18"/><color rgb="FF56585B"/><name val="Calibri"/><family val="2"/></font>'
        );
        expect(styles).toContain(
            '<border><left/><right style="thin"><color rgb="FF8E9297"/></right><top/><bottom/><diagonal/></border>'
        );
    });

    it('keeps a Total row below out of the filter when told how many rows it covers', () => {
        const s = sheet({ autoFilter: 3 });
        s.rows.push({ level: 0, cells: [{ v: 'Total', t: 's' }, null, { f: 'SUBTOTAL(9,C2:C3)', v: 2230.5 }] });
        const p = parts(toXlsx(s));
        expect(p['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:C3"/>');
        expect(p['xl/worksheets/sheet1.xml']).toContain('<dimension ref="A1:C4"/>');
        expect(p['xl/workbook.xml']).toContain("'Open Consignments'!$A$1:$C$3");
        expect(parts(toXlsx(sheet({ autoFilter: 0 })))['xl/worksheets/sheet1.xml']).not.toContain('autoFilter');
    });

    it('sets column widths, and shares one format among cells that look alike', () => {
        const p = parts(toXlsx(sheet()));
        expect(p['xl/worksheets/sheet1.xml']).toContain('<col min="2" max="2" width="30" customWidth="1"/>');
        const styles = p['xl/styles.xml'];
        expect(styles).toContain('<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>');
        expect(styles).toContain('<cellXfs count="3">'); // the default, the header and the amount
        expect(styles).toContain('<fgColor rgb="FFF3F3F3"/>');
        expect(styles).toMatch(/<font><b\/><sz val="11"\/>/);
    });

    it('writes formulas with their last value, booleans, and outline levels', () => {
        const s = sheet();
        s.rows[1].level = 1;
        s.rows[2].level = 1;
        s.rows.push({
            level: 0,
            cells: [{ v: 'Total', t: 's' }, null, { f: 'SUBTOTAL(9,C2:C3)', v: 2230.5, style: MONEY }]
        });
        s.rows[1].cells.push({ v: true, t: 'b' });
        const xml = parts(toXlsx(s))['xl/worksheets/sheet1.xml'];
        expect(xml).toContain('<sheetPr><outlinePr summaryBelow="1"/></sheetPr>');
        expect(xml).toContain('outlineLevelRow="1"');
        expect(xml).toContain('<row r="2" outlineLevel="1">');
        expect(xml).toContain('<f>SUBTOTAL(9,C2:C3)</f><v>2230.5</v>');
        expect(xml).toContain('<c r="D2" t="b"><v>1</v></c>');
        const back = readXlsx(toXlsx(s)).rows;
        expect(back[3][2]).toEqual({ t: 'n', v: '2230.5' });
        expect(back[1][3]).toEqual({ t: 'b', v: 'true' });
    });

    it('keeps a long decimal exactly as it is given', () => {
        const s = sheet();
        s.rows[1].cells[2] = { v: '123456789.123456789', t: 'n', style: MONEY };
        expect(parts(toXlsx(s))['xl/worksheets/sheet1.xml']).toContain('<v>123456789.123456789</v>');
    });

    it('leaves out characters XML cannot hold, and cuts text at Excel’s 32,767 characters', () => {
        expect(xmlEscape('a\u0001b<c>&"')).toBe('ab&lt;c&gt;&amp;&quot;');
        const s = sheet();
        s.rows[1].cells[1] = { v: 'x'.repeat(MAX_TEXT + 10), t: 's' };
        expect(readXlsx(toXlsx(s)).rows[1][1].v).toHaveLength(MAX_TEXT);
    });

    it('names columns and sheets as Excel does', () => {
        expect([1, 26, 27, 52, 703].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
        expect(sheetName('Pipeline: Review/Q4 [draft]')).toBe('Pipeline Review Q4 draft');
        expect(sheetName("'Quoted'")).toBe('Quoted');
        expect(sheetName('A very long grid title that goes on and on')).toHaveLength(31);
        expect(sheetName('')).toBe('Sheet1');
        expect(sheetName('???')).toBe('Sheet1');
    });
});
