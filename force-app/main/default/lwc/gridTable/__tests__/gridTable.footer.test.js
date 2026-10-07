/**
 * Undo and Redo sit in the Save bar, beside the
 * changes they undo, and an empty list says why and offers the next step.
 * What the grid undoes, and when a list is empty, is gridView's; this is what
 * the table shows of it.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let el;
let events;
const mount = async (config, layout) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns, rows: seedRows.slice(0, 3), ...(layout ? { layout } : {}), ...config };
    events = [];
    ['undo', 'redo', 'emptyaction', 'save', 'cancel'].forEach(name =>
        el.addEventListener(name, () => events.push(name))
    );
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const DRAFT = { [seedRows[0].Id]: { Text_Field__c: 'x' } };

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('Undo and Redo in the Save bar', () => {
    it('offers them beside Save and Cancel, named for the step they take', async () => {
        await mount({
            drafts: DRAFT,
            history: { canUndo: true, canRedo: false, undoLabel: 'Undo paste of 2 cells', redoLabel: 'Redo' }
        });
        const undo = $('.rh-footer-undo');
        expect(undo.textContent.trim()).toBe('Undo');
        expect(undo.title).toBe('Undo paste of 2 cells');
        expect(undo.disabled).toBe(false);
        expect($('.rh-footer-redo').disabled).toBe(true);
        undo.click();
        expect(events).toEqual(['undo']);
        expect($('.rh-footer-summary').textContent).toBe('1 unsaved change');
    });

    it('stays after everything is undone, while there is something to redo', async () => {
        await mount({
            drafts: {},
            history: { canUndo: false, canRedo: true, undoLabel: 'Undo', redoLabel: 'Redo edit' }
        });
        expect($('.rh-footer-summary').textContent).toBe('No unsaved changes');
        expect($('.rh-footer-redo').disabled).toBe(false);
        $('.rh-footer-redo').click();
        expect(events).toEqual(['redo']);
        // Nothing to save or cancel.
        const [cancel, save] = [...el.shadowRoot.querySelectorAll('.rh-footer button')].slice(-2);
        expect(cancel.disabled).toBe(true);
        expect(save.disabled).toBe(true);
    });

    it('is not there with nothing to save or redo', async () => {
        await mount({ drafts: {}, history: { canUndo: false, canRedo: false } });
        expect($('.rh-footer-undo')).toBeNull();
    });

    it('says what is unsaved above its buttons, not beside them', async () => {
        await mount({
            drafts: DRAFT,
            history: { canUndo: true, canRedo: false, undoLabel: 'Undo', redoLabel: 'Redo' }
        });
        const bar = $('.rh-footer');
        const [summary, actions] = bar.children;
        expect(summary.classList).toContain('rh-footer-summary');
        expect(actions.classList).toContain('rh-footer-actions');
        expect(summary.querySelector('button')).toBeNull();
        const labels = [...actions.querySelectorAll('button')].map(b => b.textContent.trim());
        expect(labels).toEqual(['Undo', 'Redo', 'Cancel', 'Save']);
        // Not the full-width docked footer any more: a floating pill (see gridTable.css).
        expect(bar.classList).not.toContain('slds-docked-form-footer');
    });

    it('offers no Undo in a grid that cannot be edited', async () => {
        await mount({ drafts: DRAFT, history: null });
        expect($('.rh-footer-undo')).toBeNull();
        expect($('.rh-footer-summary')).not.toBeNull();
    });
});

describe('while the edits save', () => {
    const TWO = { [seedRows[0].Id]: { Text_Field__c: 'x' }, [seedRows[1].Id]: { Text_Field__c: 'y' } };

    it('shows a spinner and "Saving…" on Save, in its blue, and says what is being saved', async () => {
        await mount({
            drafts: TWO,
            saving: true,
            savingEdits: true,
            history: { canUndo: true, canRedo: false, undoLabel: 'Undo', redoLabel: 'Redo' }
        });
        const save = $('.rh-footer-save');
        expect(save.textContent.trim()).toBe('Saving…');
        expect(save.querySelector('.rh-save-spinner.slds-spinner_inverse').getAttribute('aria-hidden')).toBe('true');
        expect(save.disabled).toBe(false); // not greyed out
        expect(save.getAttribute('aria-disabled')).toBe('true');
        save.click();
        expect(events).toEqual([]); // and does nothing more
        expect($('.rh-footer-cancel').disabled).toBe(true);
        expect($('.rh-footer-undo').disabled).toBe(true);
        expect($('.rh-footer-summary').textContent).toBe('Saving 2 changes…');
    });

    it('says how far a save of many batches has got', async () => {
        await mount({ drafts: TWO, saving: true, savingEdits: true, saveProgress: 'Saving… 3 of 50 batches done.' });
        expect($('.rh-footer-summary').textContent).toBe('Saving… 3 of 50 batches done.');
    });

    it('greys Save out, without a spinner, while rows are deleted or an action runs', async () => {
        await mount({ drafts: TWO, saving: true, savingEdits: false });
        const save = $('.rh-footer-save');
        expect(save.textContent.trim()).toBe('Save');
        expect(save.disabled).toBe(true);
        expect(save.hasAttribute('aria-disabled')).toBe(false);
        expect($('.rh-save-spinner')).toBeNull();
        expect($('.rh-footer-summary').textContent).toBe('2 unsaved changes');
    });

    it('goes back to Save when the save is done', async () => {
        await mount({ drafts: TWO, saving: true, savingEdits: true });
        el.config = { ...el.config, saving: false, savingEdits: false };
        await flush();
        const save = $('.rh-footer-save');
        expect(save.textContent.trim()).toBe('Save');
        expect(save.disabled).toBe(false);
        expect($('.rh-save-spinner')).toBeNull();
        save.click();
        expect(events).toEqual(['save']);
    });

    it('writes counts as numbers are written elsewhere in the grid: 1,200, not 1200', async () => {
        const many = {};
        for (let i = 0; i < 1200; i++) many['a01' + String(i).padStart(15, '0')] = { Text_Field__c: 'x' };
        await mount({ drafts: many });
        expect($('.rh-footer-summary').textContent).toBe('1,200 unsaved changes');
        el.config = { ...el.config, saving: true, savingEdits: true };
        await flush();
        expect($('.rh-footer-summary').textContent).toBe('Saving 1,200 changes…');
    });
});

describe('an empty list', () => {
    const EMPTY = {
        title: 'No records match “zzz”',
        message: 'Check the spelling.',
        actionLabel: 'Clear search',
        icon: 'utility:search'
    };

    it('says why, and offers the next step', async () => {
        await mount({ rows: [], totalRows: 0, emptyState: EMPTY });
        expect($('.rh-empty').getAttribute('role')).toBe('status');
        expect($('.rh-empty-title').textContent).toBe('No records match “zzz”');
        expect($('.rh-empty').textContent).toContain('Check the spelling.');
        $('.rh-empty-action').click();
        expect(events).toEqual(['emptyaction']);
    });

    it('offers no button when there is nothing to do', async () => {
        await mount({
            rows: [],
            totalRows: 0,
            emptyState: { title: 'No records yet', message: '', actionLabel: null }
        });
        expect($('.rh-empty-title').textContent).toBe('No records yet');
        expect($('.rh-empty-action')).toBeNull();
    });

    it('says nothing while the rows are loading, or when there are rows', async () => {
        await mount({ rows: [], totalRows: -1, emptyState: EMPTY });
        expect($('.rh-empty')).toBeNull();
        el.config = { columns, rows: seedRows.slice(0, 1), totalRows: 1, emptyState: EMPTY };
        await flush();
        expect($('.rh-empty')).toBeNull();
    });

    it('says the same in cards', async () => {
        await mount({ rows: [], totalRows: 0, emptyState: EMPTY }, 'cards');
        expect($('.rh-empty-title').textContent).toBe('No records match “zzz”');
    });
});
