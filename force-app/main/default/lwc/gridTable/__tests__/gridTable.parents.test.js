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
const ACCOUNT = '001000000000001AAA';
const ROWS = [
    { Id: 'a00000000000000001', Name: 'Path A', [INDUSTRY]: 'Banking', _parents: { [INDUSTRY]: ACCOUNT } },
    { Id: 'a00000000000000002', Name: 'Path D', [INDUSTRY]: null }
];
const SHARED = [
    ...ROWS,
    { Id: 'a00000000000000003', Name: 'Path B', [INDUSTRY]: 'Banking', _parents: { [INDUSTRY]: ACCOUNT } },
    { Id: 'a00000000000000004', Name: 'Path C', [INDUSTRY]: 'Energy', _parents: { [INDUSTRY]: '001000000000002AAA' } }
];

let el;
const mount = async (rows = ROWS, drafts = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows, drafts, totalRows: rows.length, allowInlineEdit: true };
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

    it('counts a change shown on every row of the same record once, as Save writes it', async () => {
        await mount(SHARED, {
            a00000000000000001: { [INDUSTRY]: 'Energy' },
            a00000000000000003: { [INDUSTRY]: 'Energy', Name: 'Path B2' },
            a00000000000000004: { [INDUSTRY]: 'Banking' }
        });
        // The account's industry once, the other account's once, and Path B2's name.
        expect(el.shadowRoot.querySelector('.rh-footer').textContent).toContain('3 unsaved changes');
    });
});
