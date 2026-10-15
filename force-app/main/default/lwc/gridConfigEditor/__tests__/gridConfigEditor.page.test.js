/**
 * The grid settings editor's page layout on the Grid Admin tab: the
 * heading with the way back, Close and Save at the top, the Grid Guide beside
 * the tabs, folding it away, and the compact layout the gear keeps.
 */
import { createElement } from 'lwc';
import GridConfigEditor, { HELP_HIDDEN_KEY } from 'c/gridConfigEditor';
import readConfig from '@salesforce/apex/GridAdminController.readConfig';
import listObjects from '@salesforce/apex/GridAdminController.listObjects';
import describeObject from '@salesforce/apex/GridAdminController.describeObject';
import checkDraft from '@salesforce/apex/GridAdminController.checkDraft';
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
    {
        name: 'Name',
        label: 'Name',
        type: 'text',
        sortable: true,
        groupable: true,
        editable: true,
        isName: true,
        subtotals: ['count']
    },
    {
        name: 'Amount__c',
        label: 'Amount',
        type: 'currency',
        sortable: true,
        groupable: false,
        editable: true,
        isName: false,
        subtotals: ['sum', 'average', 'min', 'max', 'count']
    },
    {
        name: 'Close__c',
        label: 'Close Date',
        type: 'date',
        sortable: true,
        groupable: true,
        editable: true,
        isName: false,
        subtotals: ['min', 'max', 'count']
    },
    {
        name: 'Score__c',
        label: 'Score',
        type: 'number',
        sortable: true,
        groupable: false,
        editable: false,
        isName: false,
        subtotals: ['sum']
    }
];
const DESCRIBED = {
    name: 'Deal__c',
    label: 'Deal',
    labelPlural: 'Deals',
    fields: FIELDS,
    children: [{ config: 'Deal_Notes', label: 'Deal Notes', fields: ['Deal__c', 'Other_Deal__c'] }]
};
const DRAFT = {
    config: {
        name: 'Deals',
        label: 'Deals',
        isNew: false,
        objectApiName: 'Deal__c',
        sortField: 'Name',
        sortDirection: 'asc',
        allowInlineEdit: true,
        allowCsvExport: true
    },
    columns: [
        { name: 'Deals_Name', field: 'Name', columnLabel: null, editable: true, sortable: true, inactive: false },
        {
            name: 'Deals_Amount',
            field: 'Amount__c',
            columnLabel: 'Value',
            editable: true,
            sortable: true,
            subtotal: 'sum',
            inactive: false
        },
        { name: 'Deals_Score', field: 'Score__c', columnLabel: null, editable: false, sortable: true, inactive: true }
    ],
    rules: [
        {
            name: 'Deals_Big',
            label: 'Big',
            field: 'Amount__c',
            operator: 'greater_than',
            value: '1000',
            style: 'fill_green',
            applyTo: 'row',
            inactive: false
        }
    ],
    actions: [],
    children: [
        {
            name: 'Deals_Notes',
            childConfig: 'Deal_Notes',
            relationshipField: 'Deal__c',
            tabLabel: 'Notes',
            inactive: false
        }
    ]
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

let events;
async function mount(configName = 'Deals', layout = 'page') {
    const el = createElement('c-grid-config-editor', { is: GridConfigEditor });
    el.configName = configName;
    if (layout) el.layout = layout;
    events = [];
    ['saved', 'close', 'lightning__showtoast'].forEach(type =>
        el.addEventListener(type, e => events.push({ type, detail: e.detail }))
    );
    document.body.appendChild(el);
    await settle();
    return el;
}

beforeEach(() => {
    jest.useFakeTimers();
    readConfig.mockResolvedValue({
        draft: DRAFT,
        warnings: ['Grid Column Deals_Score has an unknown Cell Type "Gauge".'],
        canSave: true
    });
    describeObject.mockResolvedValue(DESCRIBED);
    listObjects.mockResolvedValue([
        { name: 'Account', label: 'Account' },
        { name: 'Deal__c', label: 'Deal' }
    ]);
    canSave.mockResolvedValue(true);
    checkDraft.mockResolvedValue({ errors: [], warnings: [] });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    localStorage.removeItem(HELP_HIDDEN_KEY);
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('the page layout on the Grid Admin tab', () => {
    it('heads the page with the way back, the grid, its object and API name, and Close and Save', async () => {
        const el = await mount();
        expect(el.layout).toBe('page');
        expect($$(el, '.rh-ed-crumb').map(a => a.textContent)).toEqual(['Grid Admin', 'Grids']);
        expect($(el, '.rh-ed-title').textContent).toBe('Deals');
        expect($(el, '.rh-ed-object').textContent).toBe('Deals');
        expect($(el, '.rh-ed-name').textContent).toBe('Deals');
        expect($(el, '.rh-ed-place').textContent).toBe('Not on a record page · fills the window');
        expect($(el, '.rh-ed-actions .rh-editor-cancel').label).toBe('Close');
        expect($(el, '.rh-ed-actions .rh-editor-save').disabled).toBe(true);
        expect($(el, '.rh-ed-head .rh-editor-warnings').textContent).toContain(
            'Grid Column Deals_Score has an unknown Cell Type "Gauge".'
        );
        expect($(el, '.rh-editor-footer')).toBeNull();
    });

    it('says where a record-page grid shows, and how tall it is', async () => {
        readConfig.mockResolvedValue({
            draft: { ...DRAFT, config: { ...DRAFT.config, recordPageField: 'Name', height: 480 } },
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect($(el, '.rh-ed-place').textContent).toBe('On record pages, by Name · 480 pixels high');
    });

    it('shows the Grid Guide beside the tabs, following the open tab', async () => {
        const el = await mount();
        const help = $(el, '.rh-ed-help c-grid-admin-help');
        expect(help.tab).toBe('grid');
        $$(el, 'lightning-tab')[1].dispatchEvent(new CustomEvent('active'));
        await settle();
        expect($(el, '.rh-ed-help c-grid-admin-help').tab).toBe('columns');
    });

    it('folds the Grid Guide away, and this browser remembers it', async () => {
        let el = await mount();
        $(el, 'c-grid-admin-help').dispatchEvent(new CustomEvent('hide'));
        await settle();
        expect($(el, 'c-grid-admin-help')).toBeNull();
        expect($(el, '.rh-ed-show-help')).not.toBeNull();
        expect(localStorage.getItem(HELP_HIDDEN_KEY)).toBe('1');

        el.remove();
        el = await mount();
        expect($(el, 'c-grid-admin-help')).toBeNull();
        click($(el, '.rh-ed-show-help'));
        await settle();
        expect($(el, 'c-grid-admin-help')).not.toBeNull();
        expect(localStorage.getItem(HELP_HIDDEN_KEY)).toBeNull();
    });

    it('goes back from the heading, asking first when there are unsaved changes', async () => {
        const el = await mount();
        $(el, '.rh-ed-crumb').click();
        await settle();
        expect(events.filter(e => e.type === 'close')).toHaveLength(1);

        change($(el, '.rh-config-label'), 'Big deals');
        await settle();
        expect($(el, '.rh-ed-title').textContent).toBe('Big deals');
        $$(el, '.rh-ed-crumb')[1].click();
        await settle();
        expect($(el, '.rh-ed-head .rh-editor-discard-question').textContent).toBe('Discard your changes?');
        expect(events.filter(e => e.type === 'close')).toHaveLength(1);
    });

    it('heads a new grid New grid until it has a title', async () => {
        const el = await mount('');
        expect($(el, '.rh-ed-title').textContent).toBe('New grid');
        expect($(el, '.rh-ed-object')).toBeNull();
    });

    it('is accessible', async () => {
        const el = await mount();
        jest.useRealTimers();
        await expect(el).toBeAccessible();
    });
});

describe('the compact layout, from the gear on a grid', () => {
    it('keeps the tabs, then the problems and the buttons, with no heading or Grid Guide beside', async () => {
        const el = await mount('Deals', null);
        expect(el.layout).toBe('panel');
        expect($(el, '.rh-ed-head')).toBeNull();
        expect($(el, 'c-grid-admin-help')).toBeNull();
        expect($(el, '.rh-editor-footer .rh-editor-save')).not.toBeNull();
    });
});
