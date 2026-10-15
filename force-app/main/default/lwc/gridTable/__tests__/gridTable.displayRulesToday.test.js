/**
 * TODAY in display rules: fixed when the rules compile, and compiled again
 * when the grid hands the table a new day (a Refresh), so a grid left open
 * past midnight catches up.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text' },
    { field: 'CloseDate', label: 'Close Date', type: 'date' }
];
const ROWS = [{ Id: 'a01000000000001AAA', Name: 'Casco Bay Marine, winter contract', CloseDate: '2026-10-07' }];
const OVERDUE = {
    name: 'Overdue',
    field: 'CloseDate',
    type: 'date',
    operator: 'less_than',
    value: 'TODAY',
    style: 'text_red',
    applyTo: 'cell'
};

describe('TODAY in display rules', () => {
    let el;
    const dateCell = () => el.shadowRoot.querySelector(`td[data-row-id="${ROWS[0].Id}"][data-field="CloseDate"]`);
    const mount = async (formatToday, rows = ROWS) => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows, displayRules: [OVERDUE], formatToday };
        document.body.appendChild(el);
        await flush();
    };
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('uses the day it is given', async () => {
        await mount('2026-10-07');
        expect(dateCell().classList).not.toContain('rh-rule_text-red');
    });

    it('works the rules out again when the day moves on, with the same rules', async () => {
        await mount('2026-10-07');
        const rules = el.config.displayRules;
        el.config = { ...el.config, displayRules: rules, formatToday: '2026-10-08' };
        await flush();
        expect(dateCell().classList).toContain('rh-rule_text-red');
    });

    it('takes the day the rules are first read when none is given', async () => {
        // A date long past is overdue on any clock this suite runs on.
        await mount(null, [{ ...ROWS[0], CloseDate: '2000-01-01' }]);
        expect(dateCell().classList).toContain('rh-rule_text-red');
    });
});
