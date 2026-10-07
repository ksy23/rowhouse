/**
 * Row grouping in the table: a treegrid with a header row per group,
 * the Group column with each group's toggle, name and count, subtotals under
 * their columns, the Total row, the grouping menus, and the spreadsheet keys
 * and selection leaving group rows alone.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true, sortable: true, groupable: true },
    { field: 'Close__c', label: 'Close', type: 'date', editable: true, sortable: true, groupable: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, editable: true, sortable: true, subtotal: 'sum' }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'One', Stage__c: 'Open', Close__c: '2026-01-15', Amount__c: 100 },
    { Id: id(2), Name: 'Two', Stage__c: 'Won', Close__c: '2026-02-10', Amount__c: 200 },
    { Id: id(3), Name: 'Three', Stage__c: 'Open', Close__c: '2026-04-01', Amount__c: 50 },
    { Id: id(4), Name: 'Four', Stage__c: 'Lost', Close__c: null, Amount__c: 25 },
    { Id: id(5), Name: 'Five', Stage__c: 'Won', Close__c: '2026-05-05', Amount__c: 300 },
    { Id: id(6), Name: 'Six', Stage__c: null, Close__c: null, Amount__c: 10 }
];
const BY_STAGE = [{ field: 'Stage__c', unit: null }];
// The server's answer, as Lightning delivers it: the deepest level's groups,
// keyed by API value, a blank as ''.
const SERVER_GROUPS = [
    { k: ['Lost'], l: [''], n: 1, v: { Amount__c: { s: '25' } } },
    { k: ['Open'], l: [''], n: 2, v: { Amount__c: { s: '150' } } },
    { k: ['Won'], l: [''], n: 2, v: { Amount__c: { s: '500' } } },
    { k: [''], l: [''], n: 1, v: { Amount__c: { s: '10' } } }
];
const ready = (groups = SERVER_GROUPS, levels = BY_STAGE) => ({ status: 'ready', totals: rollUp(groups, levels, COLUMNS) });

let el;
let events;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, grouping: BY_STAGE, groupSummary: ready(), ...config };
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
    const match = groupLabels().find(span => span.textContent === 'Stage: ' + label);
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
        expect(groupLabels().map(span => span.textContent))
            .toEqual(['Stage: Lost', 'Stage: Open', 'Stage: Won', 'Stage: (blank)']);
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
        expect($('th[data-field="__group"]').getAttribute('aria-label')).toBe('Grouped by Stage');
    });

    it('numbers every row, group rows included, and knows the count once every row is loaded (HR-10)', async () => {
        await mount();
        const rows = $$('tbody tr[role="row"]');
        expect(rows.map(tr => tr.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
        expect($('table').getAttribute('aria-rowcount')).toBe('11');
        await mount({ hasMore: true, totalRows: 5000 });
        // More records on the server bring groups not yet known: the count is unknown.
        expect($('table').getAttribute('aria-rowcount')).toBe('-1');
    });

    it('shows each group\'s count and subtotal, and says them in full to a screen reader', async () => {
        await mount();
        const open = groupRow('Open');
        expect(open.querySelector('.rh-group-count').textContent).toBe('(2)'); // as a related list's title shows it
        // Read once, from the toggle button: name, count, then the button's state.
        const toggle = open.querySelector('button.rh-group-toggle');
        expect(toggle.querySelector('.slds-assistive-text').textContent).toBe('Stage: Open, 2 records');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(open.querySelector('.rh-group-label').getAttribute('aria-hidden')).toBe('true');
        expect(open.querySelector('.rh-group-count').getAttribute('aria-hidden')).toBe('true');
        const amount = open.querySelector('td[data-field="Amount__c"]');
        expect(amount.querySelector('.rh-subtotal-kind').textContent).toBe('Sum');
        expect(amount.querySelector('.rh-subtotal').textContent).toBe('Sum$150.00');
        expect(amount.querySelector('.slds-assistive-text').textContent).toBe('Sum of Amount: $150.00');
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
        expect(totals.getAttribute('role')).toBeNull(); // a plain table, not part of the grid
        const cells = [...totals.querySelectorAll('td')];
        expect(cells).toHaveLength($$('thead th').length); // one per column, Group column included
        expect(cells[0].textContent).toBe('Total6 records'); // in the Group column
        expect(cells[cells.length - 1].querySelector('.slds-assistive-text').textContent).toBe('Sum of Amount: $685.00');
    });

    it('has a Total row without grouping when a column has a subtotal, labelled in the first data column', async () => {
        await mount({ grouping: [], groupSummary: ready([{ k: [], l: [], n: 6, v: { Amount__c: { s: '685' } } }], []) });
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
        const g = groupCell('Open');
        g.focus();
        await flush();
        const event = await key(g, 'Enter');
        expect(event.defaultPrevented).toBe(true);
        expect(groupRow('Open').getAttribute('aria-expanded')).toBe('false');
        expect(cell(id(1), 'Name')).toBeNull();
        expect(cell(id(3), 'Name')).toBeNull();
        expect(recordRows()).toHaveLength(4);
        expect(el.shadowRoot.activeElement).toBe(groupCell('Open'));
        expect(announcement()).toBe('Stage Open collapsed');
        expect($('table').getAttribute('aria-rowcount')).toBe('9');

        await key(groupCell('Open'), ' ');
        expect(groupRow('Open').getAttribute('aria-expanded')).toBe('true');
        expect(cell(id(1), 'Name')).not.toBeNull();
        expect(announcement()).toBe('Stage Open expanded');
    });

    it('the toggle button does the same, and focus inside a closing group moves to its header', async () => {
        await mount();
        cell(id(3), 'Name').focus();
        await flush();
        const toggle = groupRow('Open').querySelector('button.rh-group-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('tabindex')).toBe('-1'); // a control: one tab stop in the grid
        toggle.click();
        await flush();
        expect(groupRow('Open').querySelector('button.rh-group-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(el.shadowRoot.activeElement).toBe(groupCell('Open'));
    });

    it('keeps one tab stop in the grid', async () => {
        await mount();
        expect($$('table:not(.rh-totals) [tabindex="0"]')).toHaveLength(1);
    });
});

describe('the grouping menus', () => {
    it('Collapse all and Expand all, from the Group column menu', async () => {
        await mount();
        let items = await openMenu('__group');
        expect($('[role="menu"]').getAttribute('aria-label')).toBe('Grouping actions');
        expect(items.map(a => a.textContent.trim())).toEqual([
            'Expand all groups', 'Collapse all groups',
            // The groups' order and percentages.
            'Order groups by name', 'Order groups by record count', 'Order groups by sum of Amount', 'Show percent of total',
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
        const items = await openMenu('Stage__c');
        // Sorting comes first in every column's menu, then text, then grouping.
        expect(items.map(a => a.textContent.trim())).toEqual(['Sort ascending', 'Sort descending', 'Wrap text', 'Clip text', 'Group by Stage', 'Hide column']);
        expect(items[4].getAttribute('role')).toBe('menuitem');
        expect(items[4].closest('li').classList).toContain('slds-has-divider_top-space');
        await choose(items, 'Group by Stage');
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Stage__c', unit: null }] }]);
        expect(announcement()).toBe('Grouped by Stage');
        // A column that cannot be grouped has no grouping items.
        const amount = await openMenu('Amount__c');
        expect(amount.map(a => a.textContent.trim()).filter(t => /group/i.test(t))).toEqual([]);
    });

    it('once grouped, another column can be added, or group alone; the grouped column can be taken out', async () => {
        await mount();
        let items = await openMenu('Close__c');
        expect(items.map(a => a.textContent.trim())).toEqual(['Sort ascending', 'Sort descending', 'Add Close to grouping', 'Group by Close only', 'Hide column']);
        await choose(items, 'Add Close to grouping');
        // A date groups by month until the user picks another unit.
        expect(events.groupchange[0]).toEqual({ grouping: [{ field: 'Stage__c', unit: null }, { field: 'Close__c', unit: 'month' }] });

        items = await openMenu('Stage__c');
        expect(items.map(a => a.textContent.trim())).toEqual(['Sort ascending', 'Sort descending', 'Wrap text', 'Clip text', 'Stop grouping by Stage', 'Hide column']);
        await choose(items, 'Stop grouping by Stage');
        expect(events.groupchange[1]).toEqual({ grouping: [] });
    });

    it('a date level offers its units as radio items in the Group column menu', async () => {
        const levels = [{ field: 'Close__c', unit: 'month' }];
        await mount({ grouping: levels, groupSummary: null });
        expect($('th[data-field="__group"]').getAttribute('aria-label')).toBe('Grouped by Close (month)');
        const items = await openMenu('__group');
        const radios = items.filter(a => a.getAttribute('role') === 'menuitemradio' && a.textContent.trim().startsWith('Close by'));
        // Week and the fiscal periods too.
        expect(radios.map(a => [a.textContent.trim(), a.getAttribute('aria-checked')])).toEqual([
            ['Close by day', 'false'], ['Close by week', 'false'], ['Close by month', 'true'], ['Close by quarter', 'false'],
            ['Close by year', 'false'], ['Close by fiscal quarter', 'false'], ['Close by fiscal year', 'false']
        ]);
        await choose(items, 'Close by quarter');
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Close__c', unit: 'quarter' }] }]);
        expect(announcement()).toBe('Grouped by Close by quarter');
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
        cell(id(3), 'Amount__c').focus();
        await flush();
        await key(cell(id(3), 'Amount__c'), 'ArrowDown', { shiftKey: true }); // onto the Won group row
        await key(el.shadowRoot.activeElement, 'ArrowDown', { shiftKey: true }); // onto Two
        await key(el.shadowRoot.activeElement, 'Delete');
        expect(events.cellschange).toHaveLength(1);
        expect(events.cellschange[0].changes.map(c => [c.recordId, c.field, c.value])).toEqual([
            [id(3), 'Amount__c', null],
            [id(2), 'Amount__c', null]
        ]);
        expect(announcement()).toBe('Cleared 2 cells.');
    });

    it('pasting onto a group row puts nothing there', async () => {
        await mount();
        const target = groupRow('Won').querySelector('td[data-field="Name"]');
        target.focus();
        await flush();
        const event = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
        event.clipboardData = { getData: () => 'a\r\nb\r\n' };
        target.dispatchEvent(event);
        await flush();
        // Two lines from the Won row: the row itself is skipped, Two takes the second line.
        expect(events.cellschange[0].changes.map(c => [c.recordId, c.value])).toEqual([[id(2), 'b']]);
    });

    it('fill down will not start from a group row', async () => {
        await mount();
        cell(id(2), 'Name').focus(); // just below the Won group row
        await flush();
        await key(cell(id(2), 'Name'), 'd', { ctrlKey: true });
        expect(events.cellschange).toHaveLength(0);
        expect(announcement()).toBe('Fill down starts from a record, not a group.');
    });

    it('Select all takes every record, those in closed groups too, and a group row has no checkbox', async () => {
        await mount({ selection: 'multi' });
        await key((groupCell('Open').focus(), groupCell('Open')), 'Enter');
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
        const g = groupRow('Open').querySelector('td[data-field="Amount__c"]');
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
        await mount({ frozenColumns: 1 });
        await frame(); // frozen columns pin the widths
        expect($('table').style.width).not.toBe('');
        await regroup([]);
        // Unpinned: the table fills the grid again, and is pinned anew next frame.
        expect($('table').style.width).toBe('');
        await frame();
        expect($('table').style.width).not.toBe('');
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
            'Stage: Lost1 record', 'Stage: Open2 records', 'Stage: Won2 records', 'Stage: (blank)1 record'
        ]);
        expect($$('.rh-card-subtotals')[1].textContent).toBe('Sum of Amount: $150.00');
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
        const levels = [{ field: 'Stage__c', unit: null }, { field: 'Close__c', unit: 'month' }];
        await mount({ grouping: levels, groupSummary: null });
        const bar = $('.rh-group-chips');
        expect(bar.getAttribute('role')).toBe('group');
        expect($$('.rh-group-chip .slds-pill__label').map(s => s.textContent)).toEqual(['Stage', 'Close (by month)']);
        const remove = $$('.rh-group-chip button');
        expect($$('.rh-group-chip button .slds-assistive-text').map(s => s.textContent)).toEqual(['Stop grouping by Stage', 'Stop grouping by Close']);
        remove[1].click();
        await flush();
        expect(events.groupchange).toEqual([{ grouping: [{ field: 'Stage__c', unit: null }] }]);
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
        expect(th.getAttribute('aria-label')).toBe('Grouped by Stage');
        expect(th.querySelector('[title="Grouped by Stage"]')).not.toBeNull(); // the tooltip on its label
        expect(th.textContent).toContain('Group');
        expect(th.textContent).not.toContain('Grouped by Stage');
    });

    it('draws a guide line down a group\'s records, at their level', async () => {
        await mount({ grouping: [{ field: 'Stage__c', unit: null }, { field: 'Close__c', unit: 'month' }], groupSummary: null });
        const record = recordRows()[0];
        const groupTd = record.querySelector('td[data-field="__group"]');
        expect(groupTd.style.getPropertyValue('--rh-guide')).toBe(`${(2 - 1) * 24 + 18}px`);
    });
});
