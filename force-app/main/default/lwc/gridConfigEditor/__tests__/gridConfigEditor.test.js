/**
 * The grid settings editor: reading a grid, editing its lists, the
 * check after each change, saving through a deploy and waiting for it, a new
 * grid, and closing with and without unsaved changes.
 */
import { createElement } from 'lwc';
import GridConfigEditor, { CHECK_DELAY_MS, SAVE_TIMEOUT_MS } from 'c/gridConfigEditor';
import readConfig from '@salesforce/apex/GridAdminController.readConfig';
import listObjects from '@salesforce/apex/GridAdminController.listObjects';
import describeObject from '@salesforce/apex/GridAdminController.describeObject';
import checkDraft from '@salesforce/apex/GridAdminController.checkDraft';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import canSave from '@salesforce/apex/GridAdminController.canSave';

jest.mock('@salesforce/apex/GridAdminController.readConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.listObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.describeObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.checkDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });

const mockGenerateUrl = jest.fn(ref => Promise.resolve('/generated?' + JSON.stringify(ref.state)));
jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate]() {}
            [GenerateUrl](ref) {
                return mockGenerateUrl(ref);
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const FIELDS = [
    { name: 'Name', label: 'Name', type: 'text', sortable: true, groupable: true, editable: true, isName: true, subtotals: ['count'] },
    { name: 'Amount__c', label: 'Amount', type: 'currency', sortable: true, groupable: false, editable: true, isName: false, subtotals: ['sum', 'average', 'min', 'max', 'count'] },
    { name: 'Close__c', label: 'Close Date', type: 'date', sortable: true, groupable: true, editable: true, isName: false, subtotals: ['min', 'max', 'count'] },
    { name: 'Score__c', label: 'Score', type: 'number', sortable: true, groupable: false, editable: false, isName: false, subtotals: ['sum'] }
];
const DESCRIBED = {
    name: 'Deal__c',
    label: 'Deal',
    labelPlural: 'Deals',
    fields: FIELDS,
    children: [{ config: 'Deal_Notes', label: 'Deal Notes', fields: ['Deal__c', 'Other_Deal__c'] }]
};
const DRAFT = {
    config: { name: 'Deals', label: 'Deals', isNew: false, objectApiName: 'Deal__c', sortField: 'Name', sortDirection: 'asc', allowInlineEdit: true, allowCsvExport: true },
    columns: [
        { name: 'Deals_Name', field: 'Name', columnLabel: null, editable: true, sortable: true, inactive: false },
        { name: 'Deals_Amount', field: 'Amount__c', columnLabel: 'Value', editable: true, sortable: true, subtotal: 'sum', inactive: false },
        { name: 'Deals_Old', field: 'Score__c', columnLabel: null, editable: false, sortable: true, inactive: true }
    ],
    rules: [{ name: 'Deals_Big', label: 'Big', field: 'Amount__c', operator: 'greater_than', value: '1000', style: 'fill_green', applyTo: 'row', active: true }],
    actions: [],
    children: [{ name: 'Deals_Notes', childConfig: 'Deal_Notes', relationshipField: 'Deal__c', tabLabel: 'Notes', inactive: false }]
};

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const change = (target, value) => {
    if (typeof value === 'boolean') target.checked = value;
    target.dispatchEvent(new CustomEvent('change', { detail: { value, checked: value } }));
};
const click = target => target.dispatchEvent(new CustomEvent('click'));
const lastDraft = () => JSON.parse(checkDraft.mock.calls[checkDraft.mock.calls.length - 1][0].draftJson);

let events;
async function mount(configName = 'Deals') {
    const el = createElement('c-grid-config-editor', { is: GridConfigEditor });
    el.configName = configName;
    events = [];
    ['saved', 'close', 'lightning__showtoast'].forEach(type => el.addEventListener(type, e => events.push({ type, detail: e.detail })));
    document.body.appendChild(el);
    await settle();
    return el;
}
const afterCheck = async () => {
    jest.advanceTimersByTime(CHECK_DELAY_MS);
    await settle();
};

beforeEach(() => {
    jest.useFakeTimers();
    readConfig.mockResolvedValue({ draft: DRAFT, warnings: ['Grid Column Deals_Old: something'], canSave: true });
    describeObject.mockResolvedValue(DESCRIBED);
    listObjects.mockResolvedValue([{ name: 'Account', label: 'Account' }, { name: 'Deal__c', label: 'Deal' }]);
    canSave.mockResolvedValue(true);
    checkDraft.mockResolvedValue({ errors: [], warnings: [] });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('reading a grid', () => {
    it('shows its settings, its entries in order, and what the grid leaves out', async () => {
        const el = await mount();
        expect(readConfig).toHaveBeenCalledWith({ configName: 'Deals' });
        expect(describeObject).toHaveBeenCalledWith({ objectApiName: 'Deal__c' });
        expect($(el, '.rh-config-label').value).toBe('Deals');
        expect($(el, '.rh-config-name').disabled).toBe(true);
        expect($(el, '.rh-config-object-text').value).toBe('Deals (Deal__c)');
        expect($$(el, '.rh-column-field').map(c => c.value)).toEqual(['Name', 'Amount__c', 'Score__c']);
        expect($$(el, '.rh-column-on').map(t => t.checked)).toEqual([true, true, false]);
        expect($(el, '.rh-editor-warnings').textContent).toContain('Deals_Old');
        const tabs = $$(el, 'lightning-tab').map(t => t.label);
        expect(tabs).toEqual(['Grid', 'Columns (2)', 'Display rules (1)', 'Filters (0)', 'Actions (0)', 'Child tables (1)']);
    });

    it('lets a field be edited or sorted only where it can be', async () => {
        const el = await mount();
        const editable = $$(el, '.rh-column-editable');
        expect(editable.map(c => c.disabled)).toEqual([false, false, true]);
        const subtotal = $$(el, '.rh-column-subtotal');
        expect(subtotal[1].options.map(o => o.value)).toEqual(['', 'sum', 'average', 'min', 'max', 'count']);
        expect($$(el, '.rh-column-group')[1].disabled).toBe(true);
    });

    it('offers only saved-entry switches, and a remove button for an entry not saved yet', async () => {
        const el = await mount();
        expect($$(el, '.rh-column-remove')).toHaveLength(0);
        click($(el, '.rh-add-column'));
        await settle();
        expect($$(el, '.rh-column-field')).toHaveLength(4);
        expect($$(el, '.rh-column-remove')).toHaveLength(1);
        click($(el, '.rh-column-remove'));
        await settle();
        expect($$(el, '.rh-column-field')).toHaveLength(3);
    });

    it('says when saving is not allowed, and keeps Save off', async () => {
        readConfig.mockResolvedValue({ draft: DRAFT, warnings: [], canSave: false });
        const el = await mount();
        expect($(el, '.rh-editor-read-only')).not.toBeNull();
        change($(el, '.rh-config-label'), 'Deals 2');
        await afterCheck();
        expect($(el, '.rh-editor-save').disabled).toBe(true);
    });

    it('says what went wrong when the grid cannot be read', async () => {
        readConfig.mockRejectedValue({ body: { message: 'This needs the Rowhouse Grid Admin permission set.' } });
        const el = await mount();
        expect($(el, '.rh-editor-load-error').textContent).toContain('Rowhouse Grid Admin');
    });
});

describe('editing', () => {
    it('checks the draft a moment after a change, with the grid\'s own code', async () => {
        const el = await mount();
        expect($(el, '.rh-editor-save').disabled).toBe(true); // nothing changed yet
        change($$(el, '.rh-column-label')[0], 'Deal');
        await settle();
        expect(checkDraft).not.toHaveBeenCalled();
        await afterCheck();
        expect(checkDraft).toHaveBeenCalledTimes(1);
        const sent = lastDraft();
        expect(sent.columns[0].columnLabel).toBe('Deal');
        expect(sent.columns[0]._key).toBeUndefined();
        expect($(el, '.rh-editor-save').disabled).toBe(false);
    });

    it('shows errors from the check and keeps Save off until they are fixed', async () => {
        checkDraft.mockResolvedValue({ errors: ['Column 4 needs a field.'], warnings: ['A rule was skipped.'] });
        const el = await mount();
        click($(el, '.rh-add-column'));
        await afterCheck();
        expect($(el, '.rh-editor-errors').textContent).toContain('Column 4 needs a field.');
        expect($(el, '.rh-editor-warnings').textContent).toContain('A rule was skipped.');
        expect($(el, '.rh-editor-save').disabled).toBe(true);
    });

    it('moves a column, and turns a saved one off rather than deleting it', async () => {
        const el = await mount();
        const down = $$(el, 'lightning-button-icon[data-list="columns"][data-delta="1"]')[0];
        click(down);
        await settle();
        expect($$(el, '.rh-column-field').map(c => c.value)).toEqual(['Amount__c', 'Name', 'Score__c']);
        change($$(el, '.rh-column-on')[0], false);
        await afterCheck();
        const sent = lastDraft();
        expect(sent.columns.map(c => [c.field, c.inactive])).toEqual([['Amount__c', true], ['Name', false], ['Score__c', true]]);
    });

    it('keeps a column on screen for every user with Always shown', async () => {
        const el = await mount();
        const boxes = $$(el, '.rh-column-always');
        expect(boxes.map(b => b.checked)).toEqual([false, false, false]);
        expect(boxes[0].label).toBe('Name is always shown');
        change(boxes[0], true);
        await afterCheck();
        expect(lastDraft().columns.map(c => c.alwaysShown === true)).toEqual([true, false, false]);
    });

    it('clears what a column\'s new field cannot take', async () => {
        const el = await mount();
        change($$(el, '.rh-column-field')[1], 'Score__c'); // a formula: not editable, sum still fits
        await afterCheck();
        expect(lastDraft().columns[1]).toMatchObject({ field: 'Score__c', editable: false, subtotal: 'sum' });
    });

    it('asks for a date unit only when a date column groups', async () => {
        const el = await mount();
        click($(el, '.rh-add-column'));
        await settle();
        change($$(el, '.rh-column-field')[3], 'Close__c');
        await settle();
        expect($(el, '.rh-column-unit')).toBeNull();
        change($$(el, '.rh-column-group')[3], '1');
        await afterCheck();
        expect($(el, '.rh-column-unit').value).toBe('month');
        expect(lastDraft().columns[3]).toMatchObject({ groupLevel: 1, groupUnit: 'month' });
    });

    it('offers a rule only the conditions its field takes, and no value for a blank test', async () => {
        const el = await mount();
        expect($(el, '.rh-rule-operator').options.map(o => o.value)).toContain('greater_than');
        change($(el, '.rh-rule-operator'), 'is_blank');
        await settle();
        expect($(el, '.rh-rule-value')).toBeNull();
    });

    it('links a child table by the first field that points here', async () => {
        const el = await mount();
        click($(el, '.rh-add-child'));
        await settle();
        change($$(el, '.rh-child-config')[1], 'Deal_Notes');
        await afterCheck();
        expect(lastDraft().children[1]).toMatchObject({ childConfig: 'Deal_Notes', relationshipField: 'Deal__c' });
    });
});

describe('saving', () => {
    async function changeAndSave(el) {
        change($(el, '.rh-config-label'), 'Big Deals');
        await afterCheck();
        click($(el, '.rh-editor-save'));
        await settle();
    }

    it('deploys the draft, waits for it, then reads the grid again', async () => {
        saveDraft.mockResolvedValue('0Af000000000001');
        saveStatus.mockResolvedValueOnce({ status: 'pending', messages: [] }).mockResolvedValueOnce({ status: 'Succeeded', messages: [] });
        const el = await mount();
        await changeAndSave(el);
        expect(JSON.parse(saveDraft.mock.calls[0][0].draftJson).config.label).toBe('Big Deals');
        expect($(el, '.rh-editor-status').textContent).toContain('few seconds');
        expect($(el, '.rh-editor-save').disabled).toBe(true);
        jest.advanceTimersByTime(1000);
        await settle();
        jest.advanceTimersByTime(1500);
        await settle();
        expect(saveStatus).toHaveBeenCalledTimes(2);
        expect(saveStatus).toHaveBeenCalledWith({ jobId: '0Af000000000001' });
        expect(events.filter(e => e.type === 'saved').map(e => e.detail)).toEqual([{ configName: 'Deals' }]);
        expect(events.find(e => e.type === 'lightning__showtoast').detail.variant).toBe('success');
        expect(readConfig).toHaveBeenCalledTimes(2);
    });

    it('shows what failed, record by record', async () => {
        saveDraft.mockResolvedValue('0Af000000000002');
        saveStatus.mockResolvedValue({ status: 'Failed', messages: ['Grid_Column__mdt.Deals_X: bad value'] });
        const el = await mount();
        await changeAndSave(el);
        jest.advanceTimersByTime(1000);
        await settle();
        expect($(el, '.rh-editor-errors').textContent).toContain('Deals_X: bad value');
        expect(events.some(e => e.type === 'saved')).toBe(false);
    });

    it('stops waiting after a while and says the save may still go through', async () => {
        saveDraft.mockResolvedValue('0Af000000000003');
        saveStatus.mockResolvedValue({ status: 'pending', messages: [] });
        const el = await mount();
        await changeAndSave(el);
        for (let t = 0; t < SAVE_TIMEOUT_MS + 6000; t += 1000) {
            jest.advanceTimersByTime(1000);
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        expect($(el, '.rh-editor-status').textContent).toContain('longer than usual');
        expect($(el, '.rh-editor-save').disabled).toBe(false);
    });

    it('shows the server\'s refusal', async () => {
        saveDraft.mockRejectedValue({ body: { message: 'Saving a grid needs the Customize Application permission as well as Rowhouse Grid Admin.' } });
        const el = await mount();
        await changeAndSave(el);
        expect($(el, '.rh-editor-errors').textContent).toContain('Customize Application');
    });
});

describe('a new grid', () => {
    it('starts from the object, with its name column, and makes the API name from the title', async () => {
        const el = await mount('');
        expect(readConfig).not.toHaveBeenCalled();
        expect($(el, '.rh-config-object').options.map(o => o.value)).toEqual(['Account', 'Deal__c']);
        expect($(el, '.rh-needs-object')).not.toBeNull();
        change($(el, '.rh-config-label'), 'Open deals');
        await settle();
        expect($(el, '.rh-config-name').value).toBe('Open_deals');
        change($(el, '.rh-config-object'), 'Deal__c');
        await settle(); // the object is described before the draft is checked
        await afterCheck();
        expect(describeObject).toHaveBeenCalledWith({ objectApiName: 'Deal__c' });
        expect($$(el, '.rh-column-field').map(c => c.value)).toEqual(['Name']);
        const sent = lastDraft();
        expect(sent.config).toMatchObject({ name: 'Open_deals', label: 'Open deals', isNew: true, objectApiName: 'Deal__c' });
    });

    it('keeps an API name typed by hand', async () => {
        const el = await mount('');
        change($(el, '.rh-config-name'), 'My_Grid');
        change($(el, '.rh-config-label'), 'Something else');
        await settle();
        expect($(el, '.rh-config-name').value).toBe('My_Grid');
    });
});

describe('closing', () => {
    it('closes at once with nothing changed', async () => {
        const el = await mount();
        expect($(el, '.rh-editor-cancel').label).toBe('Close');
        el.requestClose();
        expect(events.map(e => e.type)).toEqual(['close']);
    });

    it('asks first with unsaved changes, and can keep editing or discard', async () => {
        const el = await mount();
        change($(el, '.rh-config-label'), 'Changed');
        await settle();
        click($(el, '.rh-editor-cancel'));
        await settle();
        expect($(el, '.rh-editor-discard-question')).not.toBeNull();
        expect(events.some(e => e.type === 'close')).toBe(false);
        click($(el, '.rh-editor-keep'));
        await settle();
        expect($(el, '.rh-editor-discard-question')).toBeNull();
        el.requestClose();
        await settle();
        click($(el, '.rh-editor-discard'));
        expect(events.some(e => e.type === 'close')).toBe(true);
    });
});

describe('help', () => {
    it('opens the matching part of the Configuration reference from each tab, in a new browser tab', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const el = await mount();
        const helps = $$(el, '.rh-editor-help');
        expect(helps.map(h => h.dataset.section)).toEqual(['config', 'column', 'rule', 'filter', 'action', 'child']);
        expect(helps.map(h => h.alternativeText)).toEqual(['Help for Grid', 'Help for Columns', 'Help for Display rules', 'Help for Filters', 'Help for Actions', 'Help for Child tables']);
        helps[2].dispatchEvent(new CustomEvent('click'));
        await settle();
        expect(mockGenerateUrl).toHaveBeenCalledWith({ type: 'standard__navItemPage', attributes: { apiName: 'Rowhouse_Guide' }, state: { c__page: 'configure', c__section: 'rule' } });
        expect(open).toHaveBeenCalledWith('/generated?{"c__page":"configure","c__section":"rule"}', '_blank');
        open.mockRestore();
    });
});
