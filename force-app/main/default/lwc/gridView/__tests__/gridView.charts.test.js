/**
 * Charts, as a list view has them: the Charts button opens a panel beside the
 * table with a chart of every record the search and filters match; the gear
 * edits it (Edit chart); it is kept with the user's layout, open
 * or closed, and read again whenever the counts and subtotals are.
 */
import { createElement } from 'lwc';
import GridView, { LAYOUT_DELAY_MS } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import chartGroups from '@salesforce/apex/GridController.chartGroups';
import getLayout from '@salesforce/apex/GridController.getLayout';
import saveLayout from '@salesforce/apex/GridController.saveLayout';
import resetLayout from '@salesforce/apex/GridController.resetLayout';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.chartGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.getLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.resetLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate]() {}
            [GenerateUrl]() {
                return Promise.resolve('');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, sortable: true, scale: 2 },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        sortable: true,
        groupable: true,
        options: [
            { value: 'Economy', label: 'Economy' },
            { value: 'Standard', label: 'Standard' }
        ]
    },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', editable: true, sortable: true, groupable: true }
];
const DEFINITION = {
    name: 'Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    columns: COLUMNS
};
const row = i => ({
    Id: 'a00' + String(i).padStart(15, '0'),
    Name: 'Kennebec Lumber, load ' + i,
    Freight_Charge__c: 100 * i,
    Service_Level__c: i % 2 ? 'Economy' : 'Standard'
});
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length });
const ANSWER = {
    groups: [
        { k: ['Economy'], l: [''], n: 3, v: {} },
        { k: ['Standard'], l: [''], n: 2, v: {} }
    ],
    boundaries: null,
    tooManyGroups: false
};

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const panel = el => $(el, 'c-grid-chart-panel');
const button = el => $(el, '.rh-charts');
const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0];
const keptLayout = () => JSON.parse(lastCall(saveLayout).layout);

function mount() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Consignments';
    document.body.appendChild(el);
    return el;
}

async function openCharts(el) {
    button(el).click();
    await settle();
}

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: false });
    chartGroups.mockResolvedValue(ANSWER);
    getLayout.mockResolvedValue(null);
    saveLayout.mockResolvedValue(true);
    resetLayout.mockResolvedValue(undefined);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

it("has a list view's Charts button, with its chart icon and Salesforce's tooltip", async () => {
    const el = mount();
    await settle();
    expect(button(el).iconName).toBe('utility:chart');
    expect(button(el).alternativeText).toBe('Charts');
    expect(button(el).title).toBe('Charts');
    expect(button(el).tooltip).toBe('Charts');
    expect(button(el).selected).toBe(false);
    expect(panel(el)).toBeNull();
});

it('has no Charts button on a grid with nothing to group by', async () => {
    getGridConfig.mockResolvedValue({
        definition: { ...DEFINITION, columns: COLUMNS.map(c => ({ ...c, groupable: false })) },
        diagnostics: false
    });
    const el = mount();
    await settle();
    expect(button(el)).toBeNull();
});

it('opens a chart of the records counted by the first picklist, from the server, beside the table', async () => {
    const el = mount();
    await settle();
    await openCharts(el);
    expect(button(el).selected).toBe(true);
    expect(chartGroups).toHaveBeenCalledWith({
        configName: 'Consignments',
        searchTerm: null,
        groupBy: 'Service_Level__c',
        measure: 'count',
        measureField: null,
        filters: null,
        recordId: null,
        fromId: null,
        toId: null
    });
    expect(panel(el).chart).toEqual({
        type: 'hbar',
        measure: 'count',
        field: null,
        groupBy: 'Service_Level__c',
        unit: null
    });
    expect(panel(el).data).toEqual({ status: 'ready', groups: ANSWER.groups });
    expect($(el, '.rh-chart-row_open')).not.toBeNull();
});

it('adds up the slices of a large list, as the subtotals do', async () => {
    chartGroups
        .mockResolvedValueOnce({ groups: [ANSWER.groups[0]], boundaries: ['a00000000000045000'], tooManyGroups: false })
        .mockResolvedValueOnce({ groups: [ANSWER.groups[1]], boundaries: null, tooManyGroups: false });
    const el = mount();
    await settle();
    await openCharts(el);
    expect(lastCall(chartGroups)).toEqual(expect.objectContaining({ fromId: 'a00000000000045000', toId: null }));
    expect(panel(el).data.groups).toEqual(ANSWER.groups);
});

it('says when the chart could not be read', async () => {
    chartGroups.mockRejectedValue({ body: { message: 'Cannot group by Service_Level__c.' } });
    const el = mount();
    await settle();
    await openCharts(el);
    expect(panel(el).data).toEqual({ status: 'error', message: 'Cannot group by Service_Level__c.' });
});

it("names the grid's records in the panel", async () => {
    const el = mount();
    await settle();
    await openCharts(el);
    expect(panel(el).objectLabel).toBe('Consignments');
});

it('edits the chart in Edit chart and reads it again', async () => {
    const el = mount();
    await settle();
    await openCharts(el);
    panel(el).dispatchEvent(new CustomEvent('edit'));
    await settle();
    const dialog = $(el, 'c-grid-chart-dialog');
    expect(dialog.chart).toEqual(panel(el).chart);
    const chart = {
        type: 'vbar',
        measure: 'sum',
        field: 'Freight_Charge__c',
        groupBy: 'Ship_Date__c',
        unit: 'quarter'
    };
    dialog.dispatchEvent(new CustomEvent('save', { detail: { chart } }));
    await settle();
    expect($(el, 'c-grid-chart-dialog')).toBeNull();
    expect(panel(el).chart).toEqual(chart);
    expect(lastCall(chartGroups)).toEqual(
        expect.objectContaining({ groupBy: 'Ship_Date__c:quarter', measure: 'sum', measureField: 'Freight_Charge__c' })
    );
});

it('reads the chart again with the search, as the subtotals are', async () => {
    const el = mount();
    await settle();
    await openCharts(el);
    chartGroups.mockClear();
    const search = $(el, '.rh-search');
    search.value = 'kennebec';
    search.dispatchEvent(new CustomEvent('change', { detail: { value: 'kennebec' } }));
    jest.advanceTimersByTime(1000);
    await settle();
    expect(lastCall(chartGroups)).toEqual(expect.objectContaining({ searchTerm: 'kennebec' }));
});

it('keeps the chart with the layout, open, and opens it the next time', async () => {
    const el = mount();
    await settle();
    await openCharts(el);
    jest.advanceTimersByTime(LAYOUT_DELAY_MS);
    await settle();
    expect(keptLayout().chart).toEqual({
        type: 'hbar',
        measure: 'count',
        field: null,
        groupBy: 'Service_Level__c',
        unit: null,
        open: true
    });

    el.remove();
    getLayout.mockResolvedValue(JSON.stringify({ v: 1, chart: { ...keptLayout().chart, type: 'donut' } }));
    chartGroups.mockClear();
    const again = mount();
    await settle();
    expect(panel(again).chart.type).toBe('donut');
    expect(chartGroups).toHaveBeenCalledTimes(1);
});

it('closes from its own close button, and keeps that it is closed', async () => {
    const el = mount();
    await settle();
    await openCharts(el);
    panel(el).dispatchEvent(new CustomEvent('close'));
    await settle();
    expect(panel(el)).toBeNull();
    expect(button(el).selected).toBe(false);
    jest.advanceTimersByTime(LAYOUT_DELAY_MS);
    await settle();
    expect(keptLayout().chart.open).toBe(false);
});
