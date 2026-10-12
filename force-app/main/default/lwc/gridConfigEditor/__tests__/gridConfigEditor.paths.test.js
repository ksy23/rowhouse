/**
 * Choosing a parent record's field for a column on the Grid Admin tab: a
 * lookup in the field list opens its record's fields in a second list, and
 * the column's field becomes the path, Account.Industry.
 */
import { createElement } from 'lwc';
import GridConfigEditor from 'c/gridConfigEditor';
import readConfig from '@salesforce/apex/GridAdminController.readConfig';
import describeObject from '@salesforce/apex/GridAdminController.describeObject';
import checkDraft from '@salesforce/apex/GridAdminController.checkDraft';

jest.mock('@salesforce/apex/GridAdminController.readConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.listObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.describeObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.checkDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate]() {}
            [GenerateUrl]() {
                return Promise.resolve('/lightning/n/Rowhouse_Guide');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const CONTACT = {
    name: 'Contact',
    label: 'Contact',
    labelPlural: 'Contacts',
    children: [],
    fields: [
        { name: 'LastName', label: 'Last Name', heading: 'Last Name', type: 'text', editable: true, sortable: true },
        {
            name: 'AccountId',
            label: 'Account ID',
            heading: 'Account',
            type: 'reference',
            referenceTo: ['Account'],
            relationship: 'Account',
            reachable: true,
            editable: true,
            sortable: true
        }
    ]
};
const ACCOUNT = {
    name: 'Account',
    label: 'Account',
    labelPlural: 'Accounts',
    children: [],
    fields: [
        {
            name: 'Industry',
            label: 'Industry',
            heading: 'Industry',
            type: 'picklist',
            editable: true,
            sortable: true,
            groupable: true,
            subtotals: ['count']
        }
    ]
};
const DRAFT = {
    config: { name: 'People', label: 'People', isNew: false, objectApiName: 'Contact', allowInlineEdit: true },
    columns: [
        { name: 'People_Name', field: 'LastName', editable: true, sortable: true, inactive: false },
        { name: 'People_Industry', field: 'Account.Industry', editable: true, sortable: true, inactive: false }
    ],
    rules: [],
    actions: [],
    children: [],
    filters: []
};

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const change = (target, value) => target.dispatchEvent(new CustomEvent('change', { detail: { value } }));

async function mount() {
    const el = createElement('c-grid-config-editor', { is: GridConfigEditor });
    el.configName = 'People';
    document.body.appendChild(el);
    await settle();
    return el;
}

beforeEach(() => {
    jest.useFakeTimers();
    readConfig.mockResolvedValue({ draft: DRAFT, warnings: [], canSave: true });
    describeObject.mockImplementation(({ objectApiName }) =>
        Promise.resolve(objectApiName === 'Account' ? ACCOUNT : CONTACT)
    );
    checkDraft.mockResolvedValue({ errors: [], warnings: [] });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('a column of a parent record’s field', () => {
    it('reads a saved path as the lookup, then the parent’s field', async () => {
        const el = await mount();
        expect(describeObject).toHaveBeenCalledWith({ objectApiName: 'Account' });
        expect($$(el, '.rh-column-field').map(c => c.value)).toEqual(['LastName', 'Account.']);
        const step = $$(el, '.rh-column-step');
        expect(step).toHaveLength(1);
        expect(step[0].value).toBe('Industry');
        expect(step[0].label).toBe('Field of Account, column 2');
        expect($$(el, '.rh-column-label')[1].placeholder).toBe('Account: Industry');
    });

    it('opens the parent’s fields when a lookup is chosen, and keeps the path when one is', async () => {
        const el = await mount();
        change($$(el, '.rh-column-field')[0], 'Account.');
        await settle();
        let steps = $$(el, '.rh-column-step');
        expect(steps).toHaveLength(2);
        expect(steps[0].value).toBe('');
        expect(steps[0].placeholder).toBe('Choose a field of Account');
        change(steps[0], 'Industry');
        await settle();
        steps = $$(el, '.rh-column-step');
        expect(steps[0].value).toBe('Industry');
        expect($$(el, '.rh-column-field')[0].value).toBe('Account.');
    });

    it('goes back to a field of the grid’s own object when one is chosen first', async () => {
        const el = await mount();
        change($$(el, '.rh-column-field')[1], 'LastName');
        await settle();
        expect($$(el, '.rh-column-step')).toHaveLength(0);
        expect($$(el, '.rh-column-field').map(c => c.value)).toEqual(['LastName', 'LastName']);
    });
});
