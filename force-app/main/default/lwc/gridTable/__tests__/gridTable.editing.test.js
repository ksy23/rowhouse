/**
 * Inline edit: the docked footer, slds-is-edited, the two-tier error model and the
 * aria-describedby wiring had no test at all.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const key = (el, k, opts = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...opts }));

describe('inline edit', () => {
    let el;
    const mount = async config => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = config;
        document.body.appendChild(el);
        await flush();
    };
    const cell = (id, field) => el.shadowRoot.querySelector(`td[data-row-id="${id}"][data-field="${field}"]`);
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('opens the editor from the edit button and reports the committed value', async () => {
        await mount({ columns, rows: seedRows });
        const target = seedRows[4];
        const handler = jest.fn();
        el.addEventListener('cellchange', handler);

        cell(target.Id, 'Text_Field__c').querySelector('button').click();
        await flush();
        const editor = el.shadowRoot.querySelector('c-cell-text[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.mode).toBe('edit');

        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: 'changed' } }));
        await flush();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual(
            expect.objectContaining({ recordId: target.Id, field: 'Text_Field__c', value: 'changed' })
        );
        // The editor closes and focus returns to the same cell (HR-13).
        expect(el.shadowRoot.querySelector('c-cell-text[data-editor]')).toBeNull();
        expect(el.shadowRoot.activeElement.dataset.rowId).toBe(target.Id);
        expect(el.shadowRoot.activeElement.dataset.field).toBe('Text_Field__c');
    });

    it('does not offer an editor for a read-only column', async () => {
        await mount({ columns, rows: seedRows });
        const button = cell(seedRows[0].Id, 'Test_Case__c').querySelector('button');
        expect(button.disabled).toBe(true); // the lock affordance, per the SLDS blueprint
        expect(cell(seedRows[0].Id, 'Test_Case__c').getAttribute('aria-readonly')).toBe('true');
    });

    it('marks a drafted cell slds-is-edited and shows the docked footer', async () => {
        const id = seedRows[2].Id;
        await mount({ columns, rows: seedRows, drafts: { [id]: { Text_Field__c: 'draft' } } });
        expect(cell(id, 'Text_Field__c').classList).toContain('slds-is-edited');
        expect(cell(id, 'Text_Field__c').textContent).toContain('draft');
        const footer = el.shadowRoot.querySelector('.rh-footer');
        expect(footer).not.toBeNull();
        expect(footer.textContent).toContain('1 unsaved change');
    });

    it('has no footer when nothing has been edited', async () => {
        await mount({ columns, rows: seedRows });
        expect(el.shadowRoot.querySelector('.rh-footer')).toBeNull();
    });

    it('fires save and cancel from the footer', async () => {
        const id = seedRows[2].Id;
        await mount({ columns, rows: seedRows, drafts: { [id]: { Text_Field__c: 'draft' } } });
        const save = jest.fn();
        const cancel = jest.fn();
        el.addEventListener('save', save);
        el.addEventListener('cancel', cancel);
        const [cancelBtn, saveBtn] = el.shadowRoot.querySelectorAll('.rh-footer button');
        saveBtn.click();
        cancelBtn.click();
        expect(save).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('marks a cell-level error slds-has-error and describes it by id', async () => {
        const id = seedRows[3].Id;
        await mount({
            columns, rows: seedRows,
            errors: { [id]: { row: null, fields: { Number_Field__c: 'Value out of range' } } }
        });
        const td = cell(id, 'Number_Field__c');
        expect(td.classList).toContain('slds-has-error');
        const describedBy = td.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        const description = el.shadowRoot.querySelector(`[id="${describedBy}"]`);
        expect(description.textContent).toContain('Value out of range');
    });

    it('shows a row-level error in an slds-cell-error status column', async () => {
        const id = seedRows[5].Id;
        await mount({ columns, rows: seedRows, errors: { [id]: { row: 'Record is locked', fields: {} } } });
        const status = el.shadowRoot.querySelector(`td[data-row-id="${id}"][data-field="__status"]`);
        expect(status.classList).toContain('slds-cell-error');
        expect(status.textContent).toContain('Record is locked');
        // Focus is keyed by field, so the extra column does not change which
        // column the first data field is.
        expect(el.shadowRoot.querySelector('th[data-field="Name"]').dataset.colIndex).toBe('2');
    });

    it('Escape from inside the editor cancels without reporting a change', async () => {
        await mount({ columns, rows: seedRows });
        const handler = jest.fn();
        el.addEventListener('cellchange', handler);
        cell(seedRows[1].Id, 'Text_Field__c').querySelector('button').click();
        await flush();
        const editor = el.shadowRoot.querySelector('c-cell-text[data-editor]');
        editor.dispatchEvent(new CustomEvent('cancel'));
        await flush();
        expect(handler).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelector('c-cell-text[data-editor]')).toBeNull();
    });

    it('Enter on a read-only cell enters action mode; its lock is not a stop', async () => {
        const named = columns.map((c, i) => (i === 0 ? { ...c, isName: true, editable: false } : c));
        await mount({ columns: named, rows: seedRows });
        const td = cell(seedRows[0].Id, 'Name');
        td.focus();
        await flush();
        key(td, 'Enter');
        await flush();
        // The name is a link to the record: action mode takes focus to it.
        const active = el.shadowRoot.activeElement;
        expect(active.tagName).toBe('A');
        expect(active.getAttribute('href')).toBe(`/lightning/r/${seedRows[0].Id}/view`);
    });
});

describe('starting an edit, as a spreadsheet does', () => {
    let el;
    const mount = async config => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = config;
        document.body.appendChild(el);
        await flush();
    };
    const cell = (id, field) => el.shadowRoot.querySelector(`td[data-row-id="${id}"][data-field="${field}"]`);
    const focusCell = async (id, field) => {
        const td = cell(id, field);
        td.focus();
        await flush();
        return td;
    };
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('Enter on an editable cell opens its editor', async () => {
        await mount({ columns, rows: seedRows });
        const td = await focusCell(seedRows[0].Id, 'Text_Field__c');
        key(td, 'Enter');
        await flush();
        const editor = el.shadowRoot.querySelector('c-cell-text[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.seed).toBeUndefined(); // the value is kept, not replaced
    });

    it('F2 opens the editor too', async () => {
        await mount({ columns, rows: seedRows });
        const td = await focusCell(seedRows[0].Id, 'Number_Field__c');
        key(td, 'F2');
        await flush();
        expect(el.shadowRoot.querySelector('c-cell-number[data-editor]')).not.toBeNull();
    });

    it('typing a character starts editing with what was typed', async () => {
        await mount({ columns, rows: seedRows });
        const td = await focusCell(seedRows[0].Id, 'Text_Field__c');
        key(td, 'q');
        await flush();
        expect(el.shadowRoot.querySelector('c-cell-text[data-editor]').seed).toBe('q');
    });

    it('typing on a picklist or a date opens its editor without a seed', async () => {
        await mount({ columns, rows: seedRows });
        const td = await focusCell(seedRows[0].Id, 'Date_Field__c');
        key(td, '2');
        await flush();
        const editor = el.shadowRoot.querySelector('c-cell-date[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.seed).toBeUndefined();
    });

    it('typing on a read-only cell does nothing', async () => {
        await mount({ columns, rows: seedRows });
        const td = await focusCell(seedRows[0].Id, 'Test_Case__c');
        key(td, 'q');
        await flush();
        expect(el.shadowRoot.querySelector('[data-editor]')).toBeNull();
    });

    it('a shortcut with Ctrl or Cmd is not typing', async () => {
        await mount({ columns, rows: seedRows });
        const td = await focusCell(seedRows[0].Id, 'Text_Field__c');
        key(td, 'q', { metaKey: true });
        key(td, 'q', { ctrlKey: true });
        await flush();
        expect(el.shadowRoot.querySelector('[data-editor]')).toBeNull();
    });

    it('a double-click on an editable cell opens its editor', async () => {
        await mount({ columns, rows: seedRows });
        const td = cell(seedRows[1].Id, 'Text_Field__c');
        td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
        await flush();
        expect(el.shadowRoot.querySelector('c-cell-text[data-editor]')).not.toBeNull();
    });

    it('a double-click on a read-only cell does nothing', async () => {
        await mount({ columns, rows: seedRows });
        const td = cell(seedRows[1].Id, 'Test_Case__c');
        td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
        await flush();
        expect(el.shadowRoot.querySelector('[data-editor]')).toBeNull();
    });

    it('keeps the editor open, with its message, when a required value is left blank', async () => {
        const required = columns.map(c => (c.field === 'Text_Field__c' ? { ...c, required: true } : c));
        const row = { Id: 'a00000000000000999', Name: 'Sparse', Text_Field__c: null };
        await mount({ columns: required, rows: [row] });
        const handler = jest.fn();
        el.addEventListener('cellchange', handler);
        cell(row.Id, 'Text_Field__c').querySelector('button').click();
        await flush();
        const editor = el.shadowRoot.querySelector('c-cell-text[data-editor]');
        expect(editor.required).toBe(true);
        // Focus leaves the editor for the page: the blank value is refused.
        editor.parentElement.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: document.body }));
        await flush();
        expect(handler).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelector('c-cell-text[data-editor]')).toBe(editor);
        expect(editor.shadowRoot.querySelector('[role="alert"]').textContent).toBe('Complete this field.');
    });
});
