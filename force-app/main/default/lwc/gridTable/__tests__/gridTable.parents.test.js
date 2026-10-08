/**
 * A column of a parent record's field: edited on rows that have that parent,
 * read only on a row whose lookup is blank, since there is no record to
 * change it on.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const INDUSTRY = 'Lookup_Field__r.Industry';
const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true },
    { field: INDUSTRY, label: 'Industry', type: 'text', editable: true, isPath: true }
];
const ROWS = [
    { Id: 'a00000000000000001', Name: 'Path A', [INDUSTRY]: 'Banking', _parents: { [INDUSTRY]: '001000000000001AAA' } },
    { Id: 'a00000000000000002', Name: 'Path D', [INDUSTRY]: null }
];

let el;
const mount = async () => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, drafts: {}, totalRows: ROWS.length, allowInlineEdit: true };
    document.body.appendChild(el);
    await flush();
};
const cell = (rowId, field) => el.shadowRoot.querySelector(`td[data-row-id="${rowId}"][data-field="${field}"]`);

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('a parent record’s field', () => {
    it('is editable where the row has that parent, and read only where it has none', async () => {
        await mount();
        expect(cell(ROWS[0].Id, INDUSTRY).getAttribute('aria-readonly')).not.toBe('true');
        expect(cell(ROWS[1].Id, INDUSTRY).getAttribute('aria-readonly')).toBe('true');
        expect(cell(ROWS[1].Id, 'Name').getAttribute('aria-readonly')).not.toBe('true');
    });
});
