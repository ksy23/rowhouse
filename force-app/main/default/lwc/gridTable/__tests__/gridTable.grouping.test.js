/**
 * Row grouping in the table: a treegrid with a header row per group,
 * the Group column with each group's toggle, name and count, subtotals under
 * their columns, the Total row, the grouping menus, and the spreadsheet keys
 * and selection leaving group rows alone.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

/* global require, __dirname -- Jest runs in Node, where one test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        sortable: true,
        groupable: true
    },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', editable: true, sortable: true, groupable: true },
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
        Service_Level__c: 'Express',
        Ship_Date__c: '2026-01-15',
        Freight_Charge__c: 100
    },
    {
        Id: id(2),
        Name: 'Penobscot Paper, full truck',
        Service_Level__c: 'Standard',
        Ship_Date__c: '2026-02-10',
        Freight_Charge__c: 200
    },
    {
        Id: id(3),
        Name: 'Reefer load, Machias',
        Service_Level__c: 'Express',
        Ship_Date__c: '2026-04-01',
        Freight_Charge__c: 50
    },
    {
        Id: id(4),
        Name: 'Casco Bay Marine, 2 pallets',
        Service_Level__c: 'Economy',
        Ship_Date__c: null,
        Freight_Charge__c: 25
    },
    {
        Id: id(5),
        Name: 'Green Mountain Maple, 40 cases',
        Service_Level__c: 'Standard',
        Ship_Date__c: '2026-05-05',
        Freight_Charge__c: 300
    },
    { Id: id(6), Name: 'Quabbin Supply, 6 cartons', Service_Level__c: null, Ship_Date__c: null, Freight_Charge__c: 10 }
];
const BY_STAGE = [{ field: 'Service_Level__c', unit: null }];
// The server's answer, as Lightning delivers it: the deepest level's groups,
// keyed by API value, a blank as ''.
const SERVER_GROUPS = [
    { k: ['Economy'], l: [''], n: 1, v: { Freight_Charge__c: { s: '25' } } },
    { k: ['Express'], l: [''], n: 2, v: { Freight_Charge__c: { s: '150' } } },
    { k: ['Standard'], l: [''], n: 2, v: { Freight_Charge__c: { s: '500' } } },
    { k: [''], l: [''], n: 1, v: { Freight_Charge__c: { s: '10' } } }
];
const ready = (groups = SERVER_GROUPS, levels = BY_STAGE) => ({
    status: 'ready',
    totals: rollUp(groups, levels, COLUMNS)
});

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
    events = { groupchange: [], cellschange: [], selectionchange: [] };
    Object.keys(events).forEach(name => el.addEventListener(name, e => events[name].push(e.detail)));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const groupRows = () => $$('tbody tr[data-kind="group"]');
const recordRows = () => $$('tbody tr[data-kind="record"]');
const groupLabels = () => $$('tbody tr[data-kind="group"] .rh-group-label');
const groupRow = label => {
    const match = groupLabels().find(span => span.textContent === 'Service Level: ' + label);
    return match ? match.closest('tr') : null;
};
const groupCell = label => groupRow(label).querySelector('td[data-field="__group"]');
const cell = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);
const key = async (target, k, mods = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    await flush();
    return event;
};
const announcement = () => $('[data-grid-root] > [aria-live="polite"]').textContent;
const openMenu = async field => {
    $(`[data-menu-button][data-field="${field}"]`).click();
    await flush();
    return $$('[role="menu"] a');
};
const choose = async (items, label) => {
    items.find(a => a.textContent.trim() === label).click();
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('a grouped grid', () => {
    it('is a treegrid with a header row per group, in group order, blanks last', async () => {
        await mount();
        expect($('table').getAttribute('role')).toBe('treegrid');
        expect(groupLabels().map(span => span.textContent)).toEqual([
            'Service Level: Economy',
            'Service Level: Express',
            'Service Level: Standard',
            'Service Level: (blank)'
        ]);
        groupRows().forEach(tr => {
            expect(tr.getAttribute('aria-level')).toBe('1');
            expect(tr.getAttribute('aria-expanded')).toBe('true');
        });
        recordRows().forEach(tr => {
            expect(tr.getAttribute('aria-level')).toBe('2');
            expect(tr.hasAttribute('aria-expanded')).toBe(false);
        });
        // Each group's records follow its header.
        const order = $$('tbody tr[role="row"]').map(tr => (tr.dataset.kind === 'group' ? '#' : tr.dataset.rowId));
        expect(order).toEqual(['#', id(4), '#', id(1), id(3), '#', id(2), id(5), '#', id(6)]);
        expect($('th[data-field="__group"]').getAttribute('aria-label')).toBe('Grouped by Service Level');
    });

    it("draws a line at the checkbox column's edge, so each checkbox sits centered in a column of its own", async () => {
        // Found in Lightning Experience: a record row's guide line closed a
        // wider box round the checkbox, which looked left of center.
        await mount({ selection: 'multi' });
        expect($('table').classList).toContain('rh-table_grouped');
        expect($('th[data-field="__select"]')).not.toBeNull();
        const css = fs
            .readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const rule = css.match(/\.rh-table_grouped td\[data-field=['"]__select['"]\]\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/background-position:\s*right 0/);
        await mount({ selection: 'multi', grouping: [] });
        expect($('table').classList).not.toContain('rh-table_grouped');
    });

    it('numbers every row, group rows included, and knows the count once every row is loaded (HR-10)', async () => {
        await mount();
        const rows = $$('table:not(.rh-totals) tbody tr[role="row"]');
        expect(rows.map(tr => tr.getAttribute('aria-rowindex'))).toEqual([
            '2',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
            '10',
            '11'
        ]);
        expect($('table').getAttribute('aria-rowcount')).toBe('11');
        await mount({ hasMore: true, totalRows: 5000 });
        // More records on the server bring groups not yet known: the count is unknown.
        expect($('table').getAttribute('aria-rowcount')).toBe('-1');
    });

    it("shows each group's count and subtotal, and says them in full to a screen reader", async () => {
        await mount();
        const open = groupRow('Express');
        expect(open.querySelector('.rh-group-count').textContent).toBe('(2)'); // as a related list's title shows it
        // Read once, from the toggle button: name, count, then the button's state.
        const toggle = open.querySelector('button.rh-group-toggle');
        expect(toggle.querySelector('.slds-assistive-text').textContent).toBe('Service Level: Express, 2 records');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(open.querySelector('.rh-group-label').getAttribute('aria-hidden')).toBe('true');
        expect(open.querySelector('.rh-group-count').getAttribute('aria-hidden')).toBe('true');
        const amount = open.querySelector('td[data-field="Freight_Charge__c"]');
        expect(amount.querySelector('.rh-subtotal-kind').textContent).toBe('Sum');
        expect(amount.querySelector('.rh-subtotal').textContent).toBe('Sum$150.00');
        expect(amount.querySelector('.slds-assistive-text').textContent).toBe('Sum of Freight Charge: $150.00');
        // No subtotal for the other columns, and a group row has no edit button or checkbox.
        expect(open.querySelector('td[data-field="Name"]').textContent).toBe('');
        expect(open.querySelector('button.slds-cell-edit__button')).toBeNull();
        expect(open.querySelector('input')).toBeNull();
    });

    it('shows no counts or subtotals until the server has answered', async () => {
        await mount({ groupSummary: { status: 'loading' } });
        expect(groupRows()).toHaveLength(4);
        expect($('.rh-group-count')).toBeNull();
        expect($('.rh-subtotal')).toBeNull();
        expect($('.rh-totals')).toBeNull();
    });

    it('has the Total row under the grid, each subtotal under its column', async () => {
        await mount();
        const totals = $('table.rh-totals');
        expect(totals.getAttribute('aria-label')).toMatch(/^Totals for /);
        // A read-only grid of its own, beside the grid: not one of its rows.
        expect(totals.getAttribute('role')).toBe('grid');
        expect(totals.getAttribute('aria-readonly')).toBe('true');
        const cells = [...totals.querySelectorAll('td')];
        expect(cells).toHaveLength($$('thead th').length); // one per column, Group column included
        expect(cells[0].textContent).toBe('Total6 records'); // in the Group column
        expect(cells[cells.length - 1].querySelector('.slds-assistive-text').textContent).toBe(
            'Sum of Freight Charge: $685.00'
        );
    });

    it('has a Total row without grouping when a column has a subtotal, labelled in the first data column', async () => {
        await mount({
            grouping: [],
            groupSummary: ready([{ k: [], l: [], n: 6, v: { Freight_Charge__c: { s: '685' } } }], [])
        });
        expect($('table').getAttribute('role')).toBe('grid');
        expect(groupRows()).toHaveLength(0);
        expect($('th[data-field="__group"]')).toBeNull();
        const cells = [...$('table.rh-totals').querySelectorAll('td')];
        expect(cells[0].textContent).toBe('Total6 records');
        expect(cells[3].querySelector('.rh-subtotal').textContent).toBe('Sum$685.00');
    });
});

describe('opening and closing a group', () => {
    it('Enter on the Group cell closes it: its records leave, focus stays, and it is announced', async () => {
        await mount();
        const g = groupCell('Express');
        g.focus();
        await flush();
        const event = await key(g, 'Enter');
        expect(event.defaultPrevented).toBe(true);
        expect(groupRow('Express').getAttribute('aria-expanded')).toBe('false');
        expect(cell(id(1), 'Name')).toBeNull();
        expect(cell(id(3), 'Name')).toBeNull();
        expect(recordRows()).toHaveLength(4);
        expect(el.shadowRoot.activeElement).toBe(groupCell('Express'));
        expect(announcement()).toBe('Service Level Express collapsed');
        expect($('table').getAttribute('aria-rowcount')).toBe('9');

        await key(groupCell('Express'), ' ');
        expect(groupRow('Express').getAttribute('aria-expanded')).toBe('true');
        expect(cell(id(1), 'Name')).not.toBeNull();
        expect(announcement()).toBe('Service Level Express expanded');
    });

    it('the toggle button does the same, and focus inside a closing group moves to its header', async () => {
        await mount();
        cell(id(3), 'Name').focus();
        await flush();
        const toggle = groupRow('Express').querySelector('button.rh-group-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('tabindex')).toBe('-1'); // a control: one tab stop in the grid
        toggle.click();
        await flush();
        expect(groupRow('Express').querySelector('button.rh-group-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(el.shadowRoot.activeElement).toBe(groupCell('Express'));
    });

    it('keeps one tab stop in the grid', async () => {
        await mount();
        expect($$('table:not(.rh-totals) [tabindex="0"]')).toHaveLength(1);
        expect($$('[tabindex="0"]')).toHaveLength(1); // the Total row's cells are reached with the arrow keys
    });
});

describe('the Total row with the keyboard', () => {
    const totalCell = field => $(`.rh-totals [data-total-field="${field}"]`);
    const active = () => el.shadowRoot.activeElement;

    it('Down from the last row goes to the Total row, under the same column; Up comes back', async () => {
        await mount({
            grouping: [],
            groupSummary: ready([{ k: [], l: [], n: 6, v: { Freight_Charge__c: { s: '685' } } }], [])
        });
        const last = cell(id(6), 'Freight_Charge__c');
        last.focus();
        await flush();
        await key(last, 'ArrowDown');
        expect(active()).toBe(totalCell('Freight_Charge__c'));
        expect(totalCell('Freight_Charge__c').getAttribute('tabindex')).toBe('0');
        expect($$('[tabindex="0"]')).toHaveLength(1);
        await key(active(), 'ArrowUp');
        expect(active()).toBe(cell(id(6), 'Freight_Charge__c'));
    });

    it('Left, Right, Home and End move along the Total row; Ctrl+Home goes to the first cell', async () => {
        await mount({
            grouping: [],
            groupSummary: ready([{ k: [], l: [], n: 6, v: { Freight_Charge__c: { s: '685' } } }], [])
        });
        cell(id(6), 'Ship_Date__c').focus();
        await flush();
        await key(active(), 'ArrowDown');
        expect(active()).toBe(totalCell('Ship_Date__c'));
        await key(active(), 'ArrowRight');
        expect(active()).toBe(totalCell('Freight_Charge__c'));
        await key(active(), 'Home');
        expect(active().dataset.totalField).toBe($$('.rh-totals td')[0].dataset.totalField);
        await key(active(), 'End');
        expect(active()).toBe(totalCell('Freight_Charge__c'));
        await key(active(), 'Home', { ctrlKey: true });
        expect(active().dataset.rowId).toBe(id(1));
    });

    it('typing on the Total row changes nothing', async () => {
        await mount({
            grouping: [],
            groupSummary: ready([{ k: [], l: [], n: 6, v: { Freight_Charge__c: { s: '685' } } }], [])
        });
        cell(id(6), 'Freight_Charge__c').focus();
        await flush();
        await key(active(), 'ArrowDown');
        await key(active(), '5');
        await key(active(), 'Enter');
        await key(active(), 'Delete');
        expect(events.cellschange).toEqual([]);
        expect($('c-cell-text, c-cell-number, c-cell-currency')).toBeNull();
    });

    it('stays on the last loaded row while more rows are on the server', async () => {
        await mount({
            grouping: [],
            hasMore: true,
            totalRows: 60,
            groupSummary: ready([{ k: [], l: [], n: 60, v: { Freight_Charge__c: { s: '685' } } }], [])
        });
        cell(id(6), 'Freight_Charge__c').focus();
        await flush();
        await key(active(), 'ArrowDown');
        expect(active()).toBe(cell(id(6), 'Freight_Charge__c'));
    });
});

describe('the grouping menus', () => {
    it('Collapse all and Expand all, from the Group column menu', async () => {
        await mount();
        let items = await openMenu('__group');
        expect($('[role="menu"]').getAttribute('aria-label')).toBe('Grouping actions');
        expect(items.map(a => a.textContent.trim())).toEqual([
            'Expand all groups',
            'Collapse all groups',
            // The groups' order and percentages.
            'Order groups by name',
            'Order groups by record count',
            'Order groups by sum of Freight Charge',
            'Show percent of total',
            'Stop grouping'
        ]);
        await choose(items, 'Collapse all groups');
        expect(recordRows()).toHaveLength(0);
        expect(groupRows().every(tr => tr.getAttribute('aria-expanded') === 'false')).toBe(true);
        expect(announcement()).toBe('All groups collapsed');
        items = await openMenu('__group');
        await choose(items, 'Expand all groups');
        expect(recordRows()).toHaveLength(6);
        expect(events.groupchange).toHaveLength(0); // opening and closing is the table's own
    });

    it('Stop grouping asks the parent for no grouping', async () => {
        await mount();
        await choose(await openMenu('__group'), 'Stop grouping');
        expect(events.groupchange).toEqual([{ grouping: [] }]);
        expect(announcement()).toBe('Not grouped');
    });

    it('a groupable column offers Group by; choosing it asks the parent', async () => {
        await mount({ grouping: [], groupSummary: null });
        const items = await openMenu('Service_Level__c');
        // Sorting comes first in every column's menu, then text, then grouping.
        expect(items.map(a => a.textContent.trim())).toEqual([
            'Sort ascending',
            'Sort descending',
            'Wrap text',
            'Clip text',
            'Group by Service Level',
            'Freeze up to this column',
            'Hide column'
        ]);
        expect(items[4].getAttribute('role')).toBe('menuitem');
        expect(items[4].closest('li').classList).toContain('slds-has-divider_top-space');
        await choose(items, 'Group by Service Level');
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Service_Level__c', unit: null }] }]);
        expect(announcement()).toBe('Grouped by Service Level');
        // A column that cannot be grouped has no grouping items.
        const amount = await openMenu('Freight_Charge__c');
        expect(amount.map(a => a.textContent.trim()).filter(t => /group/i.test(t))).toEqual([]);
    });

    it('once grouped, another column can be added, or group alone; the grouped column can be taken out', async () => {
        await mount();
        let items = await openMenu('Ship_Date__c');
        expect(items.map(a => a.textContent.trim())).toEqual([
            'Sort ascending',
            'Sort descending',
            'Add Ship Date to grouping',
            'Group by Ship Date only',
            'Freeze up to this column',
            'Hide column'
        ]);
        await choose(items, 'Add Ship Date to grouping');
        // A date groups by month until the user picks another unit.
        expect(events.groupchange[0]).toEqual({
            grouping: [
                { field: 'Service_Level__c', unit: null },
                { field: 'Ship_Date__c', unit: 'month' }
            ]
        });

        items = await openMenu('Service_Level__c');
        expect(items.map(a => a.textContent.trim())).toEqual([
            'Sort ascending',
            'Sort descending',
            'Wrap text',
            'Clip text',
            'Stop grouping by Service Level',
            'Freeze up to this column',
            'Hide column'
        ]);
        await choose(items, 'Stop grouping by Service Level');
        expect(events.groupchange[1]).toEqual({ grouping: [] });
    });

    it('a date level offers its units as radio items in the Group column menu', async () => {
        const levels = [{ field: 'Ship_Date__c', unit: 'month' }];
        await mount({ grouping: levels, groupSummary: null });
        expect($('th[data-field="__group"]').getAttribute('aria-label')).toBe('Grouped by Ship Date (month)');
        const items = await openMenu('__group');
        const radios = items.filter(
            a => a.getAttribute('role') === 'menuitemradio' && a.textContent.trim().startsWith('Ship Date by')
        );
        // Week and the fiscal periods too.
        expect(radios.map(a => [a.textContent.trim(), a.getAttribute('aria-checked')])).toEqual([
            ['Ship Date by day', 'false'],
            ['Ship Date by week', 'false'],
            ['Ship Date by month', 'true'],
            ['Ship Date by quarter', 'false'],
            ['Ship Date by year', 'false'],
            ['Ship Date by fiscal quarter', 'false'],
            ['Ship Date by fiscal year', 'false']
        ]);
        await choose(items, 'Ship Date by quarter');
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Ship_Date__c', unit: 'quarter' }] }]);
        expect(announcement()).toBe('Grouped by Ship Date by quarter');
    });

    it('the menus work from the keyboard', async () => {
        await mount();
        const button = $('[data-menu-button][data-field="__group"]');
        await key(button, 'ArrowUp');
        const items = $$('[role="menu"] a');
        expect(el.shadowRoot.activeElement).toBe(items[items.length - 1]); // Stop grouping
        // Up past the percentages and the three orders to Collapse all groups.
        for (let i = 0; i < 5; i++) {
            // eslint-disable-next-line no-await-in-loop
            await key(el.shadowRoot.activeElement, 'ArrowUp');
        }
        expect(el.shadowRoot.activeElement.textContent.trim()).toBe('Collapse all groups');
        await key(el.shadowRoot.activeElement, 'Enter'); // Collapse all groups
        expect(recordRows()).toHaveLength(0);
        expect(el.shadowRoot.activeElement).toBe($('[data-menu-button][data-field="__group"]'));
    });
});

describe('records only', () => {
    it('Delete over a range that crosses a group row clears the records and leaves the group row alone', async () => {
        await mount();
        cell(id(3), 'Freight_Charge__c').focus();
        await flush();
        await key(cell(id(3), 'Freight_Charge__c'), 'ArrowDown', { shiftKey: true }); // onto the Standard group row
        await key(el.shadowRoot.activeElement, 'ArrowDown', { shiftKey: true }); // onto Penobscot Paper
        await key(el.shadowRoot.activeElement, 'Delete');
        expect(events.cellschange).toHaveLength(1);
        expect(events.cellschange[0].changes.map(c => [c.recordId, c.field, c.value])).toEqual([
            [id(3), 'Freight_Charge__c', null],
            [id(2), 'Freight_Charge__c', null]
        ]);
        expect(announcement()).toBe('Cleared 2 cells.');
    });

    it('pasting onto a group row puts nothing there', async () => {
        await mount();
        const target = groupRow('Standard').querySelector('td[data-field="Name"]');
        target.focus();
        await flush();
        const event = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
        event.clipboardData = { getData: () => 'Kennebec Lumber, 14 bundles\r\nPenobscot Paper, half truck\r\n' };
        target.dispatchEvent(event);
        await flush();
        // Two lines from the Standard row: the row itself is skipped, Penobscot Paper takes the second line.
        expect(events.cellschange[0].changes.map(c => [c.recordId, c.value])).toEqual([
            [id(2), 'Penobscot Paper, half truck']
        ]);
    });

    it('fill down will not start from a group row', async () => {
        await mount();
        cell(id(2), 'Name').focus(); // just below the Standard group row
        await flush();
        await key(cell(id(2), 'Name'), 'd', { ctrlKey: true });
        expect(events.cellschange).toHaveLength(0);
        expect(announcement()).toBe('Fill down starts from a record, not a group.');
    });

    it('Select all takes every record, those in closed groups too, and a group row has no checkbox', async () => {
        await mount({ selection: 'multi' });
        await key((groupCell('Express').focus(), groupCell('Express')), 'Enter');
        expect($$('tbody tr[data-kind="group"] input')).toHaveLength(0);
        const all = $('th[data-field="__select"] input');
        all.checked = true;
        all.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(events.selectionchange[0].selectedIds.sort()).toEqual(ROWS.map(r => r.Id).sort());
        expect(groupRows().every(tr => !tr.hasAttribute('aria-selected'))).toBe(true);
    });

    it('Space on a group row does not select it', async () => {
        await mount({ selection: 'multi' });
        const g = groupRow('Express').querySelector('td[data-field="Freight_Charge__c"]');
        g.focus();
        await flush();
        await key(g, ' ');
        expect(events.selectionchange).toHaveLength(0);
    });
});

describe('widths', () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const regroup = async grouping => {
        el.config = { ...el.config, grouping };
        await flush();
    };

    it('measures again when the Group column comes or goes, if the widths were pinned only to freeze columns', async () => {
        // The frames are run by hand: on a busy machine jsdom's own frame
        // could land between the regroup and the check that follows it.
        const queued = new Map();
        let next = 0;
        const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
            next += 1;
            queued.set(next, cb);
            return next;
        });
        const caf = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => queued.delete(handle));
        // One frame's callbacks, then whatever they rendered; again while new
        // frames are asked for, at most 20 times.
        const runFrames = async (left = 20) => {
            if (!left || !queued.size) return;
            const due = [...queued.values()];
            queued.clear();
            due.forEach(cb => cb(performance.now()));
            await flush();
            await runFrames(left - 1);
        };
        try {
            await mount({ frozenColumns: 1 });
            await runFrames(); // frozen columns pin the widths
            expect($('table').style.width).not.toBe('');
            await regroup([]);
            // Unpinned: the table fills the grid again, and is pinned anew next frame.
            expect($('table').style.width).toBe('');
            await runFrames();
            expect($('table').style.width).not.toBe('');
        } finally {
            raf.mockRestore();
            caf.mockRestore();
        }
    });

    it('keeps the widths the user chose', async () => {
        await mount({ frozenColumns: 1 });
        await frame();
        const input = $('th[data-field="Name"] input[type="range"]');
        input.value = '300';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();
        const before = $('table').style.width;
        await regroup([]);
        expect($('table').style.width).not.toBe('');
        expect($('table').style.width).not.toBe(before); // narrower by the Group column, as a spreadsheet would be
    });
});

describe('cards', () => {
    it('show each group as a toggle with its count and subtotals', async () => {
        await mount({ layout: 'cards' });
        const toggles = $$('.rh-group-toggle');
        expect(toggles.map(b => b.textContent.trim())).toEqual([
            'Service Level: Economy1 record',
            'Service Level: Express2 records',
            'Service Level: Standard2 records',
            'Service Level: (blank)1 record'
        ]);
        expect($$('.rh-card-subtotals')[1].textContent).toBe('Sum of Freight Charge: $150.00');
        toggles[1].click();
        await flush();
        expect($$('.rh-group-toggle')[1].getAttribute('aria-expanded')).toBe('false');
        expect($$('article')).toHaveLength(4);
    });
});

describe('accessibility', () => {
    it('a grouped grid with its Total row is accessible', async () => {
        await mount({ selection: 'multi' });
        await expect(el).toBeAccessible();
    });
});

describe('grouping details', () => {
    it('says what the grid is grouped by above it, one chip per level, each removable', async () => {
        const levels = [
            { field: 'Service_Level__c', unit: null },
            { field: 'Ship_Date__c', unit: 'month' }
        ];
        await mount({ grouping: levels, groupSummary: null });
        const bar = $('.rh-group-chips');
        expect(bar.getAttribute('role')).toBe('group');
        expect($$('.rh-group-chip .slds-pill__label').map(s => s.textContent)).toEqual([
            'Service Level',
            'Ship Date (by month)'
        ]);
        const remove = $$('.rh-group-chip button');
        expect($$('.rh-group-chip button .slds-assistive-text').map(s => s.textContent)).toEqual([
            'Stop grouping by Service Level',
            'Stop grouping by Ship Date'
        ]);
        remove[1].click();
        await flush();
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Service_Level__c', unit: null }] }]);
    });

    it('stops grouping from the bar', async () => {
        await mount();
        $('.rh-group-clear').click();
        await flush();
        expect(events.groupchange).toEqual([{ grouping: [] }]);
    });

    it('has no bar when not grouped', async () => {
        await mount({ grouping: [], groupSummary: null });
        expect($('.rh-group-chips')).toBeNull();
    });

    it('heads the Group column "Group", and says the grouping in full to a screen reader', async () => {
        await mount();
        const th = $('th[data-field="__group"]');
        expect(th.getAttribute('aria-label')).toBe('Grouped by Service Level');
        expect(th.querySelector('[title="Grouped by Service Level"]')).not.toBeNull(); // the tooltip on its label
        expect(th.textContent).toContain('Group');
        expect(th.textContent).not.toContain('Grouped by Service Level');
    });

    it("draws a guide line down a group's records, at their level", async () => {
        await mount({
            grouping: [
                { field: 'Service_Level__c', unit: null },
                { field: 'Ship_Date__c', unit: 'month' }
            ],
            groupSummary: null
        });
        const record = recordRows()[0];
        const groupTd = record.querySelector('td[data-field="__group"]');
        expect(groupTd.style.getPropertyValue('--rh-guide')).toBe(`${(2 - 1) * 24 + 18}px`);
    });
});
