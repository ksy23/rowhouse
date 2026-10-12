/**
 * An edit to one of several selected rows, for them all, as a list view's
 * inline edit has it: the editor's "Update N selected items" box, unchecked
 * at first, and Ctrl+Enter (Command+Enter on a Mac).
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('an edit for every selected row', () => {
    let el;
    let single;
    let bulk;
    const rows = seedRows.slice(0, 6);
    const mount = async extra => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows, selection: 'multi', bulkEdit: true, ...extra };
        single = jest.fn();
        bulk = jest.fn();
        el.addEventListener('cellchange', single);
        el.addEventListener('applyselected', bulk);
        document.body.appendChild(el);
        await flush();
    };
    const $ = selector => el.shadowRoot.querySelector(selector);
    const cell = (id, field) => $(`td[data-row-id="${id}"][data-field="${field}"]`);
    const select = async (...indexes) => {
        const boxes = [...el.shadowRoot.querySelectorAll('td[data-field="__select"] input')];
        for (const i of indexes) {
            boxes[i].click();
            // eslint-disable-next-line no-await-in-loop
            await flush();
        }
    };
    const openEditor = async (id, field) => {
        cell(id, field).querySelector('button').click();
        await flush();
        return $('c-cell-text[data-editor]');
    };
    const box = () => $('.rh-edit-bulk-check');
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('offers "Update N selected items", unchecked, under the editor of a selected row', async () => {
        await mount();
        await select(1, 2, 4);
        await openEditor(rows[2].Id, 'Consignee__c');
        expect(box()).not.toBeNull();
        expect(box().checked).toBe(false);
        expect($('.rh-edit-bulk').textContent).toContain('Update 3 selected items');
    });

    it('does not offer it on a row that is not selected, with one row selected, or where the grid says not', async () => {
        await mount();
        await select(1, 2);
        await openEditor(rows[3].Id, 'Consignee__c');
        expect(box()).toBeNull();
        document.body.firstChild.remove();

        await mount();
        await select(2);
        await openEditor(rows[2].Id, 'Consignee__c');
        expect(box()).toBeNull();
        document.body.firstChild.remove();

        await mount({ bulkEdit: false });
        await select(1, 2);
        await openEditor(rows[2].Id, 'Consignee__c');
        expect(box()).toBeNull();
    });

    it('left unchecked, the edit is for its own row only', async () => {
        await mount();
        await select(1, 2);
        const editor = await openEditor(rows[2].Id, 'Consignee__c');
        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: 'Casco Bay Marine' } }));
        await flush();
        expect(single).toHaveBeenCalledTimes(1);
        expect(bulk).not.toHaveBeenCalled();
    });

    it('checked, the edit goes to every selected row', async () => {
        await mount();
        await select(1, 2);
        await openEditor(rows[2].Id, 'Consignee__c');
        box().checked = true;
        box().dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(box().checked).toBe(true);
        $('c-cell-text[data-editor]').dispatchEvent(
            new CustomEvent('commit', { detail: { value: 'Casco Bay Marine' } })
        );
        await flush();
        expect(single).not.toHaveBeenCalled();
        expect(bulk).toHaveBeenCalledTimes(1);
        expect(bulk.mock.calls[0][0].detail).toEqual({
            recordId: rows[2].Id,
            field: 'Consignee__c',
            value: 'Casco Bay Marine'
        });
    });

    it('Ctrl+Enter sends the edit to every selected row, without the box', async () => {
        await mount();
        await select(1, 2);
        const editor = await openEditor(rows[2].Id, 'Consignee__c');
        // The editor commits on Enter; the table has read the Ctrl first, on the window.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: 'Casco Bay Marine' } }));
        await flush();
        expect(bulk).toHaveBeenCalledTimes(1);
        expect(single).not.toHaveBeenCalled();
    });

    it('Enter on the box commits, Escape cancels', async () => {
        await mount();
        await select(1, 2);
        await openEditor(rows[2].Id, 'Consignee__c');
        const commit = jest.spyOn($('c-cell-text[data-editor]'), 'commit').mockImplementation(() => true);
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(commit).toHaveBeenCalledTimes(1);
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await flush();
        expect($('c-cell-text[data-editor]')).toBeNull();
    });
});
