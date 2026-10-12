/**
 * The import dialog's choices and undo: a workbook's sheet, a file
 * column mapped by hand, records matched by an External Id, and Undo import.
 */
import { createElement } from 'lwc';
import GridImportDialog from 'c/gridImportDialog';
import importRows from '@salesforce/apex/GridController.importRows';
import undoImport from '@salesforce/apex/GridController.undoImport';

jest.mock('@salesforce/apex/GridController.importRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.undoImport', () => ({ default: jest.fn() }), { virtual: true });

/* global require, Buffer -- Jest runs in Node, where the test builds its own .xlsx file. */
const zlib = require('zlib');

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, scale: 2 },
    { field: 'Bill_Of_Lading__c', label: 'Bill of Lading', type: 'text', editable: true, externalId: true }
];
const ID1 = 'a00000000000001AAA';
const NEW1 = 'a00000000000009AAA';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check) {
    for (let i = 0; i < 50 && !check(); i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
    }
}

/** A ZIP around a minimal workbook with these sheets: { name: sheetXml }. */
function xlsx(sheets) {
    const names = Object.keys(sheets);
    const parts = {
        'xl/workbook.xml':
            '<workbook><sheets>' +
            names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
            '</sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
            '<Relationships>' +
            names.map((n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
            '</Relationships>'
    };
    names.forEach((n, i) => {
        parts[`xl/worksheets/sheet${i + 1}.xml`] = sheets[n];
    });
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
    end.writeUInt16LE(Object.keys(parts).length, 8);
    end.writeUInt16LE(Object.keys(parts).length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, dir, end]);
}
const sheetOf = rows =>
    '<worksheet><sheetData>' +
    rows
        .map(
            (cells, r) =>
                `<row r="${r + 1}">` +
                cells
                    .map(
                        (v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`
                    )
                    .join('') +
                '</row>'
        )
        .join('') +
    '</sheetData></worksheet>';

describe('gridImportDialog choices and undo', () => {
    let el;
    const $ = selector => el.shadowRoot.querySelector(selector);
    const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
    const text = selector => ($(selector) ? $(selector).textContent : null);
    const mount = async () => {
        el = createElement('c-grid-import-dialog', { is: GridImportDialog });
        Object.assign(el, {
            columns: COLUMNS,
            rows: [{ Id: ID1, Name: 'Kennebec Lumber to Augusta', Freight_Charge__c: '1' }],
            refNames: {},
            canCreate: true,
            configName: 'Consignment_Import'
        });
        document.body.appendChild(el);
        await tick();
    };
    const choose = async file => {
        $('.rh-import-file').dispatchEvent(new CustomEvent('change', { detail: { files: [file] } }));
        await tick();
        await until(() => $('.rh-import-summary') || text('.rh-import-error'));
    };
    const select = async (target, value) => {
        target.value = value;
        target.dispatchEvent(new CustomEvent('change'));
        await tick();
    };
    const csv = content => new File([content], 'Consignments.csv', { type: 'text/csv' });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        jest.clearAllMocks();
    });

    it("offers a workbook's sheets and checks the one chosen", async () => {
        await mount();
        const book = xlsx({
            Portland: sheetOf([['Name'], ['Saco River Outfitters to Portland']]),
            Bangor: sheetOf([
                ['Name', 'Freight Charge'],
                ['Penobscot Paper to Bangor', '7'],
                ['Androscoggin Pulp to Bangor', '8']
            ])
        });
        await choose(new File([book], 'Consignments.xlsx'));
        expect($$('.rh-import-sheet select option').map(o => o.value)).toEqual(['Portland', 'Bangor']);
        expect($('.rh-import-sheet select').value).toBe('Portland');
        expect(text('.rh-import-summary')).toBe('Consignments.xlsx: 1 row creates a record.');
        await select($('.rh-import-sheet select'), 'Bangor');
        expect(text('.rh-import-summary')).toBe('Consignments.xlsx: 2 rows create records.');
        expect($('.rh-import-sheet select').value).toBe('Bangor');
        expect($$('.rh-import-map').map(m => m.value)).toEqual(['Name', 'Freight_Charge__c']);
    });

    it('opens a workbook on its first sheet that names a column, past a sheet of notes', async () => {
        await mount();
        const book = xlsx({
            Notes: sheetOf([['Rates from 1 October 2026'], ['Prepared by dispatch']]),
            Consignments: sheetOf([['Name'], ['Wachusett Paper to Worcester'], ['Quabbin Supply to Springfield']])
        });
        await choose(new File([book], 'Consignments.xlsx'));
        expect($('.rh-import-sheet select').value).toBe('Consignments');
        expect(text('.rh-import-summary')).toBe('Consignments.xlsx: 2 rows create records.');
        await select($('.rh-import-sheet select'), 'Notes');
        expect(text('.rh-import-error')).toBe(
            'None of the file’s column names is a column of this grid. Choose below what each column is imported as.'
        );
        expect($('.rh-import-summary')).toBeNull();
    });

    it('lets a file column be mapped by hand, or left out', async () => {
        await mount();
        await choose(csv('Name,Rate\nWachusett Paper to Worcester,5\n'));
        expect($$('.rh-import-map').map(m => m.value)).toEqual(['Name', '__skip']);
        expect(text('.rh-import-map-note')).toBe('Not a column of this grid.');
        await select($$('.rh-import-map')[1], 'Freight_Charge__c');
        expect($$('.rh-import-map').map(m => m.value)).toEqual(['Name', 'Freight_Charge__c']);
        expect([...$$('.rh-import-preview tbody td')].map(td => td.textContent)).toEqual([
            '2',
            'Create',
            'Wachusett Paper to Worcester',
            '$5.00'
        ]);
        await select($$('.rh-import-map')[0], '__skip');
        expect([...$$('.rh-import-preview tbody td')].map(td => td.textContent)).toEqual(['2', 'Create', '$5.00']);
    });

    it('matches records by an External Id column when asked, and sends the server that column', async () => {
        importRows.mockResolvedValue({
            rows: [{ index: 0, success: true, created: false, recordId: ID1, previous: { Freight_Charge__c: '1' } }]
        });
        await mount();
        await choose(csv('Bill of Lading,Freight Charge\nBOL-40217,9\n'));
        expect($$('.rh-import-match select option').map(o => o.textContent)).toEqual(['Record Id', 'Bill of Lading']);
        // No Id column: matched by the key to begin with, so no record is copied by mistake.
        expect($('.rh-import-match select').value).toBe('Bill_Of_Lading__c');
        expect(text('.rh-import-summary')).toBe(
            'Consignments.csv: 1 row updates the record with Bill of Lading, or creates one.'
        );
        expect($$('.rh-import-count p').map(p => p.textContent)).toEqual([
            '1',
            'update or create',
            '0',
            'rows with problems'
        ]);
        await select($('.rh-import-match select'), '');
        expect(text('.rh-import-summary')).toBe('Consignments.csv: 1 row creates a record.');
        await select($('.rh-import-match select'), 'Bill_Of_Lading__c');
        expect(text('.rh-import-id-text')).toContain('Records are matched by Bill of Lading');
        expect([...$$('.rh-import-preview tbody td')].map(td => td.textContent).slice(0, 2)).toEqual([
            '2',
            'Update or create'
        ]);
        $('.rh-import-go').click();
        await until(() => $('.rh-import-result'));
        expect(importRows).toHaveBeenCalledWith({
            configName: 'Consignment_Import',
            rows: [{ Bill_Of_Lading__c: 'BOL-40217', Freight_Charge__c: 9 }],
            recordId: null,
            matchField: 'Bill_Of_Lading__c'
        });
    });

    it('keeps matching by the record Id when the file has one, whatever else it has', async () => {
        await mount();
        await choose(csv(`Id,Bill of Lading\n${ID1},BOL-40217\n`));
        expect($('.rh-import-match select').value).toBe('');
        expect(text('.rh-import-summary')).toBe('Consignments.csv: 1 row updates a record.');
    });

    it('undoes an import: the old values back through the import, the new records deleted', async () => {
        importRows.mockResolvedValueOnce({
            rows: [
                // Freight Charge was blank: Apex leaves a null out, so Undo writes it back blank.
                {
                    index: 0,
                    success: true,
                    created: false,
                    recordId: ID1,
                    previous: { Name: 'Kennebec Lumber to Augusta' }
                },
                { index: 1, success: true, created: true, recordId: NEW1 }
            ]
        });
        await mount();
        await choose(
            csv(`Id,Name,Freight Charge\n${ID1},Kennebec Lumber to Bangor,2\n,Penobscot Paper full truck,3\n`)
        );
        $('.rh-import-go').click();
        await until(() => $('.rh-import-result'));
        expect($('.rh-import-undo')).not.toBeNull();
        $('.rh-import-undo').click();
        await tick();
        expect(text('.rh-import-undo-confirm')).toBe(
            'Undo puts the 1 record it updated back as they were and deletes the 1 record it created (to the Recycle Bin). Any change made to those records since the import is overwritten.'
        );
        importRows.mockResolvedValueOnce({ rows: [{ index: 0, success: true, created: false, recordId: ID1 }] });
        undoImport.mockResolvedValue({ deletedIds: [NEW1], errors: [] });
        $('.rh-import-undo-go').click();
        await until(() => $('.rh-import-undo-result'));
        expect(importRows).toHaveBeenLastCalledWith({
            configName: 'Consignment_Import',
            rows: [{ Id: ID1, Name: 'Kennebec Lumber to Augusta', Freight_Charge__c: null }],
            recordId: null
        });
        expect(undoImport).toHaveBeenCalledWith({ configName: 'Consignment_Import', recordIds: [NEW1] });
        expect(text('.rh-import-undo-result')).toBe('Undo put back 1 record and deleted 1 new record.');
        expect($('.rh-import-undo')).toBeNull(); // once
    });

    it('keeps the import when the user thinks better of undoing it', async () => {
        importRows.mockResolvedValueOnce({ rows: [{ index: 0, success: true, created: true, recordId: NEW1 }] });
        await mount();
        await choose(csv('Name\nCasco Bay Marine to Portland\n'));
        $('.rh-import-go').click();
        await until(() => $('.rh-import-result'));
        $('.rh-import-undo').click();
        await tick();
        $('.rh-import-keep').click();
        await tick();
        expect($('.rh-import-undo-confirm')).toBeNull();
        expect($('.rh-import-undo')).not.toBeNull();
        expect(undoImport).not.toHaveBeenCalled();
    });
});
