/**
 * The gear on a grid: shown only to Rowhouse Grid Admin holders, in the
 * toolbar or the compact menu, not over unsaved changes, and after a save the
 * grid loads again from its configuration, never from the browser's cache:
 * openGrid is not cacheable.
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
    ]
};
const row = i => ({ Id: 'a00' + String(i).padStart(15, '0'), Name: 'Row ' + i, Text_Field__c: 'x' });
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length });

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);

function mount(configName = 'Test_Records') {
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

it('shows no gear without Rowhouse Grid Admin', async () => {
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false, canConfigure: false });
    const el = mount();
    await settle();
    expect($(el, '.rh-settings')).toBeNull();
});

it("opens this grid's settings from the gear", async () => {
    const el = mount();
    await settle();
    const gear = $(el, '.rh-settings');
    expect(gear.iconName).toBe('utility:settings');
    expect(gear.alternativeText).toBe('Grid settings');
    gear.dispatchEvent(new CustomEvent('click'));
    await settle();
    const dialog = $(el, 'c-grid-settings');
    expect(dialog.configName).toBe('Test_Records');
    expect(dialog.gridTitle).toBe('Test Records');
    dialog.dispatchEvent(new CustomEvent('close'));
    await settle();
    expect($(el, 'c-grid-settings')).toBeNull();
});

it('waits for unsaved changes to be saved or cancelled', async () => {
    const el = mount();
    await settle();
    $(el, 'c-grid-table').dispatchEvent(
        new CustomEvent('cellchange', {
            detail: { recordId: row(1).Id, field: 'Text_Field__c', value: 'changed', originalValue: 'x' }
        })
    );
    await settle();
    const gear = $(el, '.rh-settings');
    expect(gear.disabled).toBe(true);
    expect(gear.title).toMatch(/save or cancel/);
});

it('opens the grid again after a save, with the configuration just saved', async () => {
    const el = mount();
    await settle();
    expect(openGrid).toHaveBeenCalledTimes(1);
    $(el, '.rh-settings').dispatchEvent(new CustomEvent('click'));
    await settle();
    getGridConfig.mockResolvedValue({
        definition: { ...DEFINITION, label: 'Renamed' },
        diagnostics: false,
        canConfigure: true
    });
    $(el, 'c-grid-settings').dispatchEvent(new CustomEvent('saved', { detail: { configName: 'Test_Records' } }));
    await settle();
    expect($(el, 'c-grid-settings')).toBeNull();
    expect(openGrid).toHaveBeenCalledTimes(2);
    expect(openGrid).toHaveBeenLastCalledWith(expect.objectContaining({ configName: 'Test_Records' }));
    expect($(el, 'h2').textContent).toContain('Renamed');
});
