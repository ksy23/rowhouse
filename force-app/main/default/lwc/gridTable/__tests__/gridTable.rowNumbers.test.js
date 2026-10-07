/**
 * Row numbers down the left edge, as a list view shows them: 1, 2, 3 in the
 * order shown, in SLDS's row-number/error column. A row with errors shows
 * its error button in place of its number. Grouped, the numbers run straight
 * through the groups, and a collapsed group keeps its rows' numbers.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', sortable: true, groupable: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, sortable: true, subtotal: 'sum' }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'Cobb', Stage__c: 'Open', Amount__c: 100 },
    { Id: id(2), Name: 'Abbott', Stage__c: 'Won', Amount__c: 200 },
    { Id: id(3), Name: 'Bishop', Stage__c: 'Open', Amount__c: 50 },
    { Id: id(4), Name: 'Dunbar', Stage__c: 'Lost', Amount__c: 25 }
];
const BY_STAGE = [{ field: 'Stage__c', unit: null }];

let el;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, rowNumbers: true, ...config };
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const statusHeader = () => $('thead th[data-field="__status"]');
const statusCell = rowId => $(`td[data-row-id="${rowId}"][data-field="__status"]`);
const numberOf = rowId => {
    const span = statusCell(rowId).querySelector('.rh-row-number');
    return span ? span.textContent : null;
};
// One query for every shown record's number (HR-21), in the order shown.
const numberSpans = () => $$('tbody tr[data-kind="record"] td[data-field="__status"] .rh-row-number');
const shownNumbers = () => numberSpans().map(span => span.textContent);
const numbersById = () =>
    Object.fromEntries(numberSpans().map(span => [span.closest('tr').dataset.rowId, span.textContent]));
const shownIds = () => $$('tbody tr[data-kind="record"]').map(tr => tr.dataset.rowId);

describe('row numbers', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('numbers the rows 1, 2, 3 in the first column, headed Row number', async () => {
        await mount();
        expect(statusHeader()).not.toBeNull();
        expect(statusHeader().getAttribute('aria-colindex')).toBe('1');
        expect(statusHeader().querySelector('.slds-assistive-text').textContent).toBe('Row number');
        expect(shownNumbers()).toEqual(['1', '2', '3', '4']);
        // A number, not a hidden error button and "No errors".
        expect(statusCell(id(1)).querySelector('button')).toBeNull();
        expect(statusCell(id(1)).textContent).toBe('1');
        // The data columns move one along.
        expect($(`td[data-row-id="${id(1)}"][data-field="Name"]`).getAttribute('aria-colindex')).toBe('2');
    });

    it('numbers by place, not by record: sorting renumbers from the top', async () => {
        await mount({ sort: [{ field: 'Name', direction: 'asc' }] });
        // Abbott, Bishop, Cobb, Dunbar.
        expect(shownIds()).toEqual([id(2), id(3), id(1), id(4)]);
        expect(shownNumbers()).toEqual(['1', '2', '3', '4']);
        expect(numberOf(id(2))).toBe('1');
        expect(numberOf(id(1))).toBe('3');
    });

    it('shows the error button in place of the number on a row with errors, naming the row by number', async () => {
        await mount({ errors: { [id(3)]: { row: 'Amount is required.', fields: {} } } });
        expect(numberOf(id(3))).toBeNull();
        const button = statusCell(id(3)).querySelector('button');
        expect(button.className).not.toContain('slds-hidden');
        expect(button.getAttribute('title')).toBe('Row 3 has errors: Amount is required.');
        expect(statusCell(id(3)).querySelector('.slds-assistive-text').textContent).toBe(
            'Row 3 has errors: Amount is required.'
        );
        expect(numberOf(id(4))).toBe('4');
    });

    it('keeps SLDS width, and widens for six-digit numbers', async () => {
        await mount();
        expect(statusHeader().getAttribute('style')).toContain('width:60px');
        const many = Array.from({ length: 100000 }, (_, i) => ({ Id: 'r' + i, Name: 'Row ' + i }));
        el.config = { ...el.config, rows: many, totalRows: many.length };
        await flush();
        expect(statusHeader().getAttribute('style')).toContain('width:68px');
    });

    it('has no row-number column when the grid hides them, and the error column only for errors', async () => {
        await mount({ rowNumbers: false });
        expect(statusHeader()).toBeNull();
        expect($(`td[data-row-id="${id(1)}"][data-field="Name"]`).getAttribute('aria-colindex')).toBe('1');
        el.config = { ...el.config, errors: { [id(1)]: { row: 'Name is required.', fields: {} } } };
        await flush();
        expect(statusHeader().querySelector('.slds-assistive-text').textContent).toBe('Row status');
        expect(statusCell(id(2)).querySelector('.rh-row-number')).toBeNull();
        expect(statusCell(id(2)).querySelector('.slds-assistive-text').textContent).toBe('No errors');
    });

    it('runs straight through the groups, and a collapsed group keeps its rows numbered', async () => {
        await mount({
            grouping: BY_STAGE,
            groupSummary: { status: 'ready', totals: rollUp([], BY_STAGE, COLUMNS) }
        });
        expect(shownNumbers()).toEqual(['1', '2', '3', '4']);
        const before = numbersById();
        expect(Object.keys(before)).toHaveLength(4);
        // No numbers on the group rows.
        expect($$('tbody tr[data-kind="group"] .rh-row-number')).toHaveLength(0);

        // Collapse the first group: the rows after it keep their numbers.
        $('tbody tr[data-kind="group"] button.rh-group-toggle').click();
        await flush();
        const after = numbersById();
        expect(Object.keys(after).length).toBeLessThan(4);
        Object.keys(after).forEach(rowId => expect(after[rowId]).toBe(before[rowId]));
        expect(Object.values(after)).not.toContain('1');
    });
});
