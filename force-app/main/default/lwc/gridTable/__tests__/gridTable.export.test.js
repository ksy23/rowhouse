/**
 * What Export to Excel is given (exportView): the columns shown at the
 * widths drawn, wrapped or not, how many are frozen, and every loaded row in
 * the order shown, under its group's heading, every group open.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', sortable: true, wrap: true },
    { field: 'Service_Level__c', label: 'Service Level', type: 'picklist', sortable: true, groupable: true },
    {
        field: 'Freight_Charge__c',
        label: 'Freight Charge',
        type: 'currency',
        scale: 2,
        sortable: true,
        subtotal: 'sum'
    },
    { field: 'Notes__c', label: 'Notes', type: 'textarea' }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'Kennebec Lumber, 12 bundles', Service_Level__c: 'Express', Freight_Charge__c: 100 },
    { Id: id(2), Name: 'Penobscot Paper, full truck', Service_Level__c: 'Standard', Freight_Charge__c: 200 },
    { Id: id(3), Name: 'Reefer load, Machias', Service_Level__c: 'Express', Freight_Charge__c: 50 }
];
const BY_LEVEL = [{ field: 'Service_Level__c', unit: null }];
const SERVER_GROUPS = [
    { k: ['Express'], l: [''], n: 2, v: { Freight_Charge__c: { s: '150' } } },
    { k: ['Standard'], l: [''], n: 1, v: { Freight_Charge__c: { s: '200' } } }
];

let el;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, ...config };
    document.body.appendChild(el);
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('exportView', () => {
    it('gives the columns shown, in the user’s order, with their widths, wrapping and the frozen count', async () => {
        await mount({
            frozenColumns: 1,
            columnChoice: {
                order: ['Freight_Charge__c', 'Name', 'Service_Level__c', 'Notes__c'],
                hidden: ['Notes__c']
            },
            sort: [{ field: 'Freight_Charge__c', direction: 'desc' }]
        });
        const view = el.exportView();
        expect(view.columns.map(c => c.field)).toEqual(['Freight_Charge__c', 'Name', 'Service_Level__c']);
        expect(view.columns.find(c => c.field === 'Name').wrapped).toBe(true);
        expect(view.columns.find(c => c.field === 'Freight_Charge__c').wrapped).toBe(false);
        view.columns.forEach(c => expect(c.width).toBeGreaterThan(0));
        expect(view.frozen).toBe(1);
        // The rows in the order shown.
        expect(view.items.map(r => r.Id)).toEqual([id(2), id(1), id(3)]);
    });

    it('gives every group open, whatever the user folded, with its heading first', async () => {
        await mount({
            grouping: BY_LEVEL,
            groupSummary: { status: 'ready', totals: rollUp(SERVER_GROUPS, BY_LEVEL, COLUMNS) }
        });
        // Fold the Express group.
        const toggle = el.shadowRoot.querySelector('tbody tr[data-kind="group"] button');
        toggle.click();
        await flush();
        expect(el.shadowRoot.querySelectorAll('tbody tr[data-kind="record"]').length).toBe(1);
        const items = el.exportView().items;
        expect(items.map(r => (r.__group ? `${r.__group.label} (${r.__group.loaded})` : r.Id))).toEqual([
            'Express (2)',
            id(1),
            id(3),
            'Standard (1)',
            id(2)
        ]);
        expect(items[0].__group).toEqual(expect.objectContaining({ level: 1, columnLabel: 'Service Level' }));
    });
});
