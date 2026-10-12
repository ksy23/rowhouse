/**
 * Row actions: the last column holds a menu button on each record row;
 * its menu lists the grid's row actions and says which was chosen, on which
 * record (rowaction). The parent runs it. One menu is open at a time; the
 * keys are the header menus' (Enter, Space or Alt+Down open it, arrows move,
 * Enter chooses, Escape closes); a group's row has none; cards have the same
 * menu as a lightning-button-menu.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

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
    }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'Kennebec Lumber, 12 bundles', Service_Level__c: 'Express' },
    { Id: id(2), Name: 'Penobscot Paper, full truck', Service_Level__c: 'Standard' },
    { Id: id(3), Name: 'Reefer load, Machias', Service_Level__c: 'Express' }
];
const ACTIONS = [
    { name: 'Add_Note', label: 'Add a note' },
    { name: 'Mark_Seen', label: 'Mark as seen' },
    { name: 'Log_Call', label: 'Log a call' }
];

let el;
let chosen;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, rowActions: ACTIONS, ...config };
    chosen = [];
    el.addEventListener('rowaction', e => chosen.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const button = rowId => $(`[data-row-menu-button][data-row-id="${rowId}"]`);
const items = rowId => $$(`[role="menuitem"][data-row-id="${rowId}"]`);
const cell = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);
const key = async (target, k, mods = {}) => {
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods })
    );
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('the Actions column', () => {
    it('is not there when the grid has no row actions', async () => {
        await mount({ rowActions: [] });
        expect($('th[data-field="__actions"]')).toBeNull();
        expect($('td[data-field="__actions"]')).toBeNull();
        expect($('table').getAttribute('aria-colcount')).toBe('2');
    });

    it('comes last, with a header named for screen readers and a labelled button on each record', async () => {
        await mount();
        expect($('table').getAttribute('aria-colcount')).toBe('3');
        const th = $('th[data-field="__actions"]');
        expect(th.getAttribute('aria-colindex')).toBe('3');
        expect(th.textContent.trim()).toBe('Actions');
        const headers = $$('thead th').map(h => h.dataset.field);
        expect(headers[headers.length - 1]).toBe('__actions');
        ROWS.forEach(r => {
            expect(cell(r.Id, '__actions').getAttribute('aria-colindex')).toBe('3');
            const b = button(r.Id);
            expect(b.getAttribute('aria-haspopup')).toBe('true');
            expect(b.getAttribute('aria-expanded')).toBe('false');
            expect(b.textContent.trim()).toBe(`Actions for ${r.Name}`);
        });
        expect(items(ROWS[0].Id)).toHaveLength(0);
    });

    it('keeps the grid one tab stop: the button is reachable only in actionable mode', async () => {
        await mount();
        expect(button(ROWS[0].Id).getAttribute('tabindex')).toBe('-1');
    });

    it('is disabled while the grid saves', async () => {
        await mount({ saving: true });
        expect(button(ROWS[0].Id).disabled).toBe(true);
    });
});

describe("a row's menu", () => {
    it('opens on a click with the actions in order, focus on the first', async () => {
        await mount();
        button(ROWS[1].Id).click();
        await flush();
        expect(items(ROWS[1].Id).map(a => a.textContent.trim())).toEqual(['Add a note', 'Mark as seen', 'Log a call']);
        expect(button(ROWS[1].Id).getAttribute('aria-expanded')).toBe('true');
        expect(el.shadowRoot.activeElement).toBe(items(ROWS[1].Id)[0]);
        expect($(`td[data-row-id="${ROWS[1].Id}"] [role="menu"]`).getAttribute('aria-label')).toBe(
            'Actions for Penobscot Paper, full truck'
        );
    });

    it('says which action on which record, then closes and gives focus back to its button', async () => {
        await mount();
        button(ROWS[0].Id).click();
        await flush();
        items(ROWS[0].Id)[1].click();
        await flush();
        expect(chosen).toEqual([{ action: 'Mark_Seen', recordId: ROWS[0].Id }]);
        expect(items(ROWS[0].Id)).toHaveLength(0);
        expect(el.shadowRoot.activeElement).toBe(button(ROWS[0].Id));
    });

    it('is open on one row at a time', async () => {
        await mount();
        button(ROWS[0].Id).click();
        await flush();
        button(ROWS[2].Id).click();
        await flush();
        expect(items(ROWS[0].Id)).toHaveLength(0);
        expect(items(ROWS[2].Id)).toHaveLength(3);
        button(ROWS[2].Id).click(); // the same button again closes it
        await flush();
        expect(items(ROWS[2].Id)).toHaveLength(0);
    });

    it('opens from the cell with Enter, Space or Alt+Down, and works from the keyboard alone', async () => {
        await mount();
        const actions = cell(ROWS[0].Id, '__actions');
        actions.focus();
        await flush();
        await key(actions, 'Enter');
        expect(el.shadowRoot.activeElement).toBe(items(ROWS[0].Id)[0]);
        await key(el.shadowRoot.activeElement, 'ArrowDown');
        await key(el.shadowRoot.activeElement, 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(items(ROWS[0].Id)[2]);
        await key(el.shadowRoot.activeElement, 'ArrowDown'); // round to the first
        expect(el.shadowRoot.activeElement).toBe(items(ROWS[0].Id)[0]);
        await key(el.shadowRoot.activeElement, 'End');
        await key(el.shadowRoot.activeElement, 'Enter');
        expect(chosen).toEqual([{ action: 'Log_Call', recordId: ROWS[0].Id }]);

        const second = cell(ROWS[1].Id, '__actions');
        second.focus();
        await flush();
        await key(second, ' ');
        expect(items(ROWS[1].Id)).toHaveLength(3);
        await key(el.shadowRoot.activeElement, 'Escape');
        expect(items(ROWS[1].Id)).toHaveLength(0);
        expect(el.shadowRoot.activeElement).toBe(button(ROWS[1].Id));
        expect(chosen).toHaveLength(1);

        const third = cell(ROWS[2].Id, '__actions');
        third.focus();
        await flush();
        await key(third, 'ArrowDown', { altKey: true });
        expect(items(ROWS[2].Id)).toHaveLength(3);
    });

    it('opens on its last item with Up Arrow on the button', async () => {
        await mount();
        button(ROWS[0].Id).focus();
        await key(button(ROWS[0].Id), 'ArrowUp');
        expect(el.shadowRoot.activeElement).toBe(items(ROWS[0].Id)[2]);
    });

    it('does not select the row when Space opens it', async () => {
        await mount({ selection: 'multi' });
        const selections = [];
        el.addEventListener('selectionchange', e => selections.push(e.detail));
        const actions = cell(ROWS[0].Id, '__actions');
        actions.focus();
        await flush();
        await key(actions, ' ');
        expect(selections).toEqual([]);
        expect(items(ROWS[0].Id)).toHaveLength(3);
    });

    it('closes when focus leaves it', async () => {
        await mount();
        button(ROWS[0].Id).click();
        await flush();
        const menu = $(`td[data-row-id="${ROWS[0].Id}"] [role="menu"]`);
        menu.dispatchEvent(
            new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: cell(ROWS[1].Id, 'Name') })
        );
        await flush();
        expect(items(ROWS[0].Id)).toHaveLength(0);
        expect(chosen).toEqual([]);
    });

    it("leaves a group's row without a button", async () => {
        await mount({ grouping: [{ field: 'Service_Level__c', unit: null }] });
        const groupRows = $$('tbody tr[data-kind="group"]');
        expect(groupRows.length).toBeGreaterThan(0);
        // Every group's row keeps the column, so the columns line up, but has no button.
        expect($$('tbody tr[data-kind="group"] td[data-field="__actions"]')).toHaveLength(groupRows.length);
        expect($$('tbody tr[data-kind="group"] [data-row-menu-button]')).toHaveLength(0);
        expect($$('tbody tr[data-kind="record"] [data-row-menu-button]')).toHaveLength(3);
    });
});

describe('in cards', () => {
    it('gives each card the same actions, as a menu beside its title', async () => {
        await mount({ layout: 'cards' });
        const menus = $$('lightning-button-menu.rh-card-actions');
        expect(menus).toHaveLength(3);
        expect(menus[0].alternativeText).toBe('Actions for Kennebec Lumber, 12 bundles');
        const values = [...menus[0].querySelectorAll('lightning-menu-item')].map(m => m.value);
        expect(values).toEqual(['Add_Note', 'Mark_Seen', 'Log_Call']);
        menus[1].dispatchEvent(new CustomEvent('select', { detail: { value: 'Add_Note' } }));
        await flush();
        expect(chosen).toEqual([{ action: 'Add_Note', recordId: ROWS[1].Id }]);
    });

    it('has none when the grid has no row actions', async () => {
        await mount({ layout: 'cards', rowActions: [] });
        expect($$('lightning-button-menu.rh-card-actions')).toHaveLength(0);
    });
});
