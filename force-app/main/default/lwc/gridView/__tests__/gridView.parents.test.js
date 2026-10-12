/**
 * A column of a parent record's field (Account.Industry on a grid of test
 * records): an edit shows on every loaded row with the same parent, as one
 * undo step, and after the save every row that shows that parent is read
 * again.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import saveRows from '@salesforce/apex/GridController.save';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

const INDUSTRY = 'Shipper__r.Industry';
const DEFINITION = {
    name: 'Consignment_Shippers',
    label: 'Consignment Shippers',
    objectApiName: 'Consignment__c',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, isName: true },
        { field: INDUSTRY, label: 'Industry', type: 'text', editable: true, isPath: true }
    ]
};
const HARBOR = '001000000000001AAA';
const MILL = '001000000000002AAA';
const ROWS = [
    { Id: 'a00000000000000001', Name: 'Ledger paper, Bangor', [INDUSTRY]: 'Banking', _parents: { [INDUSTRY]: HARBOR } },
    {
        Id: 'a00000000000000002',
        Name: 'Ledger paper, Brunswick',
        [INDUSTRY]: 'Banking',
        _parents: { [INDUSTRY]: HARBOR }
    },
    {
        Id: 'a00000000000000003',
        Name: 'Mill River Energy, Augusta',
        [INDUSTRY]: 'Energy',
        _parents: { [INDUSTRY]: MILL }
    }
];
const settle = async () => {
    for (let i = 0; i < 30; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const tableOf = el => el.shadowRoot.querySelector('c-grid-table');
const config = el => tableOf(el).config;

const mount = async () => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Consignment_Shippers';
    document.body.appendChild(el);
    await settle();
    return el;
};
const edit = async (el, recordId, value) => {
    tableOf(el).dispatchEvent(
        new CustomEvent('cellchange', { detail: { recordId, field: INDUSTRY, value, originalValue: 'Banking' } })
    );
    await settle();
};

beforeEach(() => {
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
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

describe('a parent record’s field', () => {
    it('changes on every row with that parent, as one step Undo takes back', async () => {
        const el = await mount();
        await edit(el, ROWS[0].Id, 'Energy');
        expect(config(el).drafts).toEqual({
            [ROWS[0].Id]: { [INDUSTRY]: 'Energy' },
            [ROWS[1].Id]: { [INDUSTRY]: 'Energy' }
        });
        expect(config(el).history.undoLabel).toBe('Undo edit of 2 cells');
        tableOf(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(config(el).drafts).toEqual({});
    });

    it('is saved with the rows, and every row that shows the parent is read again', async () => {
        const el = await mount();
        await edit(el, ROWS[0].Id, 'Energy');
        saveRows.mockResolvedValue({
            done: true,
            saveId: null,
            successCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        fetchRowsById.mockImplementation(({ recordIds }) =>
            Promise.resolve(ROWS.filter(r => recordIds.includes(r.Id)).map(r => ({ ...r, [INDUSTRY]: 'Energy' })))
        );
        tableOf(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        await settle();
        expect(saveRows).toHaveBeenCalledWith({
            configName: 'Consignment_Shippers',
            rows: [
                { Id: ROWS[0].Id, [INDUSTRY]: 'Energy' },
                { Id: ROWS[1].Id, [INDUSTRY]: 'Energy' }
            ]
        });
        expect(config(el).drafts).toEqual({});
        expect(config(el).rows.map(r => r[INDUSTRY])).toEqual(['Energy', 'Energy', 'Energy']);
    });
});
