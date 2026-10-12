/**
 * gridChildren: an open row's panel, one tab per child table, each a
 * c/gridView of its own limited to the row's records. The child grids'
 * configuration never arrives here (getGridConfig stays pending): only what
 * the panel hands them is under test.
 */
import { createElement } from 'lwc';
import GridChildren from 'c/gridChildren';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import { openGridFrom } from '../../gridView/__tests__/openGridFrom';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const TABS = [
    { name: 'Nest_Accounts_Contacts', label: 'Contacts', configName: 'Nest_Contacts' },
    { name: 'Nest_Accounts_Records', label: 'Consignments', configName: 'Consignments' }
];
const PARENT_ID = '001000000000001AAA';

let el;
const mount = async (props = {}) => {
    el = createElement('c-grid-children', { is: GridChildren });
    Object.assign(el, { tabs: TABS, parentId: PARENT_ID, parentName: 'Casco Bay Marine', level: 2, ...props });
    document.body.appendChild(el);
    await flush();
};
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    getGridConfig.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('gridChildren', () => {
    it('shows one tab per child table, in order, each with its own grid', async () => {
        await mount();
        const tabs = $$('lightning-tab');
        expect(tabs.map(t => t.label)).toEqual(['Contacts', 'Consignments']);
        expect(tabs.map(t => t.value)).toEqual(['Nest_Accounts_Contacts', 'Nest_Accounts_Records']);
        const views = $$('c-grid-view');
        expect(views.map(v => v.configName)).toEqual(['Nest_Contacts', 'Consignments']);
    });

    it('limits each grid to the open row, through its own link, one level down', async () => {
        await mount();
        const views = $$('c-grid-view');
        expect(views[0].parent).toEqual({
            link: 'Nest_Accounts_Contacts',
            id: PARENT_ID,
            name: 'Casco Bay Marine',
            level: 2,
            height: null
        });
        expect(views[1].parent).toEqual({
            link: 'Nest_Accounts_Records',
            id: PARENT_ID,
            name: 'Casco Bay Marine',
            level: 2,
            height: null
        });
        expect(getGridConfig).toHaveBeenCalledWith({ configName: 'Nest_Contacts' });
    });

    it('names the panel for the row it belongs to', async () => {
        await mount();
        expect(el.shadowRoot.querySelector('section').getAttribute('aria-label')).toBe(
            'Related records for Casco Bay Marine'
        );
        el.parentName = '';
        await flush();
        expect(el.shadowRoot.querySelector('section').getAttribute('aria-label')).toBe('Related records');
    });

    it('hands each grid the same parent object until something changes (HR-17)', async () => {
        await mount();
        const before = $$('c-grid-view')[0].parent;
        el.level = 2;
        await flush();
        expect($$('c-grid-view')[0].parent).toBe(before);
        el.parentId = '001000000000002AAA';
        await flush();
        expect($$('c-grid-view')[0].parent).not.toBe(before);
        expect($$('c-grid-view')[0].parent.id).toBe('001000000000002AAA');
    });

    it('shows nothing for no tabs', async () => {
        await mount({ tabs: null });
        expect($$('lightning-tab')).toHaveLength(0);
    });

    it("focus() goes to the open tab's grid: the first until another tab opens", async () => {
        await mount();
        const [first, second] = $$('c-grid-view');
        const one = jest.spyOn(first, 'focus');
        const two = jest.spyOn(second, 'focus');
        el.focus();
        expect(one).toHaveBeenCalledTimes(1);
        // The second tab opens; the first keeps its grid.
        $$('lightning-tab')[1].dispatchEvent(new CustomEvent('active'));
        el.focus();
        expect(two).toHaveBeenCalledTimes(1);
        expect(one).toHaveBeenCalledTimes(1);
    });
});

describe('gridChildren details', () => {
    afterEach(() => {
        delete global.ResizeObserver;
    });

    it("puts each tab's count in its label, as a related list does", async () => {
        await mount({ counts: { Nest_Accounts_Contacts: 3, Nest_Accounts_Records: 0 } });
        expect($$('lightning-tab').map(t => t.label)).toEqual(['Contacts (3)', 'Consignments (0)']);
    });

    it('opens on the first tab with records, not an empty one', async () => {
        await mount({ counts: { Nest_Accounts_Contacts: 0, Nest_Accounts_Records: 2 } });
        expect(el.shadowRoot.querySelector('lightning-tabset').activeTabValue).toBe('Nest_Accounts_Records');
        // Its grid is the one Enter goes into, until another tab opens.
        const second = jest.spyOn($$('c-grid-view')[1], 'focus');
        el.focus();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('opens on the first tab when none has records, or the counts are not known yet', async () => {
        await mount({ counts: { Nest_Accounts_Contacts: 0, Nest_Accounts_Records: 0 } });
        expect(el.shadowRoot.querySelector('lightning-tabset').activeTabValue).toBe('Nest_Accounts_Contacts');
        while (document.body.firstChild) document.body.firstChild.remove();
        await mount();
        expect(el.shadowRoot.querySelector('lightning-tabset').activeTabValue).toBe('Nest_Accounts_Contacts');
    });

    it('decides once: counts arriving pick the tab, a tab emptied later does not move it', async () => {
        await mount();
        el.counts = { Nest_Accounts_Contacts: 0, Nest_Accounts_Records: 2 };
        await flush();
        const tabset = el.shadowRoot.querySelector('lightning-tabset');
        expect(tabset.activeTabValue).toBe('Nest_Accounts_Records');
        // Its records are deleted: the server's counts now say the other tab has them.
        el.counts = { Nest_Accounts_Contacts: 3, Nest_Accounts_Records: 0 };
        await flush();
        expect(tabset.activeTabValue).toBe('Nest_Accounts_Records');
    });

    it('shows the plain label while the count is not known', async () => {
        await mount({ counts: { Nest_Accounts_Contacts: 3 } });
        expect($$('lightning-tab').map(t => t.label)).toEqual(['Contacts (3)', 'Consignments']);
    });

    it("follows the tab's own grid once it reports its count, and tells the parent row", async () => {
        await mount({ counts: { Nest_Accounts_Contacts: 3 } });
        const heard = jest.fn();
        el.addEventListener('childcount', heard);
        $$('c-grid-view')[0].dispatchEvent(new CustomEvent('countchange', { detail: { count: 5 } }));
        await flush();
        expect($$('lightning-tab')[0].label).toBe('Contacts (5)');
        expect(heard).toHaveBeenCalledTimes(1);
        expect(heard.mock.calls[0][0].detail).toEqual({ tab: 'Nest_Accounts_Contacts', count: 5 });
        // The same count again is no change.
        $$('c-grid-view')[0].dispatchEvent(new CustomEvent('countchange', { detail: { count: 5 } }));
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('reports its own height when it changes, on its own root (HR-24)', async () => {
        const observed = [];
        let fire;
        global.ResizeObserver = class {
            constructor(cb) {
                fire = cb;
            }
            observe(target) {
                observed.push(target);
            }
            disconnect() {}
        };
        await mount();
        const section = el.shadowRoot.querySelector('section');
        expect(observed).toEqual([section]);
        const heard = jest.fn();
        el.addEventListener('panelsize', heard);
        section.getBoundingClientRect = () => ({ height: 212.4 });
        fire();
        expect(heard.mock.calls[0][0].detail).toEqual({ height: 213 });
        fire(); // no change: nothing said
        section.getBoundingClientRect = () => ({ height: 213.6 });
        fire(); // within a pixel: nothing said
        expect(heard).toHaveBeenCalledTimes(1);
        section.getBoundingClientRect = () => ({ height: 400 });
        fire();
        expect(heard).toHaveBeenCalledTimes(2);
    });

    it('measures nothing without ResizeObserver: the panel keeps its full height (HR-23)', async () => {
        delete global.ResizeObserver;
        const heard = jest.fn();
        await mount();
        el.addEventListener('panelsize', heard);
        await flush();
        expect(heard).not.toHaveBeenCalled();
    });
});
