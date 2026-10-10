/**
 * Picklists that follow the row's record type: the editor offers what the
 * row's record type allows, and paste and fill down refuse anything else.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

jest.mock('@salesforce/apex/GridController.findLookupNames', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const STANDARD = '012000000000001AAA';
const RESTRICTED = '012000000000002AAA';
const ROW1 = 'a05000000000001AAA';
const ROW2 = 'a05000000000002AAA';
const ROW3 = 'a05000000000003AAA';

const COLUMNS = [
    { field: 'Name', label: 'Typed Record Name', type: 'text', editable: true, sortable: true },
    {
        field: 'Status__c',
        label: 'Status',
        type: 'picklist',
        editable: true,
        sortable: true,
        options: ['New', 'Working', 'Closed', 'Archived'].map(v => ({ value: v, label: v }))
    }
];
const ROWS = [
    { Id: ROW1, Name: 'Standard one', Status__c: 'Working', RecordTypeId: STANDARD },
    { Id: ROW2, Name: 'Restricted one', Status__c: 'New', RecordTypeId: RESTRICTED },
    { Id: ROW3, Name: 'Restricted two', Status__c: 'Archived', RecordTypeId: RESTRICTED }
];
const BY_TYPE = {
    [STANDARD]: { status__c: ['New', 'Working', 'Closed'] },
    [RESTRICTED]: { status__c: ['New', 'Archived'] }
};

let el;
let changes;
const mount = async (extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, configName: 'Typed_Test', ...extra };
    changes = [];
    el.addEventListener('cellschange', e => changes.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const cell = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);
const edit = async (rowId, field) => {
    cell(rowId, field).querySelector('button').click();
    await flush();
};
const offered = () => $('c-cell-picklist[data-editor]').options.map(o => o.value);
const key = async (target, k, mods = {}) => {
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods })
    );
    await flush();
};
const paste = async (rowId, field, text) => {
    cell(rowId, field).focus();
    await flush();
    const event = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
    event.clipboardData = { getData: () => text };
    cell(rowId, field).dispatchEvent(event);
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('picklists that follow the record type', () => {
    it("offers only the values the row's record type allows", async () => {
        await mount({ recordTypePicklists: BY_TYPE });
        await edit(ROW1, 'Status__c');
        expect(offered()).toEqual(['New', 'Working', 'Closed']);
        await key($('c-cell-picklist[data-editor]'), 'Escape');
        await edit(ROW2, 'Status__c');
        expect(offered()).toEqual(['New', 'Archived']);
    });

    it('offers every value until Salesforce has said what the record type allows', async () => {
        await mount();
        await edit(ROW2, 'Status__c');
        expect(offered()).toEqual(['New', 'Working', 'Closed', 'Archived']);
    });

    it("refuses a pasted value the row's record type does not allow, and takes one it does", async () => {
        await mount({ recordTypePicklists: BY_TYPE });
        await paste(ROW2, 'Status__c', 'Working');
        expect(changes[0].changes).toEqual([]);
        expect(changes[0].errors).toEqual([
            { recordId: ROW2, field: 'Status__c', message: "Working is not available for this record's record type." }
        ]);
        await paste(ROW2, 'Status__c', 'Archived');
        expect(changes[1].errors).toEqual([]);
        expect(changes[1].changes).toEqual([
            { recordId: ROW2, field: 'Status__c', value: 'Archived', originalValue: 'New' }
        ]);
    });

    it('fills down only into rows whose record type allows the value', async () => {
        await mount({ recordTypePicklists: BY_TYPE });
        cell(ROW1, 'Status__c').focus();
        await flush();
        await key(cell(ROW1, 'Status__c'), 'ArrowDown', { shiftKey: true });
        await key(cell(ROW2, 'Status__c'), 'ArrowDown', { shiftKey: true });
        await key(cell(ROW3, 'Status__c'), 'd', { metaKey: true });
        expect(changes[0].label).toBe('fill down');
        expect(changes[0].changes).toEqual([]);
        expect(changes[0].errors.map(e => e.recordId)).toEqual([ROW3, ROW2]);
    });
});
