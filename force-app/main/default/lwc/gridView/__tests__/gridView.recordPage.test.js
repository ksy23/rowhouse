/**
 * On a record page. gridApp hands its grid the page's record; the grid
 * sends it with every request for rows and for counts and subtotals, and the
 * server shows only the records related to it when the configuration has a
 * Record Page Field. An import there fills that field in on the records it
 * creates. A child table is filtered by its parent row instead, so it sends
 * no page record.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
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

// Freight Charge has a subtotal, so every load also asks for counts and subtotals.
const DEFINITION = {
    name: 'Shipper_Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
        {
            field: 'Freight_Charge__c',
            label: 'Freight Charge',
            type: 'currency',
            editable: true,
            sortable: true,
            scale: 2,
            subtotal: 'sum'
        }
    ]
};
const RECORD = '001000000000001AAA';
const OTHER_RECORD = '001000000000002AAA';
const PARENT = { link: 'Consignments_Items', id: 'a00000000000000001', name: 'Kennebec Lumber, 12 bundles', level: 2 };

const row = i => ({
    Id: 'a00' + String(i).padStart(15, '0'),
    Name: 'Casco Bay Marine, load ' + i,
    Freight_Charge__c: i
});
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length });

// Resolve every pending promise.
const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0];

/** A grid as gridApp shows it: the record is set before it is on the page. */
function mount({ configName = 'Shipper_Consignments', recordId, parent } = {}) {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = configName;
    if (recordId !== undefined) el.recordId = recordId;
    if (parent) el.parent = parent;
    document.body.appendChild(el);
    return el;
}

const withDefinition = extra =>
    getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, ...extra }, diagnostics: false });

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    jest.useFakeTimers();
    withDefinition({});
    fetchRows.mockResolvedValue(page([row(1), row(2)]));
    summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: false });
    getLayout.mockResolvedValue(null);
    saveLayout.mockResolvedValue(true);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe("the page's record", () => {
    it('goes with every request for rows and for counts and subtotals', async () => {
        mount({ recordId: RECORD });
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledWith({
            configName: 'Shipper_Consignments',
            searchTerm: null,
            sortField: 'Name',
            sortDirection: 'asc',
            cursorLocator: null,
            cursorToken: null,
            pageSize: null,
            filters: null,
            recordId: RECORD
        });
        expect(summarizeGroups).toHaveBeenCalledWith({
            configName: 'Shipper_Consignments',
            searchTerm: null,
            grouping: [],
            fromId: null,
            toId: null,
            filters: null,
            recordId: RECORD
        });
    });

    it("goes with the user's filters too", async () => {
        const el = mount({ recordId: RECORD });
        await settle();
        const filter = { field: 'Freight_Charge__c', operator: 'greater_than', value: '5', valueTo: null };
        $(el, 'c-grid-table').dispatchEvent(new CustomEvent('filterchange', { detail: { filters: [filter] } }));
        await settle();
        expect(lastCall(fetchRows)).toMatchObject({ filters: [filter], recordId: RECORD });
        expect(lastCall(summarizeGroups)).toMatchObject({ filters: [filter], recordId: RECORD });
    });

    it('is trimmed, and is null in requests when there is none', async () => {
        let el = mount({ recordId: `  ${RECORD} ` });
        await settle();
        expect(el.recordId).toBe(RECORD);
        expect(lastCall(fetchRows).recordId).toBe(RECORD);
        el.remove();

        fetchRows.mockClear();
        el = mount();
        await settle();
        expect(el.recordId).toBe('');
        expect(lastCall(fetchRows).recordId).toBeNull();
        el.remove();

        fetchRows.mockClear();
        el = mount({ recordId: '   ' });
        await settle();
        expect(lastCall(fetchRows).recordId).toBeNull();
        el.remove();

        // Anything but text is no record.
        fetchRows.mockClear();
        el = mount({ recordId: 42 });
        await settle();
        expect(el.recordId).toBe('');
        expect(lastCall(fetchRows).recordId).toBeNull();
    });

    it('loads the grid again for another record, and not for the same one', async () => {
        const el = mount({ recordId: RECORD });
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(1);
        expect(getLayout).toHaveBeenCalledTimes(1);

        el.recordId = ` ${RECORD}  `;
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledTimes(1);

        el.recordId = OTHER_RECORD;
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(2);
        expect(lastCall(fetchRows).recordId).toBe(OTHER_RECORD);
        expect(lastCall(summarizeGroups).recordId).toBe(OTHER_RECORD);
    });

    it('does not load for the record until the grid is on the page', async () => {
        const el = createElement('c-grid-view', { is: GridView });
        el.configName = 'Shipper_Consignments';
        el.recordId = RECORD;
        await settle();
        expect(getGridConfig).not.toHaveBeenCalled();
        document.body.appendChild(el);
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(1);
        expect(fetchRows).toHaveBeenCalledTimes(1);
    });

    it('is not sent by a child table, which is filtered by its parent row instead', async () => {
        mount({ configName: 'Consignment_Items', recordId: RECORD, parent: PARENT });
        await settle();
        expect(lastCall(fetchRows)).toMatchObject({ parentLink: PARENT.link, parentId: PARENT.id, recordId: null });
        expect(lastCall(summarizeGroups)).toMatchObject({
            parentLink: PARENT.link,
            parentId: PARENT.id,
            recordId: null
        });
    });
});

describe('"Filtered" in the header', () => {
    it("is not shown for the page's record alone: a related list does not say so either", async () => {
        withDefinition({ recordPageField: 'Shipper__c' });
        const el = mount({ recordId: RECORD });
        await settle();
        expect($(el, '.rh-filtered')).toBeNull();
    });

    it('is not shown on a record page when the configuration has no Record Page Field', async () => {
        const el = mount({ recordId: RECORD });
        await settle();
        expect($(el, '.rh-filtered')).toBeNull();
    });

    it('is not shown off a record page, even with a Record Page Field', async () => {
        withDefinition({ recordPageField: 'Shipper__c' });
        const el = mount();
        await settle();
        expect($(el, '.rh-filtered')).toBeNull();
    });
});

describe('on a page the grid does not fit', () => {
    it('says why, with no empty table and no count under it', async () => {
        withDefinition({ recordPageField: 'Shipper__c' });
        fetchRows.mockRejectedValue({
            body: { message: 'This grid shows Consignments related to Account records, and this page shows Contact.' }
        });
        const el = mount({ recordId: '003000000000001AAA' });
        await settle();
        expect($(el, '.rh-load-error').textContent).toContain('this page shows Contact');
        // An empty table would say "No records yet" and offer an import, which is not why it is empty.
        expect($(el, 'c-grid-table')).toBeNull();
        expect($(el, '.rh-meta')).toBeNull();
    });
});

describe('importing on a record page', () => {
    const withImport = () => withDefinition({ allowImport: true, canCreate: true, recordPageField: 'Shipper__c' });
    const dialog = el => $(el, 'c-grid-import-dialog');

    it("hands the import dialog the page's record", async () => {
        withImport();
        const el = mount({ recordId: RECORD });
        await settle();
        $(el, '.rh-import').click();
        await settle();
        expect(dialog(el).recordId).toBe(RECORD);
        expect(dialog(el).parent).toBeFalsy();
    });

    it('hands it no record off a record page', async () => {
        withImport();
        const el = mount();
        await settle();
        $(el, '.rh-import').click();
        await settle();
        expect(dialog(el).recordId).toBeNull();
    });

    it("hands a child table's dialog its parent, and no page record", async () => {
        withImport();
        const el = mount({ configName: 'Consignment_Items', recordId: RECORD, parent: PARENT });
        await settle();
        // A child table's actions are in one menu.
        $(el, '.rh-actions-menu').dispatchEvent(new CustomEvent('select', { detail: { value: 'import' } }));
        await settle();
        expect(dialog(el).recordId).toBeNull();
        expect(dialog(el).parent).toMatchObject({ link: PARENT.link, id: PARENT.id });
    });
});
