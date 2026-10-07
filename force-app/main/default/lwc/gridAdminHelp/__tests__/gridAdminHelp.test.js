/**
 * The Grid Guide beside the grid editor: it follows the editor's open
 * tab, opens the matching part of the Configuration reference in a new browser
 * tab, and asks to be hidden.
 */
import { createElement } from 'lwc';
import GridAdminHelp, { SECTIONS } from 'c/gridAdminHelp';

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

const settle = async () => {
    for (let i = 0; i < 6; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);

async function mount(tab) {
    const el = createElement('c-grid-admin-help', { is: GridAdminHelp });
    el.tab = tab;
    document.body.appendChild(el);
    await settle();
    return el;
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

const TITLES = {
    grid: 'Grid Configuration',
    columns: 'Grid Column',
    rules: 'Grid Format Rule',
    filters: 'Grid Filter',
    actions: 'Grid Action',
    children: 'Grid Child Table'
};

it.each(Object.keys(TITLES))('shows the %s tab its record, and links its part of the reference', async tab => {
    const el = await mount(tab);
    expect($(el, '.rh-help-title').textContent).toBe(TITLES[tab]);
    expect($(el, '.rh-help-list')).not.toBeNull();
    expect($(el, '.rh-help-open').getAttribute('href')).toBe(`/lightning/n/Rowhouse_Guide?c__page=configure&c__section=${SECTIONS[tab]}`);
});

it('follows the tab as it changes, and takes an unknown tab as Grid', async () => {
    const el = await mount('columns');
    el.tab = 'rules';
    await settle();
    expect($(el, '.rh-help-title').textContent).toBe('Grid Format Rule');
    el.tab = 'nonsense';
    await settle();
    expect($(el, '.rh-help-title').textContent).toBe('Grid Configuration');
});

it('opens the reference in a new browser tab', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const el = await mount('filters');
    $(el, '.rh-help-open').click();
    await settle();
    expect(mockGenerateUrl).toHaveBeenCalledWith({
        type: 'standard__navItemPage',
        attributes: { apiName: 'Rowhouse_Guide' },
        state: { c__page: 'configure', c__section: 'filter' }
    });
    expect(open).toHaveBeenCalledWith('/generated?{"c__page":"configure","c__section":"filter"}', '_blank');
    open.mockRestore();
});

it('asks to be hidden', async () => {
    const el = await mount('grid');
    const hide = jest.fn();
    el.addEventListener('hide', hide);
    $(el, '.rh-help-hide').dispatchEvent(new CustomEvent('click'));
    expect(hide).toHaveBeenCalledTimes(1);
});

it('is accessible', async () => {
    const el = await mount('actions');
    await expect(el).toBeAccessible();
});
