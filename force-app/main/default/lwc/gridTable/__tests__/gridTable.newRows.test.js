/**
 * Rows added with the New button (config.newRows): shown first, above any
 * sort or group, saying New where a number goes, filled in where the column
 * is creatable, and selected or acted on for nothing until they are saved.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => setTimeout(resolve, 40));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, creatable: true, sortable: true, groupable: true },
    { field: 'OwnerId', label: 'Owner', type: 'text', editable: false, creatable: true },
    { field: 'Total__c', label: 'Total', type: 'number', editable: false, creatable: false }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'Cobb', OwnerId: 'Ann', Total__c: 1 },
    { Id: id(2), Name: 'Abbott', OwnerId: 'Ben', Total__c: 2 }
];
const NEW = { Id: 'rh-new-1', OwnerId: 'Me' };
const DRAFTS = { 'rh-new-1': { _new: true } };

let el;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = {
        columns: COLUMNS,
        rows: ROWS,
        newRows: [NEW],
        drafts: DRAFTS,
        totalRows: ROWS.length,
        rowNumbers: true,
        sort: [{ field: 'Name', direction: 'asc' }],
        ...config
    };
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const recordIds = () => $$('tbody tr[data-kind="record"]').map(tr => tr.dataset.rowId);
const cell = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('new rows', () => {
    it('come first, above the sorted rows, saying New where the number goes', async () => {
        await mount();
        expect(recordIds()).toEqual(['rh-new-1', id(2), id(1)]); // Abbott, Cobb sorted below
        expect(cell('rh-new-1', '__status').querySelector('.rh-row-number').textContent).toBe('New');
        expect(cell(id(2), '__status').querySelector('.rh-row-number').textContent).toBe('1');
        expect($('tbody tr[data-row-id="rh-new-1"]').className).toContain('rh-row_new');
    });

    it('are filled in where the column is creatable, whatever a saved record allows', async () => {
        await mount();
        const ownerNew = cell('rh-new-1', 'OwnerId').querySelector('button');
        const ownerSaved = cell(id(1), 'OwnerId').querySelector('button');
        expect(ownerNew.disabled).toBe(false); // the owner can be set on a new record
        expect(ownerSaved.disabled).toBe(true); // ...and not changed on a saved one
        expect(cell('rh-new-1', 'Total__c').querySelector('button').disabled).toBe(true);
        expect(cell('rh-new-1', 'Total__c').getAttribute('aria-readonly')).toBe('true');
        expect(ownerNew.getAttribute('title') || ownerNew.textContent).toContain('the new row');
    });

    it('are selected for nothing, have no actions and no related records until saved', async () => {
        await mount({
            selection: 'multi',
            rowActions: [{ name: 'Stamp', label: 'Stamp' }],
            children: [{ name: 'Kids', label: 'Kids', configName: 'Kids' }],
            childCountsFailed: true
        });
        expect(cell('rh-new-1', '__select').querySelector('input')).toBeNull();
        expect(cell(id(1), '__select').querySelector('input')).not.toBeNull();
        expect(cell('rh-new-1', '__actions').querySelector('button')).toBeNull();
        expect(cell(id(1), '__actions').querySelector('button')).not.toBeNull();
        expect(cell('rh-new-1', '__expand').querySelector('button')).toBeNull();
        expect($('tbody tr[data-row-id="rh-new-1"]').getAttribute('aria-selected')).toBeNull();
        // Select all takes the saved records only.
        const all = $('thead input[type="checkbox"]');
        all.checked = true;
        const events = [];
        el.addEventListener('selectionchange', e => events.push(e.detail.selectedIds));
        all.dispatchEvent(new CustomEvent('change'));
        all.click();
        await flush();
        expect(events.flat()).not.toContain('rh-new-1');
    });

    it('sit above the groups, at the first level', async () => {
        const grouping = [{ field: 'Name', unit: null }];
        await mount({ grouping, groupSummary: { status: 'ready', totals: rollUp([], grouping, COLUMNS) } });
        const rows = $$('tbody tr[aria-level]');
        expect(rows[0].dataset.rowId).toBe('rh-new-1');
        expect(rows[0].getAttribute('aria-level')).toBe('1');
        expect(rows[1].dataset.kind).toBe('group');
    });

    it('count in the Save bar as new records, apart from the values typed', async () => {
        await mount({ drafts: { 'rh-new-1': { _new: true, Name: 'Baker' }, [id(1)]: { Name: 'Cobb 2' } } });
        expect($('.rh-footer').textContent).toContain('1 new record, 2 unsaved changes');
        const save = [...el.shadowRoot.querySelectorAll('.rh-footer button')].find(b => b.textContent.includes('Save'));
        expect(save.disabled).toBe(false);
    });

    it('takes a paste into its creatable cells only', async () => {
        await mount();
        const events = [];
        el.addEventListener('cellschange', e => events.push(e.detail));
        cell('rh-new-1', 'Name').focus();
        cell('rh-new-1', 'Name').dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
        await flush();
        const paste = new CustomEvent('paste', { bubbles: true, composed: true });
        paste.clipboardData = { getData: () => 'Baker\tMe too\t9' };
        cell('rh-new-1', 'Name').dispatchEvent(paste);
        await flush();
        await flush();
        const changes = events.length ? events[0].changes : [];
        expect(changes.map(c => c.field)).toEqual(['Name', 'OwnerId']);
        expect(changes.every(c => c.recordId === 'rh-new-1')).toBe(true);
    });

    it('takes focus in its first cell that can be filled in, when the parent asks', async () => {
        await mount({ columns: [COLUMNS[2], COLUMNS[0], COLUMNS[1]] });
        el.config = { ...el.config, focusRow: { id: 'rh-new-1', seq: 1 } };
        await flush();
        await frame();
        expect(el.shadowRoot.activeElement).toBe(cell('rh-new-1', 'Name'));
    });

    it('show as a card first on a narrow screen, with nothing to select', async () => {
        await mount({ layout: 'cards', selection: 'multi' });
        const cards = $$('li.rh-card');
        expect(cards[0].dataset.rowId).toBe('rh-new-1');
        expect(cards[0].className).toContain('rh-card_new');
        expect(cards[0].querySelector('input[type="checkbox"]')).toBeNull();
        expect(cards[1].querySelector('input[type="checkbox"]')).not.toBeNull();
        expect(cards[0].querySelector('h3').textContent).toBe('New record');
    });
});
