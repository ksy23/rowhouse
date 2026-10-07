/**
 * Opening a grid with one call: GridController.openGrid brings the
 * configuration, this user's layout and the first page of rows. The grid uses
 * that page only when it is the page it would ask for itself (the same sort and
 * grouping, as the server applies them), and asks again otherwise.
 *
 * The other suites answer openGrid from their older mocks (openGridFrom.js);
 * this one answers it directly, as the server does.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import openGrid from '@salesforce/apex/GridController.openGrid';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import saveLayout from '@salesforce/apex/GridController.saveLayout';

jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn(() => Promise.resolve(true)) }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });

const DEFINITION = {
    name: 'Deals',
    label: 'Deals',
    objectApiName: 'Opportunity',
    pageSize: 2,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
        { field: 'StageName', label: 'Stage', type: 'picklist', editable: true, sortable: true, groupable: true },
        { field: 'CloseDate', label: 'Close Date', type: 'date', editable: true, sortable: true, groupable: true }
    ],
    grouping: []
};
const row = i => ({ Id: '006' + String(i).padStart(15, '0'), Name: 'Deal ' + i, StageName: 'Open' });
const page = (rows, more = null) => ({
    rows,
    hasMore: Boolean(more),
    cursorLocator: more,
    cursorToken: more ? 'token' : null,
    totalRows: more ? rows.length + 1 : rows.length,
    serverMs: 40,
    cpuMs: 20
});
const opened = (extra = {}) => ({
    definition: DEFINITION,
    diagnostics: false,
    canConfigure: false,
    layout: null,
    start: { sortField: 'Name', sortDirection: 'asc', groupBy: [] },
    page: page([row(1), row(2)]),
    ...extra
});

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const mount = (props = {}) => {
    const el = createElement('c-grid-view', { is: GridView });
    Object.assign(el, { configName: 'Deals', ...props });
    document.body.appendChild(el);
    return el;
};
const tableConfig = el => el.shadowRoot.querySelector('c-grid-table').config;
const names = el => tableConfig(el).rows.map(r => r.Name);

beforeEach(() => {
    jest.useFakeTimers();
    openGrid.mockResolvedValue(opened());
    fetchRows.mockResolvedValue(page([row(9)]));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('opening with one call', () => {
    it('asks once, with the grid\'s name, and shows the rows that came with it', async () => {
        const el = mount();
        await settle();
        expect(openGrid).toHaveBeenCalledTimes(1);
        expect(openGrid).toHaveBeenCalledWith({ configName: 'Deals', searchTerm: null, parentLink: null, parentId: null, recordId: null });
        expect(fetchRows).not.toHaveBeenCalled();
        expect(names(el)).toEqual(['Deal 1', 'Deal 2']);
        expect(el.shadowRoot.querySelector('h2').textContent).toBe('Deals');
        expect(el.shadowRoot.querySelector('.rh-count').textContent).toBe('2 items');
    });

    it('passes a record page\'s record, and a child table\'s parent', async () => {
        mount({ recordId: '001000000000001AAA' });
        await settle();
        expect(openGrid).toHaveBeenLastCalledWith(expect.objectContaining({ recordId: '001000000000001AAA', parentLink: null }));
        mount({ parent: { link: 'Deals_Lines', id: '006000000000001AAA', name: 'Deal 1', level: 2 } });
        await settle();
        expect(openGrid).toHaveBeenLastCalledWith({
            configName: 'Deals', searchTerm: null, parentLink: 'Deals_Lines', parentId: '006000000000001AAA', recordId: null
        });
    });

    it('goes on from the first page, on its cursor, to the rest', async () => {
        openGrid.mockResolvedValue(opened({ page: page([row(1), row(2)], 'locator-1') }));
        fetchRows.mockResolvedValue(page([row(3)]));
        const el = mount();
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({
            configName: 'Deals', sortField: 'Name', sortDirection: 'asc', cursorLocator: 'locator-1', cursorToken: 'token'
        }));
        expect(fetchRows.mock.calls[0][0].pageSize).toBeGreaterThan(0);
        expect(names(el)).toEqual(['Deal 1', 'Deal 2', 'Deal 3']);
    });

    it('reads the layout that came with it: its sort, and its widths for the table', async () => {
        const layout = JSON.stringify({ v: 1, sort: [{ field: 'CloseDate', direction: 'desc' }], widths: { Name: 220 } });
        openGrid.mockResolvedValue(opened({ layout, start: { sortField: 'CloseDate', sortDirection: 'desc', groupBy: [] } }));
        const el = mount();
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
        expect(tableConfig(el).sort).toEqual([{ field: 'CloseDate', direction: 'desc' }]);
        expect(tableConfig(el).userLayout.widths).toEqual({ Name: 220 });
        expect(el.shadowRoot.querySelector('.rh-reset-layout')).not.toBeNull();
    });

    it('asks for the rows again when the server read the sort differently', async () => {
        const layout = JSON.stringify({ v: 1, sort: [{ field: 'CloseDate', direction: 'desc' }] });
        openGrid.mockResolvedValue(opened({ layout, start: { sortField: 'Name', sortDirection: 'asc', groupBy: [] } }));
        const el = mount();
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({ sortField: 'CloseDate', sortDirection: 'desc', cursorLocator: null }));
        expect(names(el)).toEqual(['Deal 9']);
    });

    it('asks for the rows again when the server read the grouping differently', async () => {
        const layout = JSON.stringify({ v: 1, grouping: [{ field: 'CloseDate', unit: 'quarter' }] });
        openGrid.mockResolvedValue(opened({ layout, start: { sortField: 'Name', sortDirection: 'asc', groupBy: ['CloseDate:month'] } }));
        mount();
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({ groupBy: ['CloseDate:quarter'] }));
    });

    it('uses the page when the server applied the admin\'s sort the grid asks for by name', async () => {
        // No layout: the grid asks for the admin's sort; the server reports it as applied.
        const el = mount();
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
        expect(names(el)).toEqual(['Deal 1', 'Deal 2']);
    });

    it('uses the page for a grid with no sort at all', async () => {
        openGrid.mockResolvedValue(opened({
            definition: { ...DEFINITION, sortField: null },
            start: { sortField: null, sortDirection: null, groupBy: [] }
        }));
        mount();
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
    });

    it('asks for the rows itself when none came', async () => {
        openGrid.mockResolvedValue(opened({ page: undefined, start: undefined }));
        const el = mount();
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(names(el)).toEqual(['Deal 9']);
    });

    it('says why when the rows it came for could not be read, without asking again', async () => {
        openGrid.mockResolvedValue(opened({ page: undefined, pageError: 'Cannot group by Name.' }));
        const el = mount();
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelector('.rh-load-error').textContent).toContain('Cannot group by Name.');
        expect(el.shadowRoot.querySelector('h2').textContent).toBe('Deals'); // the title, above it
    });

    it('opens as the admin set it when the layout could not be read, and keeps none', async () => {
        openGrid.mockResolvedValue(opened({ layoutError: 'Insufficient access to Grid User Layout.' }));
        const el = mount();
        await settle();
        expect(names(el)).toEqual(['Deal 1', 'Deal 2']);
        el.shadowRoot.querySelector('c-grid-table').dispatchEvent(new CustomEvent('layoutchange', { detail: { widths: { Name: 300 } } }));
        jest.advanceTimersByTime(5000);
        await settle();
        expect(saveLayout).not.toHaveBeenCalled();
    });

    it('shows why it could not open', async () => {
        openGrid.mockRejectedValue({ body: { message: 'No Grid Configuration named "Deals".' } });
        const el = mount();
        await settle();
        expect(el.shadowRoot.querySelector('.rh-load-error').textContent).toContain('No Grid Configuration named "Deals".');
        expect(fetchRows).not.toHaveBeenCalled();
    });

    it('drops an answer for a grid it no longer shows', async () => {
        let first;
        openGrid.mockReturnValueOnce(new Promise(resolve => { first = resolve; }));
        openGrid.mockResolvedValueOnce(opened({ definition: { ...DEFINITION, name: 'Other', label: 'Other' } }));
        const el = mount();
        await settle();
        el.configName = 'Other';
        await settle();
        first(opened());
        await settle();
        expect(el.shadowRoot.querySelector('h2').textContent).toBe('Other');
    });
});
