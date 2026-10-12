/**
 * More grouping in the table: ordering the groups by a count or a
 * subtotal, percent of total, subtotals that follow unsaved edits, and a
 * header dragged onto the Group header or the drop zone to group by it.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        sortable: true,
        groupable: true,
        options: [
            { value: 'Economy', label: 'Economy' },
            { value: 'Standard', label: 'Standard' },
            { value: 'Express', label: 'Express' }
        ]
    },
    { field: 'Region__c', label: 'Region', type: 'text', editable: true, sortable: true, groupable: true },
    {
        field: 'Freight_Charge__c',
        label: 'Freight Charge',
        type: 'currency',
        scale: 2,
        editable: true,
        sortable: true,
        subtotal: 'sum'
    }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    {
        Id: id(1),
        Name: 'Kennebec Lumber, 12 bundles',
        Service_Level__c: 'Economy',
        Region__c: 'East',
        Freight_Charge__c: '100'
    },
    {
        Id: id(2),
        Name: 'Penobscot Paper, full truck',
        Service_Level__c: 'Standard',
        Region__c: 'West',
        Freight_Charge__c: '500'
    },
    {
        Id: id(3),
        Name: 'Reefer load, Machias',
        Service_Level__c: 'Economy',
        Region__c: 'East',
        Freight_Charge__c: '50'
    },
    {
        Id: id(4),
        Name: 'Casco Bay Marine, 2 pallets',
        Service_Level__c: 'Express',
        Region__c: 'West',
        Freight_Charge__c: '25'
    }
];
const BY_STAGE = [{ field: 'Service_Level__c', unit: null }];
const SERVER_GROUPS = [
    { k: ['Economy'], l: [''], n: 2, v: { Freight_Charge__c: { s: '150' } } },
    { k: ['Standard'], l: [''], n: 1, v: { Freight_Charge__c: { s: '500' } } },
    { k: ['Express'], l: [''], n: 1, v: { Freight_Charge__c: { s: '25' } } }
];
const ready = () => ({ status: 'ready', totals: rollUp(SERVER_GROUPS, BY_STAGE, COLUMNS) });

let el;
let events;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = {
        columns: COLUMNS,
        rows: ROWS,
        totalRows: ROWS.length,
        grouping: BY_STAGE,
        groupSummary: ready(),
        ...config
    };
    events = { groupchange: [], layoutchange: [] };
    Object.keys(events).forEach(name => el.addEventListener(name, e => events[name].push(e.detail)));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const groupNames = () =>
    $$('tbody tr[data-kind="group"] .rh-group-label').map(s => s.textContent.replace('Service Level: ', ''));
const groupRow = name => {
    const match = $$('tbody tr[data-kind="group"] .rh-group-label').find(
        span => span.textContent === 'Service Level: ' + name
    );
    return match ? match.closest('tr') : null;
};
const announcement = () => $('[data-grid-root] > [aria-live="polite"]').textContent;
const openMenu = async field => {
    $(`[data-menu-button][data-field="${field}"]`).click();
    await flush();
    return $$('[role="menu"] a');
};
const choose = async (field, label) => {
    const items = await openMenu(field);
    items.find(a => a.textContent.trim() === label).click();
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe("the groups' order", () => {
    it('is by name, then by a subtotal, largest or smallest first, from the Group column menu', async () => {
        await mount();
        expect(groupNames()).toEqual(['Economy', 'Standard', 'Express']);
        await choose('__group', 'Order groups by sum of Freight Charge');
        expect(groupNames()).toEqual(['Standard', 'Economy', 'Express']);
        expect(announcement()).toBe('Groups ordered by sum of Freight Charge, largest first');
        const items = await openMenu('__group');
        const checked = items.filter(a => a.getAttribute('aria-checked') === 'true').map(a => a.textContent.trim());
        expect(checked).toEqual(['Order groups by sum of Freight Charge', 'Largest first']);
        items.find(a => a.textContent.trim() === 'Smallest first').click();
        await flush();
        expect(groupNames()).toEqual(['Express', 'Economy', 'Standard']);
    });

    it('is told to the parent with the layout, and comes back with it', async () => {
        await mount();
        await choose('__group', 'Order groups by record count');
        expect(events.layoutchange[events.layoutchange.length - 1].groupView).toEqual({
            order: { by: 'count', direction: 'desc' },
            percent: false
        });
        el.remove();
        await mount({
            userLayout: { key: 7, groupView: { order: { by: 'Freight_Charge__c', direction: 'asc' }, percent: true } }
        });
        expect(groupNames()).toEqual(['Express', 'Economy', 'Standard']);
        expect(groupRow('Economy').querySelector('.rh-group-share').textContent).toBe('50%');
    });
});

describe('percent of total', () => {
    it("shows each group's share of the records and of each sum, and says it", async () => {
        await mount();
        expect($('.rh-group-share')).toBeNull();
        await choose('__group', 'Show percent of total');
        const open = groupRow('Economy');
        expect(open.querySelector('.rh-group-share').textContent).toBe('50%');
        expect(open.querySelector('td[data-field="Freight_Charge__c"] .rh-subtotal-share').textContent).toBe('22%');
        expect(open.querySelector('.rh-group-toggle .slds-assistive-text').textContent).toBe(
            'Service Level: Economy, 2 records, 50% of all records'
        );
        expect(open.querySelector('td[data-field="Freight_Charge__c"] .slds-assistive-text').textContent).toContain(
            '22% of the total'
        );
        const item = (await openMenu('__group')).find(a => a.textContent.trim() === 'Show percent of total');
        expect(item.getAttribute('role')).toBe('menuitemcheckbox');
        expect(item.getAttribute('aria-checked')).toBe('true');
    });
});

describe('subtotals with unsaved edits', () => {
    it('follow the edit, marked as unsaved, in the group and the Total row', async () => {
        await mount({ drafts: { [id(1)]: { Freight_Charge__c: '130' } } });
        const cell = groupRow('Economy').querySelector('td[data-field="Freight_Charge__c"]');
        expect(cell.querySelector('.rh-subtotal').textContent).toContain('180.00');
        expect(cell.classList).toContain('rh-subtotal_edited');
        expect(cell.querySelector('.slds-assistive-text').textContent).toContain('with your unsaved changes');
        expect(groupRow('Standard').querySelector('td[data-field="Freight_Charge__c"]').classList).not.toContain(
            'rh-subtotal_edited'
        );
        const total = $('.rh-totals .rh-subtotal').closest('td');
        expect(total.textContent).toContain('705.00');
        expect(total.classList).toContain('rh-subtotal_edited');
    });
});

describe('dragging a header to group by it', () => {
    const drag = (target, type) => {
        const event = new CustomEvent(type, { bubbles: true, cancelable: true });
        event.dataTransfer = { setData: () => {}, effectAllowed: 'move', dropEffect: 'move' };
        event.clientX = 0;
        target.dispatchEvent(event);
        return event;
    };
    const header = field => $(`th[data-field="${field}"]`);
    const handle = field => $(`th[data-field="${field}"] [draggable="true"]`);

    it('adds it to the grouping when dropped on the Group header', async () => {
        await mount();
        drag(handle('Region__c'), 'dragstart');
        await flush();
        const over = drag(header('__group'), 'dragover');
        await flush();
        expect(over.defaultPrevented).toBe(true);
        expect(header('__group').classList).toContain('rh-drop_group');
        drag(header('__group'), 'drop');
        await flush();
        expect(events.groupchange).toEqual([
            {
                grouping: [
                    { field: 'Service_Level__c', unit: null },
                    { field: 'Region__c', unit: null }
                ]
            }
        ]);
    });

    it('shows a drop zone above the table while a groupable header is dragged, which groups by it', async () => {
        await mount({ grouping: [], groupSummary: null });
        expect($('.rh-group-zone')).toBeNull();
        drag(handle('Region__c'), 'dragstart');
        await flush();
        const zone = $('.rh-group-zone');
        expect(zone.textContent.trim()).toBe('Drop here to group by Region');
        expect(zone.getAttribute('aria-hidden')).toBe('true');
        drag(zone, 'dragover');
        await flush();
        expect($('.rh-group-zone').classList).toContain('rh-group-zone_over');
        drag($('.rh-group-zone'), 'drop');
        await flush();
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Region__c', unit: null }] }]);
        expect($('.rh-group-zone')).toBeNull();
    });

    it('shows no drop zone for a column the grid cannot group by', async () => {
        await mount({ grouping: [], groupSummary: null });
        drag(handle('Freight_Charge__c'), 'dragstart');
        await flush();
        expect($('.rh-group-zone')).toBeNull();
        drag(handle('Freight_Charge__c'), 'dragend');
    });
});
