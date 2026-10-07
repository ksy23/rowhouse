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
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('passes axe in its default state', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 12), ariaLabel: 'Test records' };
        document.body.appendChild(el);
        await flush();
        await expect(el).toBeAccessible();
    });

    it('passes axe with selection, drafts and errors showing', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        const id = seedRows[1].Id;
        el.config = {
            columns, rows: seedRows.slice(0, 12), ariaLabel: 'Test records', selection: 'multi',
            drafts: { [id]: { Text_Field__c: 'x' } },
            errors: { [id]: { row: 'Locked', fields: { Text_Field__c: 'Too long' } } }
        };
        document.body.appendChild(el);
        await flush();
        await expect(el).toBeAccessible();
    });
});
