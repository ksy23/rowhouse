/**
 * Filters. The user's own column filters come from the table
 * (filterchange); the grid keeps them for the session and sends them with
 * every request for rows and for counts and subtotals, as it does the search
 * term. The admin's filters are applied by the server: the grid only hands
 * them to the table, to show as locked chips. The header says "Filtered"
 * while any filter applies, and an empty list offers to clear the filters.
 */
import { createElement } from 'lwc';
import GridView, { SEARCH_DELAY_MS } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import getLayout from '@salesforce/apex/GridController.getLayout';
import saveLayout from '@salesforce/apex/GridController.saveLayout';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.runAction', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.getLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.resetLayout', () => ({ default: jest.fn() }), { virtual: true });

const STAGES = [
    { value: 'Open', label: 'Open' },
    { value: 'Won', label: 'Won' }
];
// Amount has a subtotal, so every load also asks for counts and subtotals.
const DEFINITION = {
    name: 'Test_Records',
    label: 'Test Records',
    objectApiName: 'Rowhouse_Test_Record__c',
    objectLabel: 'Rowhouse Test Records',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
        {
            field: 'Stage__c',
            label: 'Stage',
            type: 'picklist',
            editable: true,
            sortable: true,
            groupable: true,
            options: STAGES
        },
        {
            field: 'Amount__c',
            label: 'Amount',
            type: 'currency',
            editable: true,
            sortable: true,
            scale: 2,
            subtotal: 'sum'
        }
    ]
};
const WON = { field: 'Stage__c', operator: 'equals', value: 'Won', valueTo: null };
const MID_SIZED = { field: 'Amount__c', operator: 'between', value: '10', valueTo: '99' };

const row = i => ({ Id: 'a00' + String(i).padStart(15, '0'), Name: 'Row ' + i, Stage__c: 'Open', Amount__c: i });
const page = (rows, { hasMore = false, locator = null, total = rows.length, token = null } = {}) => ({
    rows,
    hasMore,
    cursorLocator: locator,
    cursorToken: token,
    totalRows: total
});

// Resolve every pending promise.
const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const table = el => $(el, 'c-grid-table');
const tableConfig = el => table(el).config;
const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0];
const filterChange = (el, filters) => table(el).dispatchEvent(new CustomEvent('filterchange', { detail: { filters } }));
const search = async (el, value) => {
    $(el, '.rh-search').dispatchEvent(new CustomEvent('change', { detail: { value } }));
    await jest.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 10);
    await settle();
};

function mount(configName = 'Test_Records') {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = configName;
    document.body.appendChild(el);
    return el;
}

const withDefinition = extra =>
    getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, ...extra }, diagnostics: false });

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    jest.useFakeTimers();
    withDefinition({});
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: false });
    getLayout.mockResolvedValue(null);
    saveLayout.mockResolvedValue(true);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe("the user's filters", () => {
    it('starts with none: the first requests carry no filters', async () => {
        const el = mount();
        await settle();
        expect(fetchRows.mock.calls[0][0]).toMatchObject({ filters: null, recordId: null });
        expect(summarizeGroups.mock.calls[0][0]).toMatchObject({ filters: null, recordId: null });
        expect(tableConfig(el).filters).toEqual([]);
    });

    it('asks the server again for the rows, and for their counts and subtotals, with the filters', async () => {
        const el = mount();
        await settle();
        fetchRows.mockClear();
        summarizeGroups.mockClear();
        fetchRows.mockResolvedValue(page([row(2)]));
        filterChange(el, [WON, MID_SIZED]);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledWith({
            configName: 'Test_Records',
            searchTerm: null,
            sortField: 'Name',
            sortDirection: 'asc',
            cursorLocator: null,
            cursorToken: null,
            pageSize: null,
            filters: [WON, MID_SIZED],
            recordId: null
        });
        expect(summarizeGroups).toHaveBeenCalledTimes(1);
        expect(summarizeGroups).toHaveBeenCalledWith({
            configName: 'Test_Records',
            searchTerm: null,
            grouping: [],
            fromId: null,
            toId: null,
            filters: [WON, MID_SIZED],
            recordId: null
        });
        // The table is told which filters apply, for its chips and column menus.
        expect(tableConfig(el).filters).toEqual([WON, MID_SIZED]);
        expect(tableConfig(el).rows.map(r => r.Id)).toEqual([row(2).Id]);
    });

    it('sends each filter as a plain { field, operator, value, valueTo }, whatever else came with it', async () => {
        const el = mount();
        await settle();
        filterChange(el, [{ field: 'Stage__c', operator: 'is_blank', label: 'Stage is blank', chip: { key: 'x' } }]);
        await settle();
        expect(lastCall(fetchRows).filters).toEqual([
            { field: 'Stage__c', operator: 'is_blank', value: null, valueTo: null }
        ]);
        expect(lastCall(summarizeGroups).filters).toEqual([
            { field: 'Stage__c', operator: 'is_blank', value: null, valueTo: null }
        ]);
    });

    it('asks for every row again when the last filter is removed', async () => {
        const el = mount();
        await settle();
        filterChange(el, [WON]);
        await settle();
        fetchRows.mockClear();
        summarizeGroups.mockClear();
        filterChange(el, []);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(lastCall(fetchRows).filters).toBeNull();
        expect(lastCall(summarizeGroups).filters).toBeNull();
        expect(tableConfig(el).filters).toEqual([]);
    });

    it('asks for nothing when there were no filters and still are none', async () => {
        const el = mount();
        await settle();
        fetchRows.mockClear();
        summarizeGroups.mockClear();
        filterChange(el, []);
        table(el).dispatchEvent(new CustomEvent('filterchange'));
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
        expect(summarizeGroups).not.toHaveBeenCalled();
    });

    it('reads a change it cannot make sense of as no filters', async () => {
        const el = mount();
        await settle();
        filterChange(el, [WON]);
        await settle();
        table(el).dispatchEvent(new CustomEvent('filterchange', { detail: { filters: 'Stage = Won' } }));
        await settle();
        expect(lastCall(fetchRows).filters).toBeNull();
        expect(tableConfig(el).filters).toEqual([]);
    });

    it('keeps the filters with a search, and the search with the filters', async () => {
        const el = mount();
        await settle();
        filterChange(el, [WON]);
        await settle();
        await search(el, 'acme');
        expect(lastCall(fetchRows)).toMatchObject({ searchTerm: 'acme', filters: [WON] });
        expect(lastCall(summarizeGroups)).toMatchObject({ searchTerm: 'acme', filters: [WON] });
        filterChange(el, [WON, MID_SIZED]);
        await settle();
        expect(lastCall(fetchRows)).toMatchObject({ searchTerm: 'acme', filters: [WON, MID_SIZED] });
    });

    it('keeps the filters for a sort that reloads and for more rows as you scroll', async () => {
        // A server with 50,000 matching rows: the grid preloads some, then loads more on request.
        let next = 0;
        fetchRows.mockImplementation(({ pageSize }) => {
            const size = pageSize == null ? 200 : pageSize;
            const rows = Array.from({ length: size }, () => row(++next));
            return Promise.resolve(page(rows, { hasMore: true, locator: 'fp:' + next, total: 50000, token: 'tok' }));
        });
        const settleAll = async () => {
            for (let i = 0; i < 4; i++) {
                // eslint-disable-next-line no-await-in-loop
                await settle();
            }
        };
        const el = mount();
        await settleAll();
        fetchRows.mockClear();
        filterChange(el, [WON]);
        await settleAll();
        // Every page of the preload asks for the same filtered rows.
        expect(fetchRows.mock.calls.length).toBeGreaterThan(1);
        fetchRows.mock.calls.forEach(([args]) => expect(args.filters).toEqual([WON]));

        fetchRows.mockClear();
        table(el).dispatchEvent(new CustomEvent('loadmore'));
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(lastCall(fetchRows)).toMatchObject({ filters: [WON], cursorToken: 'tok' });
        expect(lastCall(fetchRows).cursorLocator).not.toBeNull();

        fetchRows.mockClear();
        table(el).dispatchEvent(
            new CustomEvent('sortchange', { detail: { sort: [{ field: 'Amount__c', direction: 'desc' }] } })
        );
        await settle();
        expect(fetchRows.mock.calls[0][0]).toMatchObject({
            sortField: 'Amount__c',
            sortDirection: 'desc',
            cursorLocator: null,
            filters: [WON]
        });
    });

    it('drops rows for older filters that arrive after newer ones', async () => {
        const el = mount();
        await settle();
        let slow;
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                slow = resolve;
            })
        );
        fetchRows.mockResolvedValueOnce(page([row(9)]));
        filterChange(el, [WON]);
        await settle();
        filterChange(el, [MID_SIZED]);
        await settle();
        slow(page([row(5)]));
        await settle();
        expect(tableConfig(el).rows.map(r => r.Id)).toEqual([row(9).Id]);
        expect(tableConfig(el).filters).toEqual([MID_SIZED]);
    });

    it('forgets the filters when the grid is pointed at another configuration', async () => {
        const el = mount();
        await settle();
        filterChange(el, [WON]);
        await settle();
        el.configName = 'Other_Grid';
        await settle();
        expect(lastCall(fetchRows)).toMatchObject({ configName: 'Other_Grid', filters: null });
        expect(tableConfig(el).filters).toEqual([]);
    });
});

describe("the admin's filters", () => {
    const ADMIN = [
        { text: 'Stage equals Open', field: 'Stage__c', operator: 'equals', value: 'Open' },
        { text: 'Amount greater than 0', field: 'Amount__c', operator: 'greater_than', value: '0' }
    ];

    it('are handed to the table as text only, to show locked', async () => {
        withDefinition({ filters: ADMIN });
        const el = mount();
        await settle();
        expect(tableConfig(el).adminFilters).toEqual([
            { text: 'Stage equals Open' },
            { text: 'Amount greater than 0' }
        ]);
    });

    it('are applied by the server, not sent by the grid', async () => {
        withDefinition({ filters: ADMIN });
        const el = mount();
        await settle();
        expect(fetchRows.mock.calls[0][0].filters).toBeNull();
        filterChange(el, [WON]);
        await settle();
        expect(lastCall(fetchRows).filters).toEqual([WON]);
    });

    it('are an empty list when the configuration has none', async () => {
        const el = mount();
        await settle();
        expect(tableConfig(el).adminFilters).toEqual([]);
        el.remove();
        withDefinition({ filters: [] });
        const again = mount();
        await settle();
        expect(tableConfig(again).adminFilters).toEqual([]);
    });
});

describe('"Filtered" in the header', () => {
    it('is not shown while no filter applies', async () => {
        const el = mount();
        await settle();
        expect($(el, '.rh-filtered')).toBeNull();
    });

    it('is shown while the user has a filter, and goes when it is removed', async () => {
        const el = mount();
        await settle();
        filterChange(el, [WON]);
        await settle();
        expect($(el, '.rh-filtered').textContent).toBe('Filtered');
        filterChange(el, []);
        await settle();
        expect($(el, '.rh-filtered')).toBeNull();
    });

    it('is shown whenever the admin has filtered the grid', async () => {
        withDefinition({ filters: [{ text: 'Stage equals Open' }] });
        const el = mount();
        await settle();
        expect($(el, '.rh-filtered').textContent).toBe('Filtered');
    });
});

describe('an empty list with filters', () => {
    it('says no records match the filters, and offers to clear them', async () => {
        const el = mount();
        await settle();
        fetchRows.mockResolvedValue(page([]));
        filterChange(el, [WON]);
        await settle();
        expect(tableConfig(el).emptyState).toEqual({
            title: 'No records match your filters',
            message: 'Change or remove a filter to see more records.',
            actionLabel: 'Clear filters',
            icon: 'utility:filterList'
        });

        fetchRows.mockResolvedValue(page([row(1)]));
        summarizeGroups.mockClear();
        table(el).dispatchEvent(new CustomEvent('emptyaction'));
        await settle();
        expect(lastCall(fetchRows).filters).toBeNull();
        expect(lastCall(summarizeGroups).filters).toBeNull();
        expect(tableConfig(el).filters).toEqual([]);
        expect(tableConfig(el).rows).toHaveLength(1);
        expect(tableConfig(el).emptyState.title).toBe('No records yet');
    });

    it('offers to clear the filters rather than to import', async () => {
        withDefinition({ allowImport: true, canCreate: true });
        const el = mount();
        await settle();
        fetchRows.mockResolvedValue(page([]));
        filterChange(el, [WON]);
        await settle();
        expect(tableConfig(el).emptyState.actionLabel).toBe('Clear filters');
        table(el).dispatchEvent(new CustomEvent('emptyaction'));
        await settle();
        expect($(el, 'c-grid-import-dialog')).toBeNull();
        expect(lastCall(fetchRows).filters).toBeNull();
    });

    it("says when the admin's filters are why it is empty, not that there are no records", async () => {
        withDefinition({ filters: [{ text: 'Stage is Won' }] });
        fetchRows.mockResolvedValue(page([]));
        const el = mount();
        await settle();
        expect(tableConfig(el).emptyState).toEqual({
            title: 'No records match this grid’s filters',
            message: 'Your Salesforce admin set this grid to show only some records.',
            actionLabel: null,
            icon: 'utility:filterList'
        });
    });

    it('still offers an import there, when the grid allows one', async () => {
        withDefinition({ filters: [{ text: 'Stage is Won' }], allowImport: true, canCreate: true });
        fetchRows.mockResolvedValue(page([]));
        const el = mount();
        await settle();
        expect(tableConfig(el).emptyState).toMatchObject({
            message:
                'Your Salesforce admin set this grid to show only some records. Import a CSV or Excel file to add records.',
            actionLabel: 'Import'
        });
    });

    it('speaks of the search first when there is one, and clears only the search', async () => {
        const el = mount();
        await settle();
        filterChange(el, [WON]);
        await settle();
        fetchRows.mockResolvedValue(page([]));
        await search(el, 'zzz');
        expect(tableConfig(el).emptyState).toMatchObject({
            title: 'No records match “zzz”',
            actionLabel: 'Clear search'
        });

        // The search goes; the filters stay, and are what the empty list speaks of next.
        table(el).dispatchEvent(new CustomEvent('emptyaction'));
        await settle();
        expect(lastCall(fetchRows)).toMatchObject({ searchTerm: null, filters: [WON] });
        expect($(el, '.rh-search').value).toBe('');
        expect(tableConfig(el).emptyState.actionLabel).toBe('Clear filters');

        table(el).dispatchEvent(new CustomEvent('emptyaction'));
        await settle();
        expect(lastCall(fetchRows)).toMatchObject({ searchTerm: null, filters: null });
    });
});

describe('a child table with filters', () => {
    it("does not tell its tab a filtered count: 0 would hide the parent row's toggle", async () => {
        const el = createElement('c-grid-view', { is: GridView });
        el.configName = 'Test_Children';
        el.parent = { link: 'Test_Records_Children', id: 'a00000000000000001', name: 'Row 1', level: 2 };
        const told = [];
        el.addEventListener('countchange', e => told.push(e.detail.count));
        document.body.appendChild(el);
        await settle();
        expect(told).toEqual([3]);
        fetchRows.mockResolvedValue(page([]));
        filterChange(el, [WON]);
        await settle();
        expect(told).toEqual([3]);
        fetchRows.mockResolvedValue(page([row(1), row(2)]));
        filterChange(el, []);
        await settle();
        expect(told).toEqual([3, 2]);
    });
});
