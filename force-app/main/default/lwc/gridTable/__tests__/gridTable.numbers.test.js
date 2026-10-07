/**
 * Numbers align right: number, currency and percent
 * values sit against the right edge of the cell, and so does the header label,
 * so digits line up (GOV.UK Design System, "Numbers in a table").
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let el;
const mount = async config => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = config;
    document.body.appendChild(el);
    await flush();
};
const row = seedRows.find(r => r.Number_Field__c !== null && r.Number_Field__c !== undefined);
const cell = field => el.shadowRoot.querySelector(`td[data-row-id="${row.Id}"][data-field="${field}"]`);
const header = field => el.shadowRoot.querySelector(`th[data-field="${field}"]`);

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('numbers align right', () => {
    it.each(['Number_Field__c', 'Currency_Field__c'])('%s: the value fills the cell and aligns right', async field => {
        await mount({ columns, rows: [row] });
        expect(cell(field).classList).toContain('slds-text-align_right');
        const text = cell(field).querySelector('.rh-cell-content > span');
        // The cell's contents are a flex row with the edit button; without
        // slds-grow the value would sit at the left whatever the alignment.
        expect(text.classList).toContain('slds-grow');
    });

    it('covers percent columns too', async () => {
        const cols = [...columns, { field: 'Percent_Field__c', label: 'Rate', type: 'percent', editable: true, sortable: true }];
        await mount({ columns: cols, rows: [{ ...row, Percent_Field__c: 12.5 }] });
        expect(cell('Percent_Field__c').classList).toContain('slds-text-align_right');
        expect(header('Percent_Field__c').querySelector('.slds-has-flexi-truncate').classList).toContain('slds-grid_align-end');
    });

    it.each(['Text_Field__c', 'Date_Field__c', 'Picklist_Field__c'])('%s stays at the left, header included', async field => {
        await mount({ columns, rows: [row] });
        expect(cell(field).classList).not.toContain('slds-text-align_right');
        expect(cell(field).classList).not.toContain('slds-text-align_center');
        expect(cell(field).querySelector('.rh-cell-content > span').classList).not.toContain('slds-grow');
        const grid = header(field).querySelector('.slds-has-flexi-truncate');
        expect(grid.classList).not.toContain('slds-grid_align-end');
        expect(grid.classList).not.toContain('slds-grid_align-center');
    });

    it('right-aligns the header label, with the sort arrow before it', async () => {
        await mount({ columns, rows: [row] });
        const grid = header('Currency_Field__c').querySelector('.slds-has-flexi-truncate');
        expect(grid.classList).toContain('slds-grid_align-end');
        // The arrow only shows on hover; before the label, it cannot push the label about.
        expect(grid.firstElementChild.classList).toContain('slds-icon_container');
        const textGrid = header('Text_Field__c').querySelector('.slds-has-flexi-truncate');
        expect(textGrid.classList).not.toContain('slds-grid_align-end');
        expect(textGrid.lastElementChild.classList).toContain('slds-icon_container');
    });

    it('right-aligns an unsortable number column header as well', async () => {
        const cols = columns.map(c => (c.field === 'Number_Field__c' ? { ...c, sortable: false } : c));
        await mount({ columns: cols, rows: [row] });
        expect(header('Number_Field__c').querySelector('.slds-th__action').classList).toContain('slds-grid_align-end');
    });

    it('puts numbers beside their labels in cards, as a record page does', async () => {
        await mount({ columns, rows: [row], layout: 'cards' });
        const card = el.shadowRoot.querySelector('li.rh-card');
        card.querySelector('.rh-card-more').click(); // every field
        await flush();
        const value = field => card.querySelector(`dd [data-field="${field}"] .rh-card-value`);
        ['Currency_Field__c', 'Number_Field__c', 'Text_Field__c'].forEach(field => {
            expect(value(field)).not.toBeNull();
            expect(value(field).classList).not.toContain('slds-grid_align-end');
        });
    });
});

/**
 * Checkboxes centre: a narrow column of ticks
 * reads as a column, as in Google Sheets and Excel. Header included.
 */
describe('checkboxes centre', () => {
    const tickRow = { ...row, Checkbox_Field__c: true };

    it('centres the tick in its cell', async () => {
        await mount({ columns, rows: [tickRow] });
        const td = cell('Checkbox_Field__c');
        expect(td.classList).toContain('slds-text-align_center');
        expect(td.classList).not.toContain('slds-text-align_right');
        const value = td.querySelector('.rh-cell-content > span');
        // Same reason as numbers: the value must fill the space before the edit button.
        expect(value.classList).toContain('slds-grow');
        expect(value.querySelector('lightning-icon')).not.toBeNull();
    });

    it('centres the tick in a read-only grid too', async () => {
        await mount({ columns: columns.map(c => ({ ...c, editable: false })), rows: [tickRow] });
        expect(cell('Checkbox_Field__c').classList).toContain('slds-text-align_center');
        expect(cell('Checkbox_Field__c').querySelector('button')).toBeNull();
    });

    it('centres the header label, with the sort arrow after it', async () => {
        await mount({ columns, rows: [tickRow] });
        const grid = header('Checkbox_Field__c').querySelector('.slds-has-flexi-truncate');
        expect(grid.classList).toContain('slds-grid_align-center');
        expect(grid.classList).not.toContain('slds-grid_align-end');
        expect(grid.lastElementChild.classList).toContain('slds-icon_container');
    });

    it('centres an unsortable checkbox header as well', async () => {
        const cols = columns.map(c => (c.field === 'Checkbox_Field__c' ? { ...c, sortable: false } : c));
        await mount({ columns: cols, rows: [tickRow] });
        expect(header('Checkbox_Field__c').querySelector('.slds-th__action').classList).toContain('slds-grid_align-center');
    });

    it('leaves the checkbox value where it was in cards, beside its label', async () => {
        await mount({ columns, rows: [tickRow], layout: 'cards' });
        el.shadowRoot.querySelector('li.rh-card .rh-card-more').click(); // every field
        await flush();
        const checkbox = el.shadowRoot.querySelector('li.rh-card [data-field="Checkbox_Field__c"] .rh-card-value');
        expect(checkbox).not.toBeNull();
        expect(checkbox.classList).not.toContain('slds-grid_align-center');
        expect(checkbox.classList).not.toContain('slds-text-align_center');
    });
});
