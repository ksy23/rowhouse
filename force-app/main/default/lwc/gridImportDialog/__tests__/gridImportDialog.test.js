/**
 * The import dialog: a real file through FileReader, the preview, the
 * batched import and what it reports. What each row means is tested in
 * c/gridImport, and Excel reading in c/gridXlsx.
 */
import { createElement } from 'lwc';
import GridImportDialog, { IMPORT_BATCH } from 'c/gridImportDialog';
import importRows from '@salesforce/apex/GridController.importRows';
import findLookupNames from '@salesforce/apex/GridController.findLookupNames';
import { downloadCsv } from 'c/gridCsv';
import { parseCsv } from 'c/gridImport';

jest.mock('@salesforce/apex/GridController.importRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.findLookupNames', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
// Downloads are checked at their boundary; the CSV itself is built for real.
jest.mock('c/gridCsv', () => ({ ...jest.requireActual('c/gridCsv'), downloadCsv: jest.fn(() => true) }));

/* global require, Buffer -- Jest runs in Node, where the test builds its own .xlsx file. */
const zlib = require('zlib');

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, required: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, scale: 2 },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        options: [{ value: 'Standard', label: 'Standard' }]
    },
    { field: 'Pallet_Positions__c', label: 'Pallet Positions', type: 'number', editable: false }
];
const ID1 = 'a00000000000001AAA';
const LOADED = [{ Id: ID1, Name: 'Kennebec Lumber, 12 bundles' }];
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
        'xl/workbook.xml': '<workbook><sheets><sheet name="Consignments" sheetId="1" r:id="rId1"/></sheets></workbook>',
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
            configName: 'Consignments',
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
    const csv = (content, name = 'Consignments.csv') => new File([content], name, { type: 'text/csv' });
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
        await choose(
            csv(
                `Id,Name,Freight Charge,Pallet Positions,Dock Door\n${ID1},"Kennebec Lumber, 14 bundles","1,234.5",2,4\n,"Casco Bay Marine, 2 pallets",5,,\n,,TBD,,\n`
            )
        );
        expect(text('.rh-import-summary')).toBe(
            'Consignments.csv: 1 row updates a record; 1 row creates a record; 1 row has problems and will not be imported.'
        );
        // Each file column and what it is imported as, which can be changed.
        const maps = [...el.shadowRoot.querySelectorAll('.rh-import-map')];
        expect(maps.map(m => m.value)).toEqual(['__id', 'Name', 'Freight_Charge__c', '__skip', '__skip']);
        expect([...el.shadowRoot.querySelectorAll('.rh-import-map-note')].map(p => p.textContent)).toEqual([
            'Pallet Positions is read-only here.',
            'Not a column of this grid.'
        ]);
        // One query for every cell (HR-21); four cells a row: line, action, Name, Freight Charge.
        // An update shows what changes, old → new.
        const cells = [...el.shadowRoot.querySelectorAll('.rh-import-preview tbody td')].map(td => td.textContent);
        expect(cells).toEqual([
            '2',
            'Update',
            'Kennebec Lumber, 12 bundles → Kennebec Lumber, 14 bundles',
            '(blank) → $1,234.50',
            '3',
            'Create',
            'Casco Bay Marine, 2 pallets',
            '$5.00'
        ]);
        // Problems are a table: line, column, what the file says, what is wrong.
        const tds = [...el.shadowRoot.querySelectorAll('.rh-import-problems tbody td')].map(td => td.textContent);
        const problems = [tds.slice(0, 4), tds.slice(4, 8)];
        expect(tds).toHaveLength(8);
        expect(problems).toEqual([
            ['4', 'Name', '', 'Complete this field.'],
            ['4', 'Freight Charge', 'TBD', 'Not a number: TBD']
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
            expect(parseCsv(csvText)[0]).toEqual(['Id', 'Name', 'Freight Charge', 'Service Level']);
            expect(name).toBe('import-template.csv');
        });

        it('reads a file dropped on the zone', async () => {
            await mount();
            const zone = $('.rh-import-drop');
            zone.dispatchEvent(new CustomEvent('dragover', { cancelable: true }));
            await tick();
            expect(zone.classList).toContain('slds-has-drag-over');
            const drop = new CustomEvent('drop', { cancelable: true });
            drop.dataTransfer = { files: [csv(`Name\n"Green Mountain Maple, 40 cases"\n`)] };
            zone.dispatchEvent(drop);
            await until(() => $('.rh-import-summary'));
            expect(text('.rh-import-summary')).toBe('Consignments.csv: 1 row creates a record.');
            expect($('.rh-import-steps').currentStep).toBe('preview');
            expect(text('.rh-import-step')).toBe('Step 2 of 4: check the rows. Nothing has been written yet.');
        });

        it('leads the check with three figures, and right-aligns figures', async () => {
            await mount();
            await choose(
                csv(
                    `Id,Name,Freight Charge\n${ID1},"Kennebec Lumber, 12 bundles",5\n,"Casco Bay Marine, 2 pallets",7\n,,TBD\n`
                )
            );
            expect(figures()).toEqual(['1update', '1new record', '1row with problems']);
            expect($('.rh-import-counts').getAttribute('aria-hidden')).toBe('true'); // the summary sentence says it
            const heads = [...el.shadowRoot.querySelectorAll('.rh-import-preview thead th')];
            expect(heads[3].classList).toContain('slds-text-align_right'); // Freight Charge
            expect(heads[2].classList).not.toContain('slds-text-align_right'); // Name
        });

        it('downloads the rows with problems, as in the file, with what is wrong', async () => {
            await mount();
            await choose(
                csv(`Id,Name,Freight Charge\n,"Casco Bay Marine, 2 pallets",7\n,,TBD\n`, 'Portland consignments.csv')
            );
            $('.rh-import-download-problems').click();
            const [csvText, name] = downloadCsv.mock.calls[0];
            expect(name).toBe('Portland consignments-problems.csv');
            const rows = parseCsv(csvText).filter(r => r.some(c => c !== ''));
            expect(rows).toEqual([
                ['Id', 'Name', 'Freight Charge', 'Problem'],
                ['', '', 'TBD', 'Name: Complete this field. Freight Charge: Not a number: TBD']
            ]);
        });

        it('says so when nothing in the file can be imported', async () => {
            await mount();
            await choose(csv(`Name,Freight Charge\n,TBD\n`));
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
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Freight Charge</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>Quabbin Supply, 6 cartons</t></is></c><c r="B2"><v>12.5</v></c></row>' +
            '</sheetData></worksheet>';
        await choose(new File([xlsx(sheet)], 'Consignments.xlsx'));
        expect(text('.rh-import-summary')).toBe('Consignments.xlsx: 1 row creates a record.');
        expect([...el.shadowRoot.querySelectorAll('.rh-import-preview td')].map(td => td.textContent)).toEqual([
            '2',
            'Create',
            'Quabbin Supply, 6 cartons',
            '$12.50'
        ]);
    });

    it('reads a CSV saved as Windows-1252 when it is not UTF-8', async () => {
        await mount();
        // "Name\nCafé Lévesque", each é the single byte 0xE9
        const bytes = [
            0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x20, 0x4c, 0xe9, 0x76, 0x65, 0x73, 0x71, 0x75, 0x65
        ];
        await choose(new File([Buffer.from(bytes)], 'Consignees.csv'));
        expect([...el.shadowRoot.querySelectorAll('.rh-import-preview td')].map(td => td.textContent)).toEqual([
            '2',
            'Create',
            'Café Lévesque'
        ]);
    });

    it('says what is wrong with a file it cannot use, and stays on the file choice', async () => {
        await mount();
        await choose(new File(['Consignee,Pieces'], 'Consignments.xls'));
        expect(text('.rh-import-error')).toMatch(/old Excel \.xls file/);
        await choose({ name: 'Consignments 2019-2026.csv', size: 30 * 1024 * 1024 });
        expect(text('.rh-import-error')).toMatch(/larger than 20 MB/);
        await choose(csv(''));
        expect(text('.rh-import-error')).toBe('The file is empty.');
        expect($('.rh-import-file')).not.toBeNull();
    });

    it('opens the check when no header names a column, so the columns can be mapped by hand', async () => {
        await mount();
        await choose(csv('Customer\nCasco Bay Marine\n'));
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
        expect(text('.rh-import-summary')).toBe('Consignments.csv: 1 row creates a record.');
        expect($('.rh-import-go').disabled).toBe(false);
    });

    it('imports in batches, then reports what was written and each row the server refused', async () => {
        await mount();
        const lines = ['Name,Freight Charge'];
        for (let i = 1; i <= 250; i++) lines.push(`"Wachusett Paper, pallet ${i}",${i}`);
        importRows.mockImplementation(({ rows }) =>
            Promise.resolve({
                rows: rows.map((r, index) =>
                    r.Name === 'Wachusett Paper, pallet 7'
                        ? { index, success: false, message: 'Ship Date cannot be in the past.' }
                        : { index, success: true, created: true, recordId: 'a0000000000000' + index }
                ),
                rejectedFields: [],
                strippedFields: rows.length === 50 ? ['Freight_Charge__c'] : []
            })
        );
        await choose(csv(lines.join('\n')));
        $('.rh-import-go').click();
        await until(() => $('.rh-import-result'));
        expect(importRows).toHaveBeenCalledTimes(2);
        expect(importRows.mock.calls.map(([args]) => args.rows.length)).toEqual([IMPORT_BATCH, 50]);
        expect(importRows.mock.calls[0][0].configName).toBe('Consignments');
        expect(importRows.mock.calls[0][0].rows[0]).toEqual({
            Name: 'Wachusett Paper, pallet 1',
            Freight_Charge__c: 1
        });
        expect(text('.rh-import-result')).toBe('The import created 249 records.');
        expect(text('.rh-import-fields')).toBe(
            'Some columns were skipped, not written because of your access: Freight Charge.'
        );
        expect(text('.rh-import-failures li')).toBe('Line 8: Ship Date cannot be in the past.');
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
            await choose(csv('Name\n"Penobscot Paper, full truck"\n'));
            $('.rh-import-go').click();
            await until(() => $('.rh-import-result'));
        };

        it("on a record page, sends the page's record with every batch, for the records it creates", async () => {
            importRows.mockImplementation(created);
            await mount({ recordId: RECORD });
            await importOne();
            expect(importRows).toHaveBeenCalledTimes(1);
            expect(importRows).toHaveBeenCalledWith({
                configName: 'Consignments',
                rows: [{ Name: 'Penobscot Paper, full truck' }],
                recordId: RECORD
            });
            expect(text('.rh-import-result')).toBe('The import created 1 record.');
        });

        it('elsewhere, sends no record and no parent', async () => {
            importRows.mockImplementation(created);
            await mount();
            await importOne();
            expect(importRows).toHaveBeenCalledWith({
                configName: 'Consignments',
                rows: [{ Name: 'Penobscot Paper, full truck' }],
                recordId: null
            });
        });

        it('in a child table, sends its parent row and no page record', async () => {
            importRows.mockImplementation(created);
            await mount({
                parent: {
                    link: 'Consignments_Items',
                    id: 'a00000000000000001',
                    name: 'Kennebec Lumber, 12 bundles',
                    level: 2
                },
                recordId: null
            });
            await importOne();
            expect(importRows).toHaveBeenCalledWith({
                configName: 'Consignments',
                rows: [{ Name: 'Penobscot Paper, full truck' }],
                parentLink: 'Consignments_Items',
                parentId: 'a00000000000000001',
                recordId: null
            });
        });
    });

    it('stops at a batch the server refuses, and says nothing was written', async () => {
        await mount();
        importRows.mockRejectedValue({ body: { message: 'This grid does not allow importing records.' } });
        await choose(csv('Name\n"Penobscot Paper, full truck"\n'));
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
        await choose(csv('Name\n"Penobscot Paper, full truck"\n'));
        $('.rh-import-back').click();
        await tick();
        expect($('.rh-import-file')).not.toBeNull();
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        $('.rh-import-cancel').click();
        expect(closes).toEqual([{ changed: false }, { changed: false }]);
    });

    describe('a lookup column named in the file', () => {
        const ACC = '001000000000009AAA';
        const columns = [...COLUMNS, { field: 'Shipper__c', label: 'Shipper', type: 'reference', editable: true }];

        it('finds the records the file names, then checks the rows again; Import waits for it', async () => {
            let answer;
            findLookupNames.mockReturnValueOnce(
                new Promise(resolve => {
                    answer = resolve;
                })
            );
            const found = [];
            await mount({ columns });
            el.addEventListener('namesfound', e => found.push(e.detail.names));
            await choose(csv('Name,Shipper\n"Casco Bay Marine, 2 pallets",Casco Bay Marine\n'));
            expect(findLookupNames).toHaveBeenCalledWith({
                configName: 'Consignments',
                field: 'Shipper__c',
                names: ['Casco Bay Marine']
            });
            expect(text('.rh-import-finding')).toBe('Finding the records the file names…');
            expect($('.rh-import-go').disabled).toBe(true);
            answer({ 'casco bay marine': [{ id: ACC, name: 'Casco Bay Marine' }] });
            await until(() => !$('.rh-import-finding'));
            expect(found).toEqual([{ [ACC]: 'Casco Bay Marine' }]);
            expect(text('.rh-import-summary')).toBe('Consignments.csv: 1 row creates a record.');
            expect($('.rh-import-go').disabled).toBe(false);
        });

        it('asks once per name, and leaves a name nothing has as a problem', async () => {
            await mount({ columns });
            await choose(
                csv(
                    'Name,Shipper\n"Monadnock Granite, curbing",Monadnock Granite\n"Monadnock Granite, steps",Monadnock Granite\n'
                )
            );
            await until(() => !$('.rh-import-finding'));
            expect(findLookupNames).toHaveBeenCalledTimes(1);
            expect(findLookupNames.mock.calls[0][0].names).toEqual(['Monadnock Granite']);
            expect(text('.rh-import-summary')).toContain('2 rows have problems');
        });
    });
});
