/**
 * Grid actions in the grid: what the table and the selection bar are
 * offered, when the dialog asks first, how a server action runs in batches and
 * reports what failed, how a screen flow is handed to its own page,
 * and that the rows an action touched are read again.
 */
import { createElement } from 'lwc';
import GridView, { ACTION_BATCH, MAX_ACTION_BUTTONS } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import runAction from '@salesforce/apex/GridController.runAction';
import { CurrentPageReference } from 'lightning/navigation';
import { STORE_PREFIX, IDS_IN_URL } from 'c/gridFlowRoute';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });
jest.mock('@salesforce/apex/GridController.runAction', () => ({ default: jest.fn() }), { virtual: true });

// Lightning's navigation: where the grid sends a screen flow, and the page it is on.
const mockNavigate = jest.fn();
jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate](ref) {
                mockNavigate(ref);
            }
            [GenerateUrl]() {
                return Promise.resolve('');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const NOTE = { name: 'Add_Note', label: 'Add a note', type: 'screenflow', onRow: true, onSelection: true, confirmation: null, flowName: 'Rowhouse_Test_Screen_Flow', inputName: 'recordId' };
const SEEN = { name: 'Mark_Seen', label: 'Mark as seen', type: 'flow', onRow: true, onSelection: true, confirmation: null, flowName: null, inputName: null };
const STAMP = { name: 'Stamp', label: 'Stamp', type: 'apex', onRow: false, onSelection: true, confirmation: 'Stamp these?', flowName: null, inputName: null };
const CALL = { name: 'Log_Call', label: 'Log a call', type: 'quickaction', onRow: true, onSelection: false, confirmation: null, flowName: null, inputName: null };

const DEFINITION = {
    name: 'Test_Records',
    label: 'Test Records',
    objectApiName: 'Rowhouse_Test_Record__c',
    objectLabel: 'Rowhouse Test Records',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
        { field: 'Text_Field__c', label: 'Text', type: 'text', editable: true, sortable: true }
    ],
    actions: [NOTE, SEEN, STAMP, CALL]
};

const row = (i, extra = {}) => ({ Id: 'a00' + String(i).padStart(15, '0'), Name: 'Row ' + i, Text_Field__c: 'before', ...extra });
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length, serverMs: 5, cpuMs: 3 });

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

let toasts;
function mount() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Test_Records';
    toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    document.body.appendChild(el);
    return el;
}
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const table = el => $(el, 'c-grid-table');
const tableConfig = el => table(el).config;
const select = (el, ids) => table(el).dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: ids } }));
const rowAction = (el, action, recordId) => table(el).dispatchEvent(new CustomEvent('rowaction', { detail: { action, recordId } }));
const dialog = el => $(el, 'c-grid-action-dialog');
const answer = async (el, name) => {
    dialog(el).dispatchEvent(new CustomEvent(name));
    await settle();
};

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    fetchRowsById.mockImplementation(({ recordIds }) =>
        Promise.resolve(recordIds.map(id => ({ ...row(Number(id.slice(3))), Text_Field__c: 'after' }))));
    runAction.mockImplementation(({ recordIds }) => Promise.resolve({ succeededIds: recordIds, errors: [] }));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('what is offered where', () => {
    it('hands the table the row actions, names and labels only, the same array until the configuration changes', async () => {
        const el = mount();
        await settle();
        const first = tableConfig(el).rowActions;
        expect(first).toEqual([
            { name: 'Add_Note', label: 'Add a note' },
            { name: 'Mark_Seen', label: 'Mark as seen' },
            { name: 'Log_Call', label: 'Log a call' }
        ]);
        select(el, [row(1).Id]);
        await settle();
        expect(tableConfig(el).rowActions).toBe(first);
    });

    it('turns row selection on for a selection action, even with nothing to edit or delete', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowInlineEdit: false, columns: DEFINITION.columns.map(c => ({ ...c, editable: false })) }, diagnostics: false });
        const el = mount();
        await settle();
        expect(tableConfig(el).selection).toBe('multi');
    });

    it(`shows up to ${MAX_ACTION_BUTTONS} selection actions as buttons in the selection bar`, async () => {
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        expect($$(el, '.rh-selection-action').map(b => b.label)).toEqual(['Add a note', 'Mark as seen', 'Stamp']);
        expect($(el, '.rh-selection-actions')).toBeNull();
    });

    it('puts more selection actions in one Actions menu', async () => {
        const extra = { ...SEEN, name: 'Seen_Again', label: 'Mark again' };
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, actions: [NOTE, SEEN, STAMP, extra] }, diagnostics: false });
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        expect($$(el, '.rh-selection-action')).toHaveLength(0);
        const menu = $(el, '.rh-selection-actions');
        expect(menu.label).toBe('Actions');
        expect([...menu.querySelectorAll('lightning-menu-item')].map(m => m.label)).toEqual(['Add a note', 'Mark as seen', 'Stamp', 'Mark again']);
        menu.dispatchEvent(new CustomEvent('select', { detail: { value: 'Seen_Again' } }));
        await settle();
        expect(dialog(el).label).toBe('Mark again');
    });

    it('ignores an action the grid does not offer where it was chosen', async () => {
        const el = mount();
        await settle();
        rowAction(el, 'Stamp', row(1).Id); // selection only
        rowAction(el, 'No_Such_Action', row(1).Id);
        await settle();
        expect(dialog(el)).toBeNull();
        expect(runAction).not.toHaveBeenCalled();
    });
});

describe('a server action', () => {
    it('runs on a row at once, reads the row again, and says it is done', async () => {
        const el = mount();
        await settle();
        rowAction(el, 'Mark_Seen', row(2).Id);
        await settle();
        expect(dialog(el)).toBeNull();
        expect(runAction).toHaveBeenCalledWith({ configName: 'Test_Records', actionName: 'Mark_Seen', recordIds: [row(2).Id] });
        expect(fetchRowsById).toHaveBeenCalledWith({ configName: 'Test_Records', recordIds: [row(2).Id] });
        expect(tableConfig(el).rows.map(r => r.Text_Field__c)).toEqual(['before', 'after', 'before']);
        expect(toasts).toEqual([{ title: 'Mark as seen', message: 'Mark as seen: done on 1 record.', variant: 'success' }]);
    });

    it('asks first on a row with unsaved changes, and does nothing on Cancel', async () => {
        const el = mount();
        await settle();
        table(el).dispatchEvent(new CustomEvent('cellchange', { detail: { recordId: row(1).Id, field: 'Text_Field__c', value: 'typed', originalValue: 'before' } }));
        await settle();
        rowAction(el, 'Mark_Seen', row(1).Id);
        await settle();
        expect(dialog(el)).toMatchObject({ label: 'Mark as seen', count: 1, hasDrafts: true, names: ['Row 1'] });
        await answer(el, 'cancel');
        expect(dialog(el)).toBeNull();
        expect(runAction).not.toHaveBeenCalled();
    });

    it('asks the admin\'s question first, even on one row', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, actions: [{ ...SEEN, confirmation: 'Mark it?' }] }, diagnostics: false });
        const el = mount();
        await settle();
        rowAction(el, 'Mark_Seen', row(1).Id);
        await settle();
        expect(dialog(el)).toMatchObject({ question: 'Mark it?' });
        await answer(el, 'confirm');
        expect(runAction).toHaveBeenCalledTimes(1);
    });

    it(`asks first for a selection, then runs it ${ACTION_BATCH} records a call, one call after another`, async () => {
        const rows = Array.from({ length: ACTION_BATCH + 10 }, (_, i) => row(i + 1));
        fetchRows.mockResolvedValue(page(rows));
        const el = mount();
        await settle();
        select(el, rows.map(r => r.Id));
        await settle();
        $$(el, '.rh-selection-action').find(b => b.label === 'Stamp').click();
        await settle();
        expect(dialog(el)).toMatchObject({ label: 'Stamp', question: 'Stamp these?', count: rows.length,
            names: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Row 5'], hasDrafts: false });
        expect(runAction).not.toHaveBeenCalled();
        await answer(el, 'confirm');
        await settle();
        expect(runAction).toHaveBeenCalledTimes(2);
        expect(runAction.mock.calls[0][0].recordIds).toEqual(rows.slice(0, ACTION_BATCH).map(r => r.Id));
        expect(runAction.mock.calls[1][0].recordIds).toEqual(rows.slice(ACTION_BATCH).map(r => r.Id));
        expect(toasts[0].message).toBe(`Stamp: done on ${rows.length} records.`);
        expect(tableConfig(el).selection).toBe('multi');
        expect($(el, '.rh-selection-bar')).not.toBeNull(); // the selection stays for another action
    });

    it('marks the rows it could not run on, says so, and clears the mark when a later run succeeds', async () => {
        runAction.mockResolvedValueOnce({ succeededIds: [row(1).Id], errors: [{ recordId: row(2).Id, fieldName: null, message: 'An error occurred when executing a flow interview.' }] });
        const el = mount();
        await settle();
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        $$(el, '.rh-selection-action').find(b => b.label === 'Mark as seen').click();
        await settle();
        await answer(el, 'confirm');
        await settle();
        expect(tableConfig(el).errors[row(2).Id].row).toBe('Mark as seen: An error occurred when executing a flow interview.');
        expect(tableConfig(el).errors[row(1).Id]).toBeUndefined();
        expect(toasts[0]).toEqual({
            title: 'Mark as seen, with errors',
            message: 'Mark as seen: done on 1 record. 1 failed; see the marked row.',
            variant: 'warning'
        });
        expect(fetchRowsById.mock.calls[0][0].recordIds).toEqual([row(1).Id, row(2).Id]);

        rowAction(el, 'Mark_Seen', row(2).Id);
        await settle();
        expect(tableConfig(el).errors[row(2).Id]).toBeUndefined();
    });

    it('stops at a call the server refuses, and says why', async () => {
        const rows = Array.from({ length: ACTION_BATCH + 10 }, (_, i) => row(i + 1));
        fetchRows.mockResolvedValue(page(rows));
        runAction.mockRejectedValueOnce({ body: { message: 'You do not have permission to run Mark as seen.' } });
        const el = mount();
        await settle();
        select(el, rows.map(r => r.Id));
        await settle();
        $$(el, '.rh-selection-action').find(b => b.label === 'Mark as seen').click();
        await settle();
        await answer(el, 'confirm');
        await settle();
        expect(runAction).toHaveBeenCalledTimes(1);
        expect(toasts[0]).toEqual({
            title: 'Mark as seen',
            message: 'Mark as seen did not run: You do not have permission to run Mark as seen.',
            variant: 'error'
        });
        expect(fetchRowsById).not.toHaveBeenCalled();
    });

    it('holds editing and the selection bar while it runs', async () => {
        let finish;
        runAction.mockImplementation(({ recordIds }) => new Promise(resolve => {
            finish = () => resolve({ succeededIds: recordIds, errors: [] });
        }));
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        rowAction(el, 'Mark_Seen', row(1).Id);
        await settle();
        expect(tableConfig(el).saving).toBe(true);
        expect($$(el, '.rh-selection-action').every(b => b.disabled)).toBe(true);
        rowAction(el, 'Mark_Seen', row(2).Id); // one action at a time
        await settle();
        expect(runAction).toHaveBeenCalledTimes(1);
        finish();
        await settle();
        expect(tableConfig(el).saving).toBe(false);
    });
});

describe('a screen flow, on its own page', () => {
    const PAGE = { type: 'standard__navItemPage', attributes: { apiName: 'Rowhouse_Dev' }, state: { c__grid: 'Test_Records' } };
    const sent = () => mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1][0];
    const comeBack = async (token, extra = {}) => {
        // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
        CurrentPageReference.emit({ ...PAGE, state: { ...PAGE.state, c__flowDone: token, ...extra } });
        await settle();
    };

    beforeEach(() => {
        sessionStorage.clear();
    });

    it('goes to the flow page from a row, naming the grid, the action, the row and the way back', async () => {
        const el = mount();
        await settle();
        // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
        CurrentPageReference.emit(PAGE);
        rowAction(el, 'Add_Note', row(3).Id);
        await settle();
        expect(dialog(el)).toBeNull(); // no dialog any more
        expect(runAction).not.toHaveBeenCalled();
        const ref = sent();
        expect(ref.type).toBe('standard__component');
        expect(ref.attributes).toEqual({ componentName: 'c__rowhouseFlow' });
        expect(ref.state).toMatchObject({ c__grid: 'Test_Records', c__action: 'Add_Note', c__on: 'row', c__ids: row(3).Id });
        expect(JSON.parse(ref.state.c__back)).toEqual(PAGE);
        expect(ref.state.c__token).toMatch(/^[a-z0-9]{8,}$/);
        // The flow is the server's to name (GridController.screenFlow), never the address's.
        expect(JSON.stringify(ref)).not.toContain('Rowhouse_Test_Screen_Flow');
    });

    it('reads the row again when the flow comes back, once', async () => {
        const el = mount();
        await settle();
        // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
        CurrentPageReference.emit(PAGE);
        rowAction(el, 'Add_Note', row(3).Id);
        await settle();
        const token = sent().state.c__token;
        await comeBack('someone-else');
        expect(fetchRowsById).not.toHaveBeenCalled();
        await comeBack(token);
        expect(fetchRowsById).toHaveBeenCalledWith({ configName: 'Test_Records', recordIds: [row(3).Id] });
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toContain('Add a note');
        await comeBack(token, { c__other: 'x' });
        expect(fetchRowsById).toHaveBeenCalledTimes(1);
        expect(tableConfig(el).rows.find(r => r.Id === row(3).Id).Text_Field__c).toBe('after');
    });

    it('goes from a selection with the Ids, without asking first', async () => {
        const el = mount();
        await settle();
        // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
        CurrentPageReference.emit(PAGE);
        select(el, [row(1).Id, row(3).Id]);
        await settle();
        $$(el, '.rh-selection-action').find(b => b.label === 'Add a note').click();
        await settle();
        expect(dialog(el)).toBeNull();
        expect(sent().state).toMatchObject({ c__on: 'selection', c__ids: `${row(1).Id},${row(3).Id}` });
    });

    it(`keeps more than ${IDS_IN_URL} Ids in the tab's session storage, not in the address`, async () => {
        const many = Array.from({ length: IDS_IN_URL + 5 }, (_, i) => row(i + 1));
        fetchRows.mockResolvedValue(page(many));
        const el = mount();
        await settle();
        // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
        CurrentPageReference.emit(PAGE);
        select(el, many.map(r => r.Id));
        await settle();
        $$(el, '.rh-selection-action').find(b => b.label === 'Add a note').click();
        await settle();
        const state = sent().state;
        expect(state.c__ids).toBeUndefined();
        expect(state.c__back).toBeUndefined();
        const kept = JSON.parse(sessionStorage.getItem(STORE_PREFIX + state.c__token));
        expect(kept.ids).toEqual(many.map(r => r.Id));
        expect(kept.back).toEqual(PAGE);
    });

    it('does not leave over unsaved changes, and says why', async () => {
        const el = mount();
        await settle();
        table(el).dispatchEvent(new CustomEvent('cellchange', { detail: { recordId: row(2).Id, field: 'Text_Field__c', value: 'changed', originalValue: 'before' } }));
        await settle();
        rowAction(el, 'Add_Note', row(1).Id);
        await settle();
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(toasts).toEqual([{ title: 'Add a note', message: 'Save or cancel your changes first: Add a note opens on its own page.', variant: 'warning' }]);
    });

    it('still asks first for a server action, in the dialog', async () => {
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        $$(el, '.rh-selection-action').find(b => b.label === 'Stamp').click();
        await settle();
        expect(dialog(el)).toMatchObject({ label: 'Stamp', question: 'Stamp these?', count: 1 });
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
