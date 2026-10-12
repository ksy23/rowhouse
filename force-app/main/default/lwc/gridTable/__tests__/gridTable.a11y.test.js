/**
 * @sa11y/jest smoke test. It cannot check contrast or the ARIA descendancy
 * rules (aria-required-children / -parent) in JSDOM — those are the real-browser
 * tier's job — but it catches missing names, bad roles and duplicate ids.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('accessibility smoke', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('passes axe in its default state', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 12), ariaLabel: 'Consignments' };
        document.body.appendChild(el);
        await flush();
        await expect(el).toBeAccessible();
    });

    it('passes axe with selection, drafts and errors showing', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        const id = seedRows[1].Id;
        el.config = {
            columns,
            rows: seedRows.slice(0, 12),
            ariaLabel: 'Consignments',
            selection: 'multi',
            drafts: { [id]: { Consignee__c: 'Casco Bay Marine' } },
            errors: {
                [id]: { row: 'This record is locked.', fields: { Consignee__c: 'Consignee: data value too large' } }
            }
        };
        document.body.appendChild(el);
        await flush();
        await expect(el).toBeAccessible();
    });

    it('passes axe with row numbers, and a row whose number gives way to its errors', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        const id = seedRows[2].Id;
        el.config = {
            columns,
            rows: seedRows.slice(0, 12),
            ariaLabel: 'Consignments',
            rowNumbers: true,
            selection: 'multi',
            errors: { [id]: { row: 'This record is locked.', fields: {} } }
        };
        document.body.appendChild(el);
        await flush();
        await expect(el).toBeAccessible();
    });
});
