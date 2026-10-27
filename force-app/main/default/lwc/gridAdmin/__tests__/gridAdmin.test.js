/**
 * The Grid Admin tab (laid out as): the logo and its two pages,
 * the Grids page's stat cards, its side navigation, search and
 * sortable headings,
 * opening a grid, starting a new one, coming back, Settings, what it says
 * to someone it refuses, each row's menu with Archived grids, and exporting
 * and importing grids.
 */
import { createElement } from 'lwc';
import GridAdmin from 'c/gridAdmin';
import listConfigs from '@salesforce/apex/GridAdminController.listConfigs';
import canSave from '@salesforce/apex/GridAdminController.canSave';
import logRetention from '@salesforce/apex/GridAdminController.logRetention';
import exportGrids from '@salesforce/apex/GridAdminController.exportGrids';
import installedVersion from '@salesforce/apex/GridAdminController.installedVersion';
import { downloadText } from 'c/gridCsv';

jest.mock('@salesforce/apex/GridAdminController.listConfigs', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.exportGrids', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.installedVersion', () => ({ default: jest.fn() }), { virtual: true });
// The import dialog is the real one (it has its own tests); here it is only opened and answered for.
jest.mock(
    '@salesforce/apex/GridAdminController.planImport',
    () => ({ default: jest.fn(() => new Promise(() => {})) }),
    { virtual: true }
);
// The browser's download is not jsdom's to do: Export hands the file over here.
jest.mock('c/gridCsv', () => {
    const actual = jest.requireActual('c/gridCsv');
    return { ...actual, downloadText: jest.fn(() => true) };
});
// The editor is the real one (it has its own tests); its server calls answer here.
jest.mock(
    '@salesforce/apex/GridAdminController.readConfig',
    () => ({ default: jest.fn(() => new Promise(() => {})) }),
    { virtual: true }
);
jest.mock('@salesforce/apex/GridAdminController.listObjects', () => ({ default: jest.fn(() => Promise.resolve([])) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridAdminController.describeObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.checkDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
// The edit log's retention is the real component too, with its own tests.
jest.mock(
    '@salesforce/apex/GridAdminController.logRetention',
    () => ({ default: jest.fn(() => new Promise(() => {})) }),
    { virtual: true }
);
jest.mock('@salesforce/apex/GridAdminController.saveLogRetention', () => ({ default: jest.fn() }), { virtual: true });
// The row dialog is the real one too, with its own tests.
jest.mock('@salesforce/apex/GridAdminController.archiveConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.cloneConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock(
    '@salesforce/apex/GridAdminController.setupRecords',
    () => ({ default: jest.fn(() => new Promise(() => {})) }),
    { virtual: true }
);

const mockGenerateUrl = jest.fn(ref => Promise.resolve('/generated?' + JSON.stringify(ref.state)));
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
            [GenerateUrl](ref) {
                return mockGenerateUrl(ref);
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const CONFIGS = [
    {
        name: 'Consignments',
        label: 'Consignments',
        objectApiName: 'Consignment__c',
        objectLabel: 'Consignments',
        columns: 6,
        childTables: 2,
        logChanges: true
    },
    {
        name: 'Open_Cases',
        label: 'Open cases',
        objectApiName: 'Case',
        objectLabel: 'Cases',
        columns: 1,
        childTables: 0,
        logChanges: false
    }
];

const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
/** The side navigation's link for a view: '' Available grids, '__archived__', or an object's API name. */
const side = (el, value) => $$(el, '.rh-admin-side-link').find(a => (a.dataset.value || '') === value);
const choose = async (el, value) => {
    side(el, value).click();
    await settle();
};

async function mount() {
    const el = createElement('c-grid-admin', { is: GridAdmin });
    document.body.appendChild(el);
    await settle();
    return el;
}

beforeEach(() => {
    listConfigs.mockResolvedValue(CONFIGS);
    canSave.mockResolvedValue(true);
    installedVersion.mockResolvedValue(null);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

it('shows the Rowhouse logo from its static resource', async () => {
    const el = await mount();
    const logo = $(el, '.rh-admin-logo');
    expect(logo.tagName).toBe('IMG');
    expect(logo.getAttribute('src')).toContain('RowhouseLogo');
    expect(logo.getAttribute('alt')).toBe('Rowhouse');
});

describe('the installed version and the check for a newer one', () => {
    const link = el => $(el, '.rh-admin-version-link');

    it("names the installed version and sends it to What's new, in a new tab", async () => {
        installedVersion.mockResolvedValue('1.2');
        const el = await mount();
        expect($(el, '.rh-admin-version-name').textContent).toBe('Rowhouse 1.2');
        expect(link(el).getAttribute('href')).toBe('https://rowhouse.app/whats-new/?installed=1.2');
        expect(link(el).getAttribute('target')).toBe('_blank');
        expect(link(el).getAttribute('rel')).toContain('noopener');
        expect(link(el).textContent).toBe('Check for a newer version (opens in a new tab)');
        expect(installedVersion).toHaveBeenCalledTimes(1);
    });

    it('offers the check without a version where Rowhouse is not installed as the package', async () => {
        const el = await mount();
        expect($(el, '.rh-admin-version-name')).toBeNull();
        expect(link(el).getAttribute('href')).toBe('https://rowhouse.app/whats-new/');
    });

    it('takes nothing but a version number into the address', async () => {
        installedVersion.mockResolvedValue('1.2&x=<b>');
        const el = await mount();
        expect($(el, '.rh-admin-version-name')).toBeNull();
        expect(link(el).getAttribute('href')).toBe('https://rowhouse.app/whats-new/');
    });

    it('still offers the check when the version cannot be read', async () => {
        installedVersion.mockRejectedValue({ body: { message: 'This needs the Rowhouse Grid Admin permission set.' } });
        const el = await mount();
        expect($(el, '.rh-admin-version-name')).toBeNull();
        expect(link(el).getAttribute('href')).toBe('https://rowhouse.app/whats-new/');
    });

    it('reads the version once, not again when the list is brought up to date', async () => {
        installedVersion.mockResolvedValue('1.2');
        const el = await mount();
        $$(el, '.rh-admin-open')[0].click();
        await settle();
        $(el, 'c-grid-config-editor').dispatchEvent(new CustomEvent('close'));
        await settle();
        expect(listConfigs).toHaveBeenCalledTimes(2);
        expect(installedVersion).toHaveBeenCalledTimes(1);
    });
});

it('lists every grid with its object and column count', async () => {
    const el = await mount();
    expect($(el, '.rh-admin-count').textContent).toBe('2 grids');
    expect($$(el, '.rh-admin-open').map(b => b.textContent)).toEqual(['Consignments', 'Open cases']);
    expect($$(el, '.rh-admin-name').map(c => c.textContent)).toEqual(['Consignments', 'Open_Cases']);
});

it('opens a grid in the editor, and comes back to the list', async () => {
    const el = await mount();
    $$(el, '.rh-admin-open')[1].click();
    await settle();
    const editor = $(el, 'c-grid-config-editor');
    expect(editor.configName).toBe('Open_Cases');
    expect(editor.layout).toBe('page');
    expect($(el, '.rh-admin-list')).toBeNull();
    editor.dispatchEvent(new CustomEvent('close')); // the editor's Close, or its way back
    await settle();
    expect($(el, 'c-grid-config-editor')).toBeNull();
    expect($(el, '.rh-admin-list')).not.toBeNull();
    expect(listConfigs).toHaveBeenCalledTimes(2); // the list is brought up to date
});

it('starts a new grid', async () => {
    const el = await mount();
    $(el, '.rh-admin-new').dispatchEvent(new CustomEvent('click'));
    await settle();
    expect($(el, 'c-grid-config-editor').configName).toBe('');
});

it('stays on a new grid once it is saved, under its name', async () => {
    const el = await mount();
    $(el, '.rh-admin-new').dispatchEvent(new CustomEvent('click'));
    await settle();
    $(el, 'c-grid-config-editor').dispatchEvent(
        new CustomEvent('saved', { detail: { configName: 'Consignments_By_Mode' } })
    );
    await settle();
    expect($(el, 'c-grid-config-editor').configName).toBe('Consignments_By_Mode');
});

it('turns New grid off without Customize Application', async () => {
    canSave.mockResolvedValue(false);
    const el = await mount();
    expect($(el, '.rh-admin-new').disabled).toBe(true);
});

it('says what is needed to someone without Rowhouse Grid Admin', async () => {
    listConfigs.mockRejectedValue({ body: { message: 'This needs the Rowhouse Grid Admin permission set.' } });
    const el = await mount();
    expect($(el, '.rh-admin-error').textContent).toContain('Rowhouse Grid Admin permission set');
    expect($(el, '.rh-admin-new')).toBeNull();
});

it('is accessible', async () => {
    const el = await mount();
    await expect(el).toBeAccessible();
});

describe('help', () => {
    it('opens Get started in the Grid Guide, in a new browser tab', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        listConfigs.mockResolvedValue(CONFIGS);
        canSave.mockResolvedValue(true);
        const el = await mount();
        const help = $(el, '.rh-admin-help');
        expect(help.label).toBe('Grid Guide');
        expect(help.iconName).toBe('utility:help');
        help.dispatchEvent(new CustomEvent('click'));
        await settle();
        expect(mockGenerateUrl).toHaveBeenCalledWith({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Grid_Guide' },
            state: { c__page: 'start' }
        });
        expect(open).toHaveBeenCalledWith('/generated?{"c__page":"start"}', '_blank');
        open.mockRestore();
    });

    it('links the list to Get started, in this browser tab', async () => {
        listConfigs.mockResolvedValue(CONFIGS);
        canSave.mockResolvedValue(true);
        const el = await mount();
        const link = $(el, '.rh-admin-guide-link');
        expect(link.textContent).toBe('Get started →');
        expect(link.getAttribute('href')).toBe('/lightning/n/Grid_Guide?c__page=start');
        link.click();
        expect(mockNavigate).toHaveBeenCalledWith({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Grid_Guide' },
            state: { c__page: 'start' }
        });
    });
});

describe('the Grids page', () => {
    it('opens on Grids, with the stat cards', async () => {
        logRetention.mockResolvedValueOnce({ label: '1 year' });
        const el = await mount();
        await settle();
        const nav = $$(el, '.rh-admin-nav-link');
        expect(nav.map(a => a.textContent)).toEqual(['Grids', 'Settings']);
        expect(nav[0].getAttribute('aria-current')).toBe('page');
        const n = selector => $(el, `${selector} .rh-stat-n`).textContent;
        expect(n('.rh-admin-stat-grids')).toBe('2');
        expect(n('.rh-admin-stat-objects')).toBe('2');
        expect(n('.rh-admin-stat-logging')).toBe('1');
        expect($(el, '.rh-admin-stat-logging .rh-stat-l').textContent).toBe('grid logs every change');
        expect(n('.rh-admin-stat-children')).toBe('1');
        expect(n('.rh-admin-stat-retention')).toBe('1 year');
    });

    it('narrows the list by search', async () => {
        const el = await mount();
        $(el, '.rh-admin-search').dispatchEvent(new CustomEvent('change', { detail: { value: 'consign' } }));
        await settle();
        expect($$(el, '.rh-admin-open').map(b => b.textContent)).toEqual(['Consignments']);
        expect($(el, '.rh-admin-count').textContent).toBe('1 of 2 grids');

        $(el, '.rh-admin-search').dispatchEvent(new CustomEvent('change', { detail: { value: 'Invoices' } }));
        await settle();
        expect($(el, '.rh-admin-list')).toBeNull();
        expect($(el, '.rh-admin-no-match').textContent).toBe('No grids match. Clear the search.');
    });
});

describe('the side navigation', () => {
    it('lists Available grids, Archived grids and each object, with counts', async () => {
        const el = await mount();
        expect($(el, '.rh-admin-side').getAttribute('aria-label')).toBe('Grids to show');
        expect($$(el, '.rh-admin-side-k').map(k => k.textContent)).toEqual(['Grids', 'By object']);
        expect($$(el, '.rh-admin-side-label').map(l => l.textContent)).toEqual([
            'Available grids',
            'Archived grids',
            'Cases',
            'Consignments'
        ]);
        expect($$(el, '.rh-admin-side-count').map(c => c.textContent)).toEqual(['2', '0', '1', '1']);
        expect(side(el, '').getAttribute('aria-label')).toBe('Available grids, 2 grids');
        expect(side(el, 'Case').getAttribute('aria-label')).toBe('Cases, 1 grid');
    });

    it('opens on Available grids, marked as the current one', async () => {
        const el = await mount();
        expect(side(el, '').getAttribute('aria-current')).toBe('page');
        expect(side(el, '').className).toContain('rh-admin-side-link_current');
        expect(side(el, 'Case').getAttribute('aria-current')).toBeNull();
        expect($(el, '.rh-secnum').textContent).toBe('Available grids');
        expect($(el, '.rh-admin-count').textContent).toBe('2 grids');
    });

    it("shows one object's grids, and the search narrows them", async () => {
        const el = await mount();
        await choose(el, 'Consignment__c');
        expect(side(el, 'Consignment__c').getAttribute('aria-current')).toBe('page');
        expect(side(el, '').getAttribute('aria-current')).toBeNull();
        expect($(el, '.rh-secnum').textContent).toBe('Consignments');
        expect($(el, '.rh-admin-count').textContent).toBe('1 grid');
        expect($$(el, '.rh-admin-open').map(b => b.textContent)).toEqual(['Consignments']);

        $(el, '.rh-admin-search').dispatchEvent(new CustomEvent('change', { detail: { value: 'cases' } }));
        await settle();
        expect($(el, '.rh-admin-no-match')).not.toBeNull();

        await choose(el, '');
        expect($(el, '.rh-admin-count').textContent).toBe('1 of 2 grids');
        expect($$(el, '.rh-admin-open').map(b => b.textContent)).toEqual(['Open cases']);
    });

    it('says when there are no archived grids', async () => {
        const el = await mount();
        await choose(el, '__archived__');
        expect($(el, '.rh-secnum').textContent).toBe('Archived grids');
        expect($(el, '.rh-admin-count').textContent).toBe('0 archived grids');
        expect($(el, '.rh-admin-no-archived').textContent).toContain('No archived grids');
        expect($(el, '.rh-admin-archived-note')).toBeNull();
        expect($(el, '.rh-admin-list')).toBeNull();
    });

    it('is only on the Grids page', async () => {
        const el = await mount();
        $$(el, '.rh-admin-nav-link')[1].click();
        await settle();
        expect($(el, '.rh-admin-side')).toBeNull();
        $$(el, '.rh-admin-nav-link')[0].click();
        await settle();
        $$(el, '.rh-admin-open')[0].click();
        await settle();
        expect($(el, '.rh-admin-side')).toBeNull();
    });

    it('goes back to Available grids when the object it shows has no grid left in use', async () => {
        const el = await mount();
        await choose(el, 'Case');
        listConfigs.mockResolvedValue(CONFIGS.map(c => (c.name === 'Open_Cases' ? { ...c, archived: true } : c)));
        $(el, '.rh-admin-row-menu').dispatchEvent(new CustomEvent('select', { detail: { value: 'archive' } }));
        await settle();
        $(el, 'c-grid-admin-row-dialog').dispatchEvent(
            new CustomEvent('done', { detail: { action: 'archive', configName: 'Open_Cases' } })
        );
        await settle();
        expect(side(el, '').getAttribute('aria-current')).toBe('page');
        expect(side(el, 'Case')).toBeUndefined();
        expect($$(el, '.rh-admin-side-count').map(c => c.textContent)).toEqual(['1', '1', '1']);
        expect($$(el, '.rh-admin-open').map(b => b.textContent)).toEqual(['Consignments']);
    });
});

describe('sorting the list', () => {
    const MANY = [
        {
            name: 'Shipper_Contracts',
            label: 'Shipper contracts',
            objectApiName: 'Contract',
            objectLabel: 'Contracts',
            columns: 10
        },
        {
            name: 'account_people',
            label: 'account people',
            objectApiName: 'Contact',
            objectLabel: 'Contacts',
            columns: 9
        },
        { name: 'Key_Accounts', label: 'Key Accounts', objectApiName: 'Account', objectLabel: 'Accounts', columns: 9 },
        {
            name: 'Freight_Bills_20',
            label: 'Freight Bills (20 columns)',
            objectApiName: 'Freight_Bill__c',
            objectLabel: 'Freight Bills',
            columns: 20
        }
    ];
    const titles = el => $$(el, '.rh-admin-open').map(b => b.textContent);
    const heads = el => $$(el, '.rh-admin-sortable');
    const sortBy = async (el, label) => {
        $$(el, '.rh-admin-sort')
            .find(b => b.getAttribute('aria-label') === `Sort by ${label}`)
            .click();
        await settle();
    };

    it('opens sorted by Grid title, A to Z whatever the case, marked on the heading', async () => {
        listConfigs.mockResolvedValue(MANY);
        const el = await mount();
        expect(titles(el)).toEqual([
            'account people',
            'Freight Bills (20 columns)',
            'Key Accounts',
            'Shipper contracts'
        ]);
        expect($$(el, '.rh-admin-sortable .rh-admin-sort-label').map(l => l.textContent)).toEqual([
            'Grid title',
            'API name',
            'Object',
            'Columns'
        ]);
        expect(heads(el).map(th => th.getAttribute('aria-sort'))).toEqual(['ascending', 'none', 'none', 'none']);
        const first = heads(el)[0].querySelector('.rh-admin-sort');
        expect(first.getAttribute('aria-label')).toBe('Sort by Grid title');
        expect(first.title).toBe('Sorted A to Z. Click to reverse.');
        expect(heads(el)[1].querySelector('.rh-admin-sort').title).toBe('Sort by API name');
        expect($(el, '.rh-admin-sort-status').textContent).toBe('');
    });

    it('sorts by a heading, and the other way when it is clicked again', async () => {
        listConfigs.mockResolvedValue(MANY);
        const el = await mount();
        await sortBy(el, 'Object');
        expect(titles(el)).toEqual([
            'Key Accounts',
            'account people',
            'Shipper contracts',
            'Freight Bills (20 columns)'
        ]);
        expect(heads(el).map(th => th.getAttribute('aria-sort'))).toEqual(['none', 'none', 'ascending', 'none']);
        expect($(el, '.rh-admin-sort-status').textContent).toBe('Sorted by Object, ascending');

        await sortBy(el, 'Object');
        expect(titles(el)).toEqual([
            'Freight Bills (20 columns)',
            'Shipper contracts',
            'account people',
            'Key Accounts'
        ]);
        expect(heads(el)[2].getAttribute('aria-sort')).toBe('descending');
        expect(heads(el)[2].querySelector('lightning-icon').iconName).toBe('utility:arrowdown');
        expect($(el, '.rh-admin-sort-status').textContent).toBe('Sorted by Object, descending');
    });

    it('sorts Columns as numbers, ties by Grid title A to Z either way', async () => {
        listConfigs.mockResolvedValue(MANY);
        const el = await mount();
        await sortBy(el, 'Columns');
        expect(titles(el)).toEqual([
            'account people',
            'Key Accounts',
            'Shipper contracts',
            'Freight Bills (20 columns)'
        ]);
        await sortBy(el, 'Columns');
        expect(titles(el)).toEqual([
            'Freight Bills (20 columns)',
            'Shipper contracts',
            'account people',
            'Key Accounts'
        ]);
    });

    it('sorts API names as a person reads them, and keeps the sort through search and the side navigation', async () => {
        listConfigs.mockResolvedValue([
            ...MANY,
            {
                name: 'Freight_Bills_5',
                label: 'Freight Bills (5 columns)',
                objectApiName: 'Freight_Bill__c',
                objectLabel: 'Freight Bills',
                columns: 5
            }
        ]);
        const el = await mount();
        await sortBy(el, 'API name');
        expect($$(el, '.rh-admin-name').map(c => c.textContent)).toEqual([
            'account_people',
            'Freight_Bills_5',
            'Freight_Bills_20',
            'Key_Accounts',
            'Shipper_Contracts'
        ]);
        await sortBy(el, 'API name');
        $(el, '.rh-admin-search').dispatchEvent(new CustomEvent('change', { detail: { value: 'freight' } }));
        await settle();
        expect($$(el, '.rh-admin-name').map(c => c.textContent)).toEqual(['Freight_Bills_20', 'Freight_Bills_5']);
        await choose(el, 'Freight_Bill__c');
        expect($$(el, '.rh-admin-name').map(c => c.textContent)).toEqual(['Freight_Bills_20', 'Freight_Bills_5']);
        expect(heads(el)[1].getAttribute('aria-sort')).toBe('descending');
    });

    it('is accessible, sorted', async () => {
        listConfigs.mockResolvedValue(MANY);
        const el = await mount();
        await sortBy(el, 'Columns');
        await expect(el).toBeAccessible();
    });
});

describe('Settings', () => {
    it('shows the Grid Edit Log Retention setting, from the header or the retention card', async () => {
        const el = await mount();
        $$(el, '.rh-admin-nav-link')[1].click();
        await settle();
        expect($(el, 'c-grid-log-retention')).not.toBeNull();
        expect($(el, '.rh-admin-list')).toBeNull();
        expect($$(el, '.rh-admin-nav-link')[1].getAttribute('aria-current')).toBe('page');

        $$(el, '.rh-admin-nav-link')[0].click();
        await settle();
        expect($(el, 'c-grid-log-retention')).toBeNull();
        $(el, '.rh-admin-to-settings').click();
        await settle();
        expect($(el, 'c-grid-log-retention')).not.toBeNull();
    });

    it('leaves a grid being edited by way of the editor, which asks first about unsaved changes', async () => {
        const el = await mount();
        $$(el, '.rh-admin-open')[0].click();
        await settle();
        const editor = $(el, 'c-grid-config-editor');
        const close = jest.spyOn(editor, 'requestClose');
        $$(el, '.rh-admin-nav-link')[1].click();
        await settle();
        expect(close).toHaveBeenCalled();
        // The editor had nothing unsaved, so it closed; the page asked for shows.
        expect($(el, 'c-grid-config-editor')).toBeNull();
        expect($(el, 'c-grid-log-retention')).not.toBeNull();
    });
});

describe('the row menu', () => {
    const WITH_ARCHIVED = [
        ...CONFIGS.map(c => (c.name === 'Consignments' ? { ...c, usedBy: ['Accounts'] } : c)),
        {
            name: 'Consignments_2025',
            label: 'Consignments 2025',
            objectApiName: 'Consignment__c',
            objectLabel: 'Consignments',
            columns: 3,
            childTables: 0,
            logChanges: true,
            archived: true
        }
    ];
    const menus = el => $$(el, '.rh-admin-row-menu');
    const items = menu => [...menu.querySelectorAll('lightning-menu-item')];
    const pick = async (menu, value) => {
        menu.dispatchEvent(new CustomEvent('select', { detail: { value } }));
        await settle();
    };

    it('gives every grid Edit, Clone, Export and Archive', async () => {
        const el = await mount();
        expect(menus(el).map(m => m.alternativeText)).toEqual(['Actions for Consignments', 'Actions for Open cases']);
        expect(items(menus(el)[0]).map(i => i.label)).toEqual(['Edit', 'Clone', 'Export', 'Archive']);
        expect(items(menus(el)[0]).map(i => i.prefixIconName)).toEqual([
            'utility:edit',
            'utility:copy',
            'utility:download',
            'utility:archive'
        ]);
        expect(items(menus(el)[0]).map(i => i.disabled)).toEqual([undefined, false, false, false]);
    });

    it('opens the grid on Edit', async () => {
        const el = await mount();
        await pick(menus(el)[1], 'edit');
        expect($(el, 'c-grid-config-editor').configName).toBe('Open_Cases');
    });

    it('turns Clone and Archive off without Customize Application, but not Export', async () => {
        canSave.mockResolvedValue(false);
        const el = await mount();
        expect(items(menus(el)[0]).map(i => i.disabled)).toEqual([undefined, true, false, true]);
        await pick(menus(el)[0], 'clone');
        expect($(el, 'c-grid-admin-row-dialog')).toBeNull();
    });

    it('opens the dialog for Clone and Archive, with the grid and every API name', async () => {
        listConfigs.mockResolvedValue(WITH_ARCHIVED);
        const el = await mount();
        await pick(menus(el)[0], 'archive');
        const dialog = $(el, 'c-grid-admin-row-dialog');
        expect(dialog.action).toBe('archive');
        expect(dialog.grid).toEqual({ name: 'Consignments', label: 'Consignments', usedBy: ['Accounts'] });
        expect(dialog.names).toEqual(['Consignments', 'Open_Cases', 'Consignments_2025']);
        dialog.dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect($(el, 'c-grid-admin-row-dialog')).toBeNull();
        await pick(menus(el)[1], 'clone');
        expect($(el, 'c-grid-admin-row-dialog').action).toBe('clone');
    });

    it('opens a clone in the editor once it is made, and says so', async () => {
        const el = await mount();
        const toasts = [];
        el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
        await pick(menus(el)[0], 'clone');
        $(el, 'c-grid-admin-row-dialog').dispatchEvent(
            new CustomEvent('done', { detail: { action: 'clone', configName: 'Copy_of_Consignments' } })
        );
        await settle();
        expect($(el, 'c-grid-admin-row-dialog')).toBeNull();
        expect(toasts).toEqual([
            { title: 'Grid cloned', message: 'Copy_of_Consignments is a copy of Consignments.', variant: 'success' }
        ]);
        expect($(el, 'c-grid-config-editor').configName).toBe('Copy_of_Consignments');
        expect(listConfigs).toHaveBeenCalledTimes(2);
    });

    it('leaves archived grids out of the list and the cards, and lists them under Archived grids', async () => {
        listConfigs.mockResolvedValue(WITH_ARCHIVED);
        const el = await mount();
        expect($(el, '.rh-admin-count').textContent).toBe('2 grids');
        expect($(el, '.rh-admin-stat-grids .rh-stat-n').textContent).toBe('2');
        expect($(el, '.rh-admin-stat-logging .rh-stat-n').textContent).toBe('1');
        expect($$(el, '.rh-admin-side-count').map(c => c.textContent)).toEqual(['2', '1', '1', '1']);

        await choose(el, '__archived__');
        expect($(el, '.rh-admin-count').textContent).toBe('1 archived grid');
        expect($(el, '.rh-admin-archived-note').textContent).toContain('Restore one to use it again');
        expect($$(el, '.rh-admin-open')).toEqual([]);
        expect($(el, '.rh-admin-archived-title').textContent).toBe('Consignments 2025');
        expect(items(menus(el)[0]).map(i => i.label)).toEqual(['Restore', 'Delete in Setup']);
        expect(items(menus(el)[0]).map(i => i.prefixIconName)).toEqual(['utility:undo', 'utility:delete']);

        await pick(menus(el)[0], 'setup');
        expect($(el, 'c-grid-admin-row-dialog').action).toBe('setup');
    });

    it('stays on Archived grids when the last archived grid is restored, and says there are none', async () => {
        listConfigs.mockResolvedValue(WITH_ARCHIVED);
        const el = await mount();
        await choose(el, '__archived__');
        await pick(menus(el)[0], 'restore');
        listConfigs.mockResolvedValue(WITH_ARCHIVED.map(c => ({ ...c, archived: false })));
        $(el, 'c-grid-admin-row-dialog').dispatchEvent(
            new CustomEvent('done', { detail: { action: 'restore', configName: 'Consignments_2025' } })
        );
        await settle();
        expect(side(el, '__archived__').getAttribute('aria-current')).toBe('page');
        expect($(el, '.rh-admin-no-archived')).not.toBeNull();
        expect($$(el, '.rh-admin-side-count').map(c => c.textContent)).toEqual(['3', '0', '1', '2']);
        expect($(el, 'c-grid-config-editor')).toBeNull();
    });
});

describe('export and import', () => {
    const draft = (name, objectApiName, children = []) => ({
        config: { name, label: name.replace(/_/g, ' '), isNew: false, archived: false, objectApiName },
        columns: [{ name: `${name}_Name`, field: 'Name' }],
        rules: [],
        filters: [],
        actions: [],
        children
    });
    const FILE = [
        draft('Consignment_Items', 'Consignment_Item__c'),
        draft('Consignments', 'Consignment__c', [{ name: 'Consignments_Items', childConfig: 'Consignment_Items' }])
    ];
    const menus = el => $$(el, '.rh-admin-row-menu');
    const pick = async (menu, value) => {
        menu.dispatchEvent(new CustomEvent('select', { detail: { value } }));
        await settle();
    };
    const listen = el => {
        const toasts = [];
        el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
        return toasts;
    };

    it('exports one grid from its menu, with the grid it shows as a child table', async () => {
        exportGrids.mockResolvedValue(FILE);
        const el = await mount();
        const toasts = listen(el);
        await pick(menus(el)[0], 'export');
        expect(exportGrids).toHaveBeenCalledWith({ configNames: ['Consignments'] });
        expect(downloadText).toHaveBeenCalledTimes(1);
        const [text, name, container, type] = downloadText.mock.calls[0];
        expect(name).toBe('Consignments.rowhouse.json');
        expect(container).toBe($(el, '.rh-admin-download'));
        expect(type).toBe('application/json');
        const file = JSON.parse(text);
        expect(file.kind).toBe('rowhouse-grids');
        expect(file.grids.map(g => g.config.name)).toEqual(['Consignment_Items', 'Consignments']);
        expect(file.grids[1].config.isNew).toBeUndefined();
        expect(toasts).toEqual([
            {
                title: 'Grids exported',
                message: 'Consignments.rowhouse.json: 2 grids, including 1 grid shown as a child table.',
                variant: 'success'
            }
        ]);
    });

    it('exports the grids the list shows, and not under Archived grids', async () => {
        exportGrids.mockResolvedValue([draft('Open_Cases', 'Case')]);
        const el = await mount();
        expect($(el, '.rh-admin-export').label).toBe('Export 2 grids');
        $(el, '.rh-admin-search').dispatchEvent(new CustomEvent('change', { detail: { value: 'open' } }));
        await settle();
        expect($(el, '.rh-admin-export').label).toBe('Export 1 grid');
        $(el, '.rh-admin-export').click();
        await settle();
        expect(exportGrids).toHaveBeenCalledWith({ configNames: ['Open_Cases'] });
        expect(downloadText.mock.calls[0][1]).toBe('Open_Cases.rowhouse.json');
        await choose(el, '__archived__');
        expect($(el, '.rh-admin-export')).toBeNull();
    });

    it('names a file of several grids by the date', async () => {
        exportGrids.mockResolvedValue(FILE.concat([draft('Open_Cases', 'Case')]));
        const el = await mount();
        $(el, '.rh-admin-export').click();
        await settle();
        expect(exportGrids).toHaveBeenCalledWith({ configNames: ['Consignments', 'Open_Cases'] });
        expect(downloadText.mock.calls[0][1]).toMatch(/^rowhouse-grids-\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('says when the browser refuses the file, or the server the export', async () => {
        exportGrids.mockResolvedValue(FILE);
        downloadText.mockReturnValueOnce(false);
        const el = await mount();
        const toasts = listen(el);
        await pick(menus(el)[0], 'export');
        exportGrids.mockRejectedValue({ body: { message: 'This needs the Rowhouse Grid Admin permission set.' } });
        await pick(menus(el)[1], 'export');
        expect(toasts).toEqual([
            {
                title: 'The grids were not exported',
                message: 'This browser did not allow the file to be downloaded.',
                variant: 'error'
            },
            {
                title: 'The grids were not exported',
                message: 'This needs the Rowhouse Grid Admin permission set.',
                variant: 'error'
            }
        ]);
    });

    it('opens Import, which needs what saving needs', async () => {
        const el = await mount();
        expect($(el, '.rh-admin-import').disabled).toBe(false);
        expect($(el, '.rh-admin-import').label).toBe('Import Grid');
        $(el, '.rh-admin-import').click();
        await settle();
        expect($(el, 'c-grid-admin-import-dialog')).not.toBeNull();
        const focus = jest.spyOn($(el, '.rh-admin-import'), 'focus');
        $(el, 'c-grid-admin-import-dialog').dispatchEvent(new CustomEvent('cancel', { detail: { imported: [] } }));
        await settle();
        expect($(el, 'c-grid-admin-import-dialog')).toBeNull();
        expect(focus).toHaveBeenCalledTimes(1);
        expect(listConfigs).toHaveBeenCalledTimes(1);
    });

    it('turns Import off without Customize Application', async () => {
        canSave.mockResolvedValue(false);
        const el = await mount();
        expect($(el, '.rh-admin-import').disabled).toBe(true);
        expect($(el, '.rh-admin-import').title).toBe('Importing grids needs the Customize Application permission');
    });

    it('brings the list up to date once grids are imported, and says which were left as they were', async () => {
        const el = await mount();
        const toasts = listen(el);
        $(el, '.rh-admin-import').click();
        await settle();
        $(el, 'c-grid-admin-import-dialog').dispatchEvent(
            new CustomEvent('done', { detail: { imported: ['Harbor Consignments'], skipped: ['Consignments'] } })
        );
        await settle();
        expect($(el, 'c-grid-admin-import-dialog')).toBeNull();
        expect(toasts).toEqual([
            {
                title: 'Grid imported',
                message:
                    'Harbor Consignments is under Available grids now. Consignments was already here and is left as before.',
                variant: 'success'
            }
        ]);
        expect(listConfigs).toHaveBeenCalledTimes(2);
    });

    it('brings the list up to date when the dialog closes after some grids were imported', async () => {
        const el = await mount();
        $(el, '.rh-admin-import').click();
        await settle();
        $(el, 'c-grid-admin-import-dialog').dispatchEvent(
            new CustomEvent('cancel', { detail: { imported: ['Harbor Items'] } })
        );
        await settle();
        expect(listConfigs).toHaveBeenCalledTimes(2);
    });
});
