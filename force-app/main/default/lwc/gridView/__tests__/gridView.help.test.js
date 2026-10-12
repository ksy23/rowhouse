/**
 * Help on a grid: a button on every grid opens the Grid Guide's User
 * guide in a new browser tab, so unsaved changes stay where they are.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.runAction', () => ({ default: jest.fn() }), { virtual: true });
// The dialog's editor never finishes loading here; the dialog has its own tests.
jest.mock(
    '@salesforce/apex/GridAdminController.readConfig',
    () => ({ default: jest.fn(() => new Promise(() => {})) }),
    { virtual: true }
);

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

const DEFINITION = {
    name: 'Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
        { field: 'Consignee__c', label: 'Consignee', type: 'text', editable: true, sortable: true }
    ]
};
const row = i => ({
    Id: 'a00' + String(i).padStart(15, '0'),
    Name: 'Kennebec Lumber, load ' + i,
    Consignee__c: 'Kennebec Lumber'
});
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length });

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);

function mount(configName = 'Consignments') {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = configName;
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false, canConfigure: true });
    fetchRows.mockResolvedValue(page([row(1), row(2)]));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

it('opens the User guide in a new browser tab', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount();
    await settle();
    const help = $(el, '.rh-help');
    expect(help.iconName).toBe('utility:help');
    expect(help.alternativeText).toBe('Help');
    help.dispatchEvent(new CustomEvent('click'));
    await settle();
    expect(mockGenerateUrl).toHaveBeenCalledWith({
        type: 'standard__navItemPage',
        attributes: { apiName: 'Rowhouse_Guide' },
        state: { c__page: 'using' }
    });
    expect(open).toHaveBeenCalledWith('/generated?{"c__page":"using"}', '_blank');
    open.mockRestore();
});

it('is there for someone who is not a grid admin too', async () => {
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false, canConfigure: false });
    const el = mount();
    await settle();
    expect($(el, '.rh-settings')).toBeNull();
    expect($(el, '.rh-help')).not.toBeNull();
});

it('says where else to find the guide if it cannot open', async () => {
    mockGenerateUrl.mockReturnValueOnce(Promise.reject(new Error('Page not available')));
    const el = mount();
    await settle();
    const toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    $(el, '.rh-help').dispatchEvent(new CustomEvent('click'));
    await settle();
    expect(toasts).toEqual([expect.objectContaining({ title: 'The Grid Guide did not open', variant: 'warning' })]);
});
