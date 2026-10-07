/**
 * A picklist column sorted in the browser takes the field's own order (the
 * column's options), as SOQL's ORDER BY does, not the alphabet. A value
 * no longer in the list comes after every value that is, by its text; blanks
 * come last, as everywhere. The comparison itself is tested in c/gridFormat.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const STAGES = ['Prospecting', 'Qualification', 'Negotiation', 'Closed Won', 'Closed Lost'];
const OPTIONS = STAGES.map(v => ({ value: v, label: v }));
const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true, sortable: true, options: OPTIONS },
    { field: 'Region__c', label: 'Region', type: 'text', editable: true, sortable: true }
];
const id = n => 'a01' + String(n).padStart(15, '0');
const ROWS = [
    { Id: id(1), Name: 'R1', Stage__c: 'Closed Won', Region__c: 'North' },
    { Id: id(2), Name: 'R2', Stage__c: 'Prospecting', Region__c: 'South' },
    { Id: id(3), Name: 'R3', Stage__c: null, Region__c: 'North' },
    { Id: id(4), Name: 'R4', Stage__c: 'Negotiation', Region__c: 'South' },
    { Id: id(5), Name: 'R5', Stage__c: 'Retired', Region__c: 'North' }, // no longer in the list
    { Id: id(6), Name: 'R6', Stage__c: 'Qualification', Region__c: 'North' },
    { Id: id(7), Name: 'R7', Stage__c: 'Archived', Region__c: 'South' }, // no longer in the list
    { Id: id(8), Name: 'R8', Stage__c: '', Region__c: 'South' },
    { Id: id(9), Name: 'R9', Stage__c: 'closed lost', Region__c: 'North' }, // the list's value, in other case
    { Id: id(10), Name: 'R10', Stage__c: 'Prospecting', Region__c: 'North' }
];
const names = ids => ids.map(rowId => ROWS.find(r => r.Id === rowId).Name);

let el;
let sorts;
const mount = async (extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, ...extra };
    sorts = [];
    el.addEventListener('sortchange', e => sorts.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const order = () => names($$('tbody tr[data-row-id]').map(tr => tr.dataset.rowId));
const th = field => $(`th[data-field="${field}"]`);
const sortBy = async (field, shiftKey = false) => {
    th(field)
        .querySelector('.slds-th__action')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey }));
    await flush();
};
const key = async (target, k, mods = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    await flush();
    return event;
};
const announcement = () => $('[data-grid-root] > [aria-live="polite"]').textContent;

// Ascending: the field's order (case aside), then the values no longer in the
// list by their text, then blanks; ties by record Id.
const ASCENDING = ['R2', 'R10', 'R6', 'R4', 'R1', 'R9', 'R7', 'R5', 'R3', 'R8'];

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('sorting a picklist column', () => {
    it("follows the field's order, not the alphabet", async () => {
        await mount();
        await sortBy('Stage__c');
        expect(order()).toEqual(ASCENDING);
        expect(th('Stage__c').getAttribute('aria-sort')).toBe('ascending');
        expect(announcement()).toBe('Sorted by Stage ascending');
        expect(sorts).toEqual([{ sort: [{ field: 'Stage__c', direction: 'asc' }] }]);
    });

    it("puts values no longer in the list after the list's own, by their text, and blanks last", async () => {
        await mount();
        await sortBy('Stage__c');
        const ids = order();
        const at = name => ids.indexOf(name);
        expect(at('R9')).toBeLessThan(at('R7')); // Closed Lost, the last in the list, before Archived
        expect(at('R7')).toBeLessThan(at('R5')); // Archived before Retired
        expect(ids.slice(-2)).toEqual(['R3', 'R8']); // null and '' alike
    });

    it("reverses the field's order when descending, and keeps blanks last", async () => {
        await mount();
        await sortBy('Stage__c');
        await sortBy('Stage__c');
        expect(th('Stage__c').getAttribute('aria-sort')).toBe('descending');
        // Ties keep their record Id order in either direction (TC-047/048).
        expect(order()).toEqual(['R5', 'R7', 'R9', 'R1', 'R4', 'R6', 'R2', 'R10', 'R3', 'R8']);
    });

    it('leaves a text column in alphabetical order', async () => {
        await mount();
        await sortBy('Region__c');
        expect(order().slice(0, 6)).toEqual(['R1', 'R3', 'R5', 'R6', 'R9', 'R10']); // the North rows, by Id
    });

    it("sorts by the value's place in the list, whatever its label says", async () => {
        const options = [
            { value: 'B', label: 'Alpha' },
            { value: 'A', label: 'Zulu' }
        ];
        const columns = [COLUMNS[0], { ...COLUMNS[1], options }];
        const rows = [
            { Id: id(1), Name: 'R1', Stage__c: 'A' },
            { Id: id(2), Name: 'R2', Stage__c: 'B' }
        ];
        await mount({ columns, rows });
        await sortBy('Stage__c');
        expect(order()).toEqual(['R2', 'R1']); // B is first in the list
    });

    it('sorts alphabetically when the column has no list of values', async () => {
        const columns = [COLUMNS[0], { ...COLUMNS[1], options: undefined }];
        await mount({ columns });
        await sortBy('Stage__c');
        // Archived, closed lost, Closed Won, Negotiation, ... (case aside), blanks last.
        expect(order()).toEqual(['R7', 'R9', 'R1', 'R4', 'R2', 'R10', 'R6', 'R5', 'R3', 'R8']);
    });

    it('follows a new order when the parent hands over new columns', async () => {
        await mount();
        await sortBy('Stage__c');
        const reversed = COLUMNS.map(c => (c.field === 'Stage__c' ? { ...c, options: OPTIONS.slice().reverse() } : c));
        el.config = { ...el.config, columns: reversed };
        await flush();
        expect(order()).toEqual(['R9', 'R1', 'R4', 'R6', 'R2', 'R10', 'R7', 'R5', 'R3', 'R8']);
    });

    it("orders ties in another column by the field's order, as a second key", async () => {
        await mount();
        await sortBy('Region__c');
        await sortBy('Stage__c', true);
        expect(order()).toEqual(['R10', 'R6', 'R1', 'R9', 'R5', 'R3', 'R2', 'R4', 'R7', 'R8']);
    });

    it('applies the sort a saved layout starts with', async () => {
        await mount({ userLayout: { key: 'k1', sort: [{ field: 'Stage__c', direction: 'asc' }] } });
        expect(order()).toEqual(ASCENDING);
    });
});

describe('from the keyboard and the column menu', () => {
    it("Space on the header sorts in the field's order", async () => {
        await mount();
        const header = th('Stage__c');
        header.focus();
        await flush();
        await key(header, ' ');
        expect(order()).toEqual(ASCENDING);
    });

    it('Sort descending in the column menu, chosen from the keyboard', async () => {
        await mount();
        const button = $('[data-menu-button][data-field="Stage__c"]');
        await key(button, 'ArrowDown');
        const items = $$('[role="menu"] [role="menuitemradio"]');
        await key(items[0], 'ArrowDown');
        expect(el.shadowRoot.activeElement.textContent.trim()).toBe('Sort descending');
        await key(el.shadowRoot.activeElement, 'Enter');
        expect(sorts).toEqual([{ sort: [{ field: 'Stage__c', direction: 'desc' }] }]);
        expect(order().slice(3, 8)).toEqual(['R1', 'R4', 'R6', 'R2', 'R10']); // Closed Won back to Prospecting
    });
});
