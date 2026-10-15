/**
 * Conditional formatting in the table: the classes each cell takes,
 * following unsaved edits, in the table and in cards. What each rule means is
 * tested in c/gridDisplayRules; the colors were checked in Lightning Experience.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

/* global require, __dirname -- Jest runs in Node, where the test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, scale: 2 },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'Standard', label: 'Standard' },
            { value: 'Express', label: 'Express' }
        ]
    }
];
const ROWS = [
    {
        Id: 'a01000000000001AAA',
        Name: 'Kennebec Lumber, 12 bundles',
        Freight_Charge__c: '5',
        Service_Level__c: 'Standard'
    },
    {
        Id: 'a01000000000002AAA',
        Name: 'Penobscot Paper, full truck',
        Freight_Charge__c: '4999',
        Service_Level__c: 'Standard'
    },
    { Id: 'a01000000000003AAA', Name: 'Reefer load, Machias', Freight_Charge__c: '-3', Service_Level__c: 'Express' }
];
const RULES = [
    {
        name: 'Negative',
        field: 'Freight_Charge__c',
        type: 'currency',
        operator: 'less_than',
        value: '0',
        style: 'text_red',
        applyTo: 'cell'
    },
    {
        name: 'Large',
        field: 'Freight_Charge__c',
        type: 'currency',
        operator: 'greater_or_equal',
        value: '1000',
        style: 'fill_green',
        applyTo: 'cell'
    },
    {
        name: 'Express',
        field: 'Service_Level__c',
        type: 'picklist',
        operator: 'equals',
        value: 'Express',
        style: 'fill_purple',
        applyTo: 'row'
    }
];

describe('conditional formatting in the table', () => {
    let el;
    const cell = (i, field) => el.shadowRoot.querySelector(`td[data-row-id="${ROWS[i].Id}"][data-field="${field}"]`);
    const mount = async extra => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows: ROWS, displayRules: RULES, ...extra };
        document.body.appendChild(el);
        await flush();
    };
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('gives a cell rule’s class to its own column only', async () => {
        await mount();
        expect(cell(1, 'Freight_Charge__c').classList).toContain('rh-fmt_fill-green');
        expect(cell(1, 'Name').classList).not.toContain('rh-fmt_fill-green');
        expect(cell(0, 'Freight_Charge__c').className).not.toMatch(/rh-fmt_/);
    });

    it("shows a row rule's fill on the row (a tint and a bar, from the stylesheet), not as a fill on every cell", async () => {
        await mount();
        const tr = el.shadowRoot.querySelector(`tr[data-row-id="${ROWS[2].Id}"]`);
        // Purple, not blue: a blue row would look selected.
        expect(tr.classList).toContain('rh-row_bar');
        expect(tr.classList).toContain('rh-fmt_bar-purple');
        const cells = [...el.shadowRoot.querySelectorAll(`td[data-row-id="${ROWS[2].Id}"][data-field]`)];
        expect(cells.map(td => td.dataset.field)).toEqual(['Name', 'Freight_Charge__c', 'Service_Level__c']);
        cells.forEach(td => expect(td.className).not.toMatch(/rh-fmt_fill/));
        // The cell rules still show beside it.
        expect(cell(2, 'Freight_Charge__c').classList).toContain('rh-fmt_text-red');
        expect(el.shadowRoot.querySelector(`tr[data-row-id="${ROWS[0].Id}"]`).classList).not.toContain('rh-row_bar');
    });

    it("says what a format means: in the cell's title and to a screen reader", async () => {
        await mount();
        const amount = cell(2, 'Freight_Charge__c');
        expect(amount.querySelector('.slds-assistive-text').textContent).toBe(', Negative');
        expect(amount.querySelector('[title]').getAttribute('title')).toBe('-$3.00 · Negative');
        // The row's rule is said once, on the row's first data cell.
        expect(cell(2, 'Name').querySelector('.slds-assistive-text').textContent).toBe(', Express');
        const said = [...cell(2, 'Service_Level__c').querySelectorAll('.slds-assistive-text')].map(n => n.textContent);
        expect(said.filter(t => t.startsWith(', '))).toEqual([]);
    });

    it('follows an unsaved edit in the rest of the row, and leaves the edited cell showing as unsaved', async () => {
        await mount({ drafts: { [ROWS[0].Id]: { Freight_Charge__c: '2500' } } });
        // The edited cell shows as unsaved, not formatted: SLDS's yellow must not be hidden.
        expect(cell(0, 'Freight_Charge__c').classList).toContain('slds-is-edited');
        // The row tint stands aside for an unsaved cell by this class.
        expect(cell(0, 'Freight_Charge__c').classList).toContain('rh-cell_draft');
        expect(cell(0, 'Freight_Charge__c').className).not.toMatch(/rh-fmt_/);
        // A row rule met by an unsaved edit formats the rest of the row at once.
        el.config = {
            columns: COLUMNS,
            rows: ROWS,
            displayRules: RULES,
            drafts: { [ROWS[1].Id]: { Service_Level__c: 'Express' } }
        };
        await flush();
        expect(el.shadowRoot.querySelector(`tr[data-row-id="${ROWS[1].Id}"]`).classList).toContain('rh-fmt_bar-purple');
        expect(cell(1, 'Service_Level__c').classList).toContain('slds-is-edited');
        expect(cell(1, 'Service_Level__c').className).not.toMatch(/rh-fmt_/);
        // Saved, the value is the record's own and the cell takes its format.
        const saved = ROWS.map(r => (r.Id === ROWS[0].Id ? { ...r, Freight_Charge__c: '2500' } : r));
        el.config = { columns: COLUMNS, rows: saved, displayRules: RULES, drafts: {} };
        await flush();
        expect(cell(0, 'Freight_Charge__c').classList).toContain('rh-fmt_fill-green');
    });

    it('gives no format to a cell in error', async () => {
        await mount({ errors: { [ROWS[1].Id]: { row: null, fields: { Freight_Charge__c: 'Too large.' } } } });
        expect(cell(1, 'Freight_Charge__c').classList).toContain('slds-has-error');
        expect(cell(1, 'Freight_Charge__c').className).not.toMatch(/rh-fmt_/);
    });

    it('formats nothing without rules, and leaves the selection column alone', async () => {
        await mount({ displayRules: undefined });
        expect(el.shadowRoot.querySelectorAll('td[class*="rh-fmt_"]')).toHaveLength(0);
        el.config = { columns: COLUMNS, rows: ROWS, displayRules: RULES, selection: 'multi' };
        await flush();
        expect(
            el.shadowRoot.querySelector(`td[data-row-id="${ROWS[2].Id}"][data-field="__select"]`).className
        ).not.toMatch(/rh-fmt_/);
    });

    it("formats a card the same way: the row's bar down its edge, the cell rules on its values", async () => {
        await mount({ layout: 'cards' });
        const card = el.shadowRoot.querySelector(`li[data-row-id="${ROWS[2].Id}"]`);
        expect(card.classList).toContain('rh-card_bar');
        expect(card.classList).toContain('rh-fmt_bar-purple');
        const values = [...card.querySelectorAll('.rh-card-value')]; // the name is the title
        expect(values).toHaveLength(2);
        expect(values[0].classList).toContain('rh-fmt_text-red');
        values.forEach(v => expect(v.className).not.toMatch(/rh-fmt_fill/));
    });

    it('lets the selected range tint over a fill, and fills a frozen cell', () => {
        const css = fs
            .readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const at = selector => css.indexOf(selector);
        // The range tint comes after every fill, at the same specificity, so it wins.
        expect(at('.rh-grid td.rh-in-range')).toBeGreaterThan(at('.rh-grid td.rh-fmt_fill-grey'));
        // Fills are as specific as the frozen rule and after it, so a frozen cell is filled.
        expect(at('.rh-grid td.rh-fmt_fill-green')).toBeGreaterThan(at('.rh-grid td.rh-frozen'));
        // No fill rule names an SLDS class (HR-15).
        expect(css).not.toMatch(/rh-fmt_[^{]*slds-/);
    });
});
