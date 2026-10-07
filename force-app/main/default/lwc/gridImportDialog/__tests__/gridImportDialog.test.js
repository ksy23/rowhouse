/**
 * The import dialog: a real file through FileReader, the preview, the
 * batched import and what it reports. What each row means is tested in
 * c/gridImport, and Excel reading in c/gridXlsx.
 */
import { createElement } from 'lwc';
import GridImportDialog, { IMPORT_BATCH } from 'c/gridImportDialog';
import importRows from '@salesforce/apex/GridController.importRows';
import { downloadCsv } from 'c/gridCsv';
import { parseCsv } from 'c/gridImport';

jest.mock('@salesforce/apex/GridController.importRows', () => ({ default: jest.fn() }), { virtual: true });
// Downloads are checked at their boundary; the CSV itself is built for real.
jest.mock('c/gridCsv', () => ({ ...jest.requireActual('c/gridCsv'), downloadCsv: jest.fn() }));

/* global require, Buffer -- Jest runs in Node, where the test builds its own .xlsx file. */
const zlib = require('zlib');

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, required: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', editable: true, scale: 2 },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true, options: [{ value: 'b', label: 'Beta' }] },
    { field: 'Doubled__c', label: 'Doubled', type: 'number', editable: false }
];
const ID1 = 'a00000000000001AAA';
const LOADED = [{ Id: ID1, Name: 'One' }];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check) {
    for (let i = 0; i < 50 && !check(); i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
    }
}

/** A one-file ZIP around a minimal workbook, for the .xlsx path. */
function xlsx(sheetXml) {
    const parts = {
        'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
            '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': sheetXml
    };
    const chunks = [];
    const central = [];
    let offset = 0;
    Object.keys(parts).forEach(name => {
        const data = Buffer.from(parts[name]);
        const body = zlib.deflateRawSync(data);
        const n = Buffer.from(name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(n.length, 26);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(8, 10);
        c.writeUInt32LE(body.length, 20);
        c.writeUInt32LE(data.length, 24);
        c.writeUInt16LE(n.length, 28);
        c.writeUInt32LE(offset, 42);
        chunks.push(local, n, body);
        central.push(c, n);
        offset += 30 + n.length + body.length;
    });
    const dir = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(3, 8);
    end.writeUInt16LE(3, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, dir, end]);
}

describe('gridImportDialog', () => {
    let el;
    let closes;
    const $ = selector => el.shadowRoot.querySelector(selector);
    const text = selector => ($(selector) ? $(selector).textContent : null);
    const mount = async props => {
        el = createElement('c-grid-import-dialog', { is: GridImportDialog });
        Object.assign(el, {
            columns: COLUMNS,
            rows: LOADED,
            refNames: {},
            canCreate: true,
            configName: 'Test_Records',
            ...props
        });
        closes = [];
        el.addEventListener('close', e => closes.push(e.detail));
        document.body.appendChild(el);
        await tick();
    };
    const choose = async file => {
        const before = text('.rh-import-error');
        $('.rh-import-file').dispatchEvent(new CustomEvent('change', { detail: { files: [file] } }));
        await tick();
        await until(() => $('.rh-import-summary') || (text('.rh-import-error') && text('.rh-import-error') !== before));
    };
    const csv = (content, name = 'records.csv') => new File([content], name, { type: 'text/csv' });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        jest.clearAllMocks();
    });

    it('starts on the file choice, as a labelled modal dialog', async () => {
        await mount();
        expect($('section[role="dialog"]').getAttribute('aria-modal')).toBe('true');
        expect(text('h1')).toBe('Import from a file');
        expect($('.rh-import-file').accept).toBe('.csv,.txt,.tsv,.xlsx');
        // Focus starts on the file choice; after it, on the heading.
        expect($('.rh-import-file').hasAttribute('data-first')).toBe(true);
        expect($('h1').hasAttribute('data-first')).toBe(false);
    });

    it('previews a CSV file: counts, columns, the first rows and every row held back', async () => {
        await mount();
        await choose(csv(`Id,Name,Amount,Doubled,Color\n${ID1},One renamed,"1,234.5",2,red\n,New,5,,\n,,oops,,\n`));
        expect(text('.rh-import-summary')).toBe(
            'records.csv: 1 row updates a record; 1 row creates a record; 1 row has problems and will not be imported.'
        );
        // Each file column and what it is imported as, which can be changed.
        const maps = [...el.shadowRoot.querySelectorAll('.rh-import-map')];
        expect(maps.map(m => m.value)).toEqual(['__id', 'Name', 'Amount__c', '__skip', '__skip']);
        expect([...el.shadowRoot.querySelectorAll('.rh-import-map-note')].map(p => p.textContent)).toEqual([
            'Doubled is read-only here.',
            'Not a column of this grid.'
        ]);
        // One query for every cell (HR-21); four cells a row: line, action, Name, Amount.
        // An update shows what changes, old → new.
        const cells = [...el.shadowRoot.querySelectorAll('.rh-import-preview tbody td')].map(td => td.textContent);
        expect(cells).toEqual([
            '2',
            'Update',
            'One → One renamed',
            '(blank) → $1,234.50',
            '3',
            'Create',
            'New',
            '$5.00'
        ]);
        // Problems are a table: line, column, what the file says, what is wrong.
        const tds = [...el.shadowRoot.querySelectorAll('.rh-import-problems tbody td')].map(td => td.textContent);
        const problems = [tds.slice(0, 4), tds.slice(4, 8)];
        expect(tds).toHaveLength(8);
        expect(problems).toEqual([
            ['4', 'Name', '', 'Complete this field.'],
            ['4', 'Amount', 'oops', 'Not a number: oops']
        ]);
        expect(text('.rh-import-go')).toBe('Import 2 rows');
        expect($('h1').hasAttribute('data-first')).toBe(true); // focus moves to the heading, so the summary is read next
        expect(importRows).not.toHaveBeenCalled();
    });

    describe('details', () => {
        const figures = () => [...el.shadowRoot.querySelectorAll('.rh-import-count')].map(d => d.textContent);

        it('shows its steps, the rules of a file, and a drop zone', async () => {
            await mount();
            expect($('.rh-import-steps').currentStep).toBe('choose');
            expect(
                [...el.shadowRoot.querySelectorAll('.rh-import-steps lightning-progress-step')].map(s => s.label)
            ).toEqual(['Choose a file', 'Check the rows', 'Import', 'Done']);
            // The indicator names a step only on hover; the step is also said in words.
            expect(text('.rh-import-step')).toBe(
                'Step 1 of 4: choose a file. Nothing is written until you have checked the rows.'
            );
            expect([...el.shadowRoot.querySelectorAll('.rh-import-rules li')]).toHaveLength(3);
            expect(text('.rh-import-rules')).toContain('a row without one creates a record');
            // A native file input in SLDS's file selector, labelled by the field label and the zone.
            const input = $('.rh-import-file');
            expect(input.tagName).toBe('INPUT');
            expect(input.type).toBe('file');
            expect($('label.slds-file-selector__body').textContent).toContain('Choose file');
        });

        it('says every row needs an Id when records cannot be created here', async () => {
            await mount({ canCreate: false });
            expect(text('.rh-import-rules')).toContain('Every row needs a record Id');
        });

        it("offers a template: an Id column, then the grid's editable columns", async () => {
            await mount();
            $('.rh-import-template').click();
            expect(downloadCsv).toHaveBeenCalledTimes(1);
            const [csvText, name] = downloadCsv.mock.calls[0];
            expect(parseCsv(csvText)[0]).toEqual(['Id', 'Name', 'Amount', 'Stage']);
            expect(name).toBe('import-template.csv');
        });

        it('reads a file dropped on the zone', async () => {
            await mount();
            const zone = $('.rh-import-drop');
            zone.dispatchEvent(new CustomEvent('dragover', { cancelable: true }));
            await tick();
            expect(zone.classList).toContain('slds-has-drag-over');
            const drop = new CustomEvent('drop', { cancelable: true });
            drop.dataTransfer = { files: [csv(`Name\nDropped\n`)] };
            zone.dispatchEvent(drop);
            await until(() => $('.rh-import-summary'));
            expect(text('.rh-import-summary')).toBe('records.csv: 1 row creates a record.');
            expect($('.rh-import-steps').currentStep).toBe('preview');
            expect(text('.rh-import-step')).toBe('Step 2 of 4: check the rows. Nothing has been written yet.');
        });

        it('leads the check with three figures, and right-aligns figures', async () => {
            await mount();
            await choose(csv(`Id,Name,Amount\n${ID1},One,5\n,New,7\n,,x\n`));
            expect(figures()).toEqual(['1update', '1new record', '1row with problems']);
            expect($('.rh-import-counts').getAttribute('aria-hidden')).toBe('true'); // the summary sentence says it
            const heads = [...el.shadowRoot.querySelectorAll('.rh-import-preview thead th')];
            expect(heads[3].classList).toContain('slds-text-align_right'); // Amount
            expect(heads[2].classList).not.toContain('slds-text-align_right'); // Name
        });

        it('downloads the rows with problems, as in the file, with what is wrong', async () => {
            await mount();
            await choose(csv(`Id,Name,Amount\n,New,7\n,,x\n`, 'deals.csv'));
            $('.rh-import-download-problems').click();
            const [csvText, name] = downloadCsv.mock.calls[0];
            expect(name).toBe('deals-problems.csv');
            const rows = parseCsv(csvText).filter(r => r.some(c => c !== ''));
            expect(rows).toEqual([
                ['Id', 'Name', 'Amount', 'Problem'],
                ['', '', 'x', 'Name: Complete this field. Amount: Not a number: x']
            ]);
        });

        it('says so when nothing in the file can be imported', async () => {
            await mount();
            await choose(csv(`Name,Amount\n,x\n`));
            expect(text('.rh-import-nothing')).toBe(
                'Nothing in this file can be imported. Fix the rows with problems, then choose the file again.'
            );
            expect($('.rh-import-nothing').getAttribute('role')).toBe('alert');
            expect($('.rh-import-go').disabled).toBe(true);
        });
    });

    it('previews an Excel file the same way', async () => {
        await mount();
        const sheet =
            '<worksheet><sheetData>' +
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>From Excel</t></is></c><c r="B2"><v>12.5</v></c></row>' +
            '</sheetData></worksheet>';
        await choose(new File([xlsx(sheet)], 'book.xlsx'));
        expect(text('.rh-import-summary')).toBe('book.xlsx: 1 row creates a record.');
        expect([...el.shadowRoot.querySelectorAll('.rh-import-preview td')].map(td => td.textContent)).toEqual([
            '2',
            'Create',
            'From Excel',
            '$12.50'
        ]);
    });

    it('reads a CSV saved as Windows-1252 when it is not UTF-8', async () => {
        await mount();
        await choose(new File([Buffer.from([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9])], 'legacy.csv')); // "Name\nCaf" + 0xE9
        expect([...el.shadowRoot.querySelectorAll('.rh-import-preview td')].map(td => td.textContent)).toEqual([
            '2',
            'Create',
            'Café'
        ]);
    });

    it('says what is wrong with a file it cannot use, and stays on the file choice', async () => {
        await mount();
        await choose(new File(['x'], 'old.xls'));
        expect(text('.rh-import-error')).toMatch(/old Excel \.xls file/);
        await choose({ name: 'huge.csv', size: 30 * 1024 * 1024 });
        expect(text('.rh-import-error')).toMatch(/larger than 20 MB/);
        await choose(csv(''));
        expect(text('.rh-import-error')).toBe('The file is empty.');
        expect($('.rh-import-file')).not.toBeNull();
    });

    it('opens the check when no header names a column, so the columns can be mapped by hand', async () => {
        await mount();
        await choose(csv('Colour\nred\n'));
        expect($('.rh-import-file')).toBeNull();
        expect(text('.rh-import-error')).toBe(
            'None of the file’s column names is a column of this grid. Choose below what each column is imported as.'
        );
        expect($('.rh-import-summary')).toBeNull();
        expect($('.rh-import-go').disabled).toBe(true);
        const map = $('.rh-import-map');
        map.value = 'Name';
        map.dispatchEvent(new CustomEvent('change'));
        await tick();
        expect(text('.rh-import-error')).toBeNull();
        expect(text('.rh-import-summary')).toBe('records.csv: 1 row creates a record.');
        expect($('.rh-import-go').disabled).toBe(false);
    });

    it('imports in batches, then reports what was written and each row the server refused', async () => {
        await mount();
        const lines = ['Name,Amount'];
        for (let i = 1; i <= 250; i++) lines.push(`Row ${i},${i}`);
        importRows.mockImplementation(({ rows }) =>
            Promise.resolve({
                rows: rows.map((r, index) =>
                    r.Name === 'Row 7'
                        ? { index, success: false, message: 'A validation rule said no.' }
                        : { index, success: true, created: true, recordId: 'a0000000000000' + index }
                ),
                rejectedFields: [],
                strippedFields: rows.length === 50 ? ['Amount__c'] : []
            })
        );
        await choose(csv(lines.join('\n')));
        $('.rh-import-go').click();
        await until(() => $('.rh-import-result'));
        expect(importRows).toHaveBeenCalledTimes(2);
        expect(importRows.mock.calls.map(([args]) => args.rows.length)).toEqual([IMPORT_BATCH, 50]);
        expect(importRows.mock.calls[0][0].configName).toBe('Test_Records');
        expect(importRows.mock.calls[0][0].rows[0]).toEqual({ Name: 'Row 1', Amount__c: 1 });
        expect(text('.rh-import-result')).toBe('The import created 249 records.');
        expect(text('.rh-import-fields')).toBe(
            'Some columns were skipped, not written because of your access: Amount.'
        );
        expect(text('.rh-import-failures li')).toBe('Line 8: A validation rule said no.');
        $('.rh-import-close').click();
        expect(closes).toEqual([{ changed: true }]);
    });

    describe('where the records go', () => {
        const RECORD = '001000000000001AAA';
        const created = ({ rows }) =>
            Promise.resolve({
                rows: rows.map((r, index) => ({
                    index,
                    success: true,
                    created: true,
                    recordId: 'a0000000000000' + index
                })),
                rejectedFields: [],
                strippedFields: []
            });
        const importOne = async () => {
            await choose(csv('Name\nA\n'));
            $('.rh-import-go').click();
            await until(() => $('.rh-import-result'));
        };

        it("on a record page, sends the page's record with every batch, for the records it creates", async () => {
            importRows.mockImplementation(created);
            await mount({ recordId: RECORD });
            await importOne();
            expect(importRows).toHaveBeenCalledTimes(1);
            expect(importRows).toHaveBeenCalledWith({
                configName: 'Test_Records',
                rows: [{ Name: 'A' }],
                recordId: RECORD
            });
            expect(text('.rh-import-result')).toBe('The import created 1 record.');
        });

        it('elsewhere, sends no record and no parent', async () => {
            importRows.mockImplementation(created);
            await mount();
            await importOne();
            expect(importRows).toHaveBeenCalledWith({
                configName: 'Test_Records',
                rows: [{ Name: 'A' }],
                recordId: null
            });
        });

        it('in a child table, sends its parent row and no page record', async () => {
            importRows.mockImplementation(created);
            await mount({
                parent: { link: 'Test_Records_Children', id: 'a00000000000000001', name: 'Row 1', level: 2 },
                recordId: null
            });
            await importOne();
            expect(importRows).toHaveBeenCalledWith({
                configName: 'Test_Records',
                rows: [{ Name: 'A' }],
                parentLink: 'Test_Records_Children',
                parentId: 'a00000000000000001',
                recordId: null
            });
        });
    });

    it('stops at a batch the server refuses, and says nothing was written', async () => {
        await mount();
        importRows.mockRejectedValue({ body: { message: 'This grid does not allow importing records.' } });
        await choose(csv('Name\nA\n'));
        $('.rh-import-go').click();
        await until(() => $('.rh-import-result'));
        expect(text('.rh-import-result')).toBe(
            'Nothing was imported. It stopped early: This grid does not allow importing records.'
        );
        $('.rh-import-close').click();
        expect(closes).toEqual([{ changed: false }]);
    });

    it('goes back to the file choice, and closes on Escape or Cancel', async () => {
        await mount();
        await choose(csv('Name\nA\n'));
        $('.rh-import-back').click();
        await tick();
        expect($('.rh-import-file')).not.toBeNull();
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        $('.rh-import-cancel').click();
        expect(closes).toEqual([{ changed: false }, { changed: false }]);
    });
});
