/**
 * Amounts in an org with more than one currency: each cell in its record's
 * currency, by its code; the Total row in the corporate currency, saying
 * every amount was converted; and a sort on such a column left in the
 * server's order, which only the server can work out.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rollUp } from 'c/gridGroups';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const AMOUNT = {
    field: 'Amount',
    label: 'Amount',
    type: 'currency',
    scale: 2,
    editable: true,
    sortable: true,
    subtotal: 'sum',
    currencyField: 'CurrencyIsoCode',
    totalCurrency: 'USD'
};
const COLUMNS = [{ field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true }, AMOUNT];
const id = n => `006000000000000${n}AA`.slice(0, 18);
// In the server's order for Amount, ascending: by the amount converted to USD.
const ROWS = [
    { Id: id(1), Name: 'Kennebec Lumber - Quebec lane', Amount: '1000.00', CurrencyIsoCode: 'CAD' },
    { Id: id(2), Name: 'Cape Ann Seafood - Rotterdam reefer', Amount: '900.00', CurrencyIsoCode: 'EUR' },
    { Id: id(3), Name: 'Penobscot Paper - annual contract', Amount: '78250.00', CurrencyIsoCode: 'USD' }
];
const SUMMARY = {
    status: 'ready',
    totals: rollUp([{ k: [], l: [], n: 3, v: { Amount: { s: '80113.86' } } }], [], COLUMNS)
};

let el;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, groupSummary: SUMMARY, ...config };
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const amountText = rowId =>
    el.shadowRoot.querySelector(`td[data-row-id="${rowId}"][data-field="Amount"] .rh-cell-content`).textContent.trim();

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('more than one currency', () => {
    it("shows each amount in its record's currency, by its code", async () => {
        await mount();
        expect(amountText(id(1))).toContain('CAD 1,000.00');
        expect(amountText(id(2))).toContain('EUR 900.00');
        expect(amountText(id(3))).toContain('USD 78,250.00');
    });

    it('shows the Total in the corporate currency, and says every amount was converted', async () => {
        await mount();
        const cells = [...$('table.rh-totals').querySelectorAll('td')];
        const total = cells[cells.length - 1];
        expect(total.querySelector('.rh-subtotal').textContent).toContain('USD 80,113.86');
        expect(total.querySelector('.slds-assistive-text').textContent).toBe(
            'Sum of Amount: USD 80,113.86 (every amount converted to USD, the corporate currency)'
        );
    });

    it("keeps the server's order when sorted by such an amount", async () => {
        await mount({ sort: [{ field: 'Amount', direction: 'asc' }] });
        const order = [...el.shadowRoot.querySelectorAll('tbody tr[data-row-id]')].map(r => r.dataset.rowId);
        expect(order).toEqual([id(1), id(2), id(3)]);
    });
});
