/**
 * Picklists that follow the record type: the grid reads what each record
 * type among its rows allows (one c-grid-record-type-values each), hands it
 * to the table, narrows Update field to what every selected row allows, and
 * gives a new row the user's default record type.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

const STANDARD = '012000000000001AAA';
const RESTRICTED = '012000000000002AAA';
const STATUS = {
    field: 'Status__c',
    label: 'Status',
    type: 'picklist',
    editable: true,
    creatable: true,
    options: ['New', 'Working', 'Closed', 'Archived'].map(v => ({ value: v, label: v }))
};
const DEFINITION = {
    name: 'Typed_Test',
    label: 'Typed Test',
    objectApiName: 'Rowhouse_Test_Typed__c',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    byRecordType: true,
    columns: [
        { field: 'Name', label: 'Typed Record Name', type: 'text', editable: true, creatable: true, isName: true },
        STATUS
    ]
};
const ROWS = [
    { Id: 'a05000000000001AAA', Name: 'One', Status__c: 'Working', RecordTypeId: STANDARD },
    { Id: 'a05000000000002AAA', Name: 'Two', Status__c: 'New', RecordTypeId: RESTRICTED },
    { Id: 'a05000000000003AAA', Name: 'Three', Status__c: 'Closed', RecordTypeId: STANDARD }
];
const settle = async () => {
    for (let i = 0; i < 30; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const tableOf = el => $(el, 'c-grid-table');
const readers = el => $$(el, 'c-grid-record-type-values');

const mount = async (definition = DEFINITION, newRow = null) => {
    getGridConfig.mockResolvedValue({ definition, diagnostics: false });
    const base = openGridFrom({ getGridConfig, fetchRows });
    openGrid.mockImplementation(async args => ({ ...(await base(args)), newRow }));
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Typed_Test';
    document.body.appendChild(el);
    await settle();
    return el;
};
const answer = async (el, recordTypeId, values) => {
    readers(el)
        .find(r => r.recordTypeId === recordTypeId)
        .dispatchEvent(new CustomEvent('values', { detail: { recordTypeId, fields: { status__c: values } } }));
    await settle();
};

beforeEach(() => {
    fetchRows.mockResolvedValue({
        rows: ROWS,
        hasMore: false,
        cursorLocator: null,
        cursorToken: null,
        totalRows: 3,
        serverMs: 1,
        cpuMs: 1
    });
});
afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('picklists that follow the record type', () => {
    it('reads each record type among the rows once, for the grid object', async () => {
        const el = await mount();
        expect(readers(el).map(r => [r.objectApiName, r.recordTypeId])).toEqual([
            ['Rowhouse_Test_Typed__c', STANDARD],
            ['Rowhouse_Test_Typed__c', RESTRICTED]
        ]);
        expect(tableOf(el).config.recordTypePicklists).toBeNull();
    });

    it('hands the table what each record type allows, as Salesforce answers', async () => {
        const el = await mount();
        await answer(el, STANDARD, ['New', 'Working', 'Closed']);
        await answer(el, RESTRICTED, ['New', 'Archived']);
        expect(tableOf(el).config.recordTypePicklists).toEqual({
            [STANDARD]: { status__c: ['New', 'Working', 'Closed'] },
            [RESTRICTED]: { status__c: ['New', 'Archived'] }
        });
    });

    it('reads nothing when the grid does not follow record types', async () => {
        const el = await mount({ ...DEFINITION, byRecordType: false });
        expect(readers(el)).toEqual([]);
    });

    it('Update field offers the values every selected row allows', async () => {
        const el = await mount();
        await answer(el, STANDARD, ['New', 'Working', 'Closed']);
        await answer(el, RESTRICTED, ['New', 'Archived']);
        const select = async ids => {
            tableOf(el).dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: ids } }));
            await settle();
            $(el, '.rh-mass-edit').click();
            await settle();
            const status = $(el, 'c-grid-mass-update').columns.find(c => c.field === 'Status__c');
            return status.options.map(o => o.value);
        };
        expect(await select([ROWS[0].Id, ROWS[2].Id])).toEqual(['New', 'Working', 'Closed']);
        $(el, 'c-grid-mass-update').dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(await select([ROWS[0].Id, ROWS[1].Id])).toEqual(['New']);
    });

    it("gives a new row the user's default record type", async () => {
        const el = await mount(DEFINITION, {
            objectLabel: 'Rowhouse Test Typed Record',
            inline: true,
            defaults: {},
            names: {},
            presets: {},
            recordTypeId: RESTRICTED
        });
        $(el, 'lightning-button.rh-new').click();
        await settle();
        expect(tableOf(el).config.newRows[0].RecordTypeId).toBe(RESTRICTED);
    });
});
