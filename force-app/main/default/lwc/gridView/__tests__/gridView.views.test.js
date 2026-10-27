/**
 * Saved views in the grid: the title as a picker, the pin, View Controls and
 * their dialogs, a changed view's Save, Save As and Revert, and what each
 * user keeps of their own (the pin, recent views, each view's sort and
 * unsaved change) with their layout of the grid as the admin built it.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import openGrid from '@salesforce/apex/GridController.openGrid';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import saveLayout from '@salesforce/apex/GridController.saveLayout';
import listViews from '@salesforce/apex/GridController.listViews';
import readView from '@salesforce/apex/GridController.readView';
import saveView from '@salesforce/apex/GridController.saveView';
import deleteView from '@salesforce/apex/GridController.deleteView';

jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.listViews', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.readView', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveView', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteView', () => ({ default: jest.fn() }), { virtual: true });

const COLUMNS = [
    { field: 'Name', label: 'Opportunity', type: 'text', sortable: true, filterable: true, isName: true },
    {
        field: 'StageName',
        label: 'Stage',
        type: 'picklist',
        sortable: true,
        groupable: true,
        filterable: true,
        options: [
            { value: 'Prospecting', label: 'Prospecting' },
            { value: 'Closed Won', label: 'Closed Won' }
        ]
    },
    { field: 'Amount', label: 'Amount', type: 'currency', sortable: true, filterable: true, scale: 2 }
];
const DEFINITION = {
    name: 'Pipeline_Review',
    label: 'Pipeline Review',
    objectApiName: 'Opportunity',
    objectLabel: 'Opportunities',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    columns: COLUMNS
};
const OPEN = { field: 'StageName', operator: 'not_equals', value: 'Closed Won', valueTo: null };
const BIG = { field: 'Amount', operator: 'greater_than', value: '200000', valueTo: null };
const KEPT = {
    v: 1,
    grouping: [{ field: 'StageName', unit: null }],
    sort: [{ field: 'Amount', direction: 'desc' }],
    filters: [OPEN],
    charts: []
};
const VIEW = {
    id: 'a00000000000001AAA',
    name: 'Open opportunities',
    ownerName: 'Abigail Coffin',
    mine: true,
    sharing: 'me',
    groups: [],
    view: JSON.stringify(KEPT)
};
const SHARED = {
    id: 'a00000000000002AAA',
    name: 'Big deals over $200K',
    ownerName: 'Marcus Webb',
    mine: false,
    view: JSON.stringify({ v: 1, grouping: [], sort: [], filters: [BIG], charts: [] })
};
const ROWS = [
    { Id: '006000000000001AAA', Name: 'Pyramid Emergency Generators', StageName: 'Prospecting', Amount: '100000' },
    { Id: '006000000000002AAA', Name: 'Edge SLA', StageName: 'Closed Won', Amount: '60000' }
];
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length });

const settle = async () => {
    for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const table = el => $(el, 'c-grid-table');
const tableConfig = el => table(el).config;
const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0];
const keptLayout = () => JSON.parse(lastCall(saveLayout).layout);
const flushLayout = async () => {
    jest.runAllTimers();
    await settle();
};

/** openGrid's answer: the admin's grid, or a pinned view with the server's reading of its start. */
function opened({ layout = null, view = null, start = null } = {}) {
    return {
        definition: DEFINITION,
        diagnostics: false,
        canConfigure: false,
        layout,
        view,
        start: start || { sortField: 'Name', sortDirection: 'asc', groupBy: [] },
        page: page(ROWS)
    };
}

function mount() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Pipeline_Review';
    document.body.appendChild(el);
    return el;
}

async function pick(el, label) {
    $(el, '.rh-view-picker').click();
    await settle();
    const item = $$(el, '.rh-view-item').find(b => b.textContent.includes(label));
    item.click();
    await settle();
}

beforeEach(() => {
    jest.useFakeTimers();
    openGrid.mockResolvedValue(opened());
    fetchRows.mockResolvedValue(page(ROWS));
    summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: false });
    saveLayout.mockResolvedValue(true);
    listViews.mockResolvedValue({ views: [VIEW, SHARED], canShare: true });
    readView.mockImplementation(({ viewId }) => Promise.resolve(viewId === VIEW.id ? VIEW : SHARED));
    saveView.mockImplementation(({ viewId, name, view }) =>
        Promise.resolve({ ...VIEW, id: viewId || 'a00000000000009AAA', name: name || VIEW.name, view })
    );
    deleteView.mockResolvedValue(undefined);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('the title as a view picker', () => {
    it("names the grid as the admin built it, pinned when no view is, and lists the grid's views as a list view does", async () => {
        const el = mount();
        await settle();
        expect($(el, '.rh-view-name').textContent).toBe('Pipeline Review');
        expect($(el, '.rh-view-grid')).toBeNull();
        expect($(el, '.rh-view-picker').getAttribute('aria-label')).toBe('Pipeline Review, select a view');
        expect($(el, '.rh-view-pin').alternativeText).toBe('This view is pinned.');
        $(el, '.rh-view-picker').click();
        await settle();
        expect(listViews).toHaveBeenCalledWith({ configName: 'Pipeline_Review' });
        expect($$(el, '.rh-view-section').map(h => h.textContent)).toEqual(['Recent Views', 'All Other Views']);
        expect($$(el, '.rh-view-item').map(b => b.textContent.trim())).toEqual([
            'Pipeline Review (Pinned view)',
            'Big deals over $200K',
            'Open opportunities'
        ]);
        const search = $(el, '.rh-view-search');
        search.value = 'deal';
        search.dispatchEvent(new CustomEvent('input'));
        await settle();
        expect($$(el, '.rh-view-item').map(b => b.textContent.trim())).toEqual(['Big deals over $200K']);
        jest.useRealTimers(); // axe needs real timers
        await expect(el).toBeAccessible();
    });

    it("shows a view with what it keeps, after the grid's name on the same line, and reads the rows again", async () => {
        const el = mount();
        await settle();
        fetchRows.mockClear();
        await pick(el, 'Open opportunities');
        expect(readView).toHaveBeenCalledWith({ configName: 'Pipeline_Review', viewId: VIEW.id });
        expect($(el, '.rh-view-name').textContent).toBe('Open opportunities');
        // On one line, the grid's name where it was, so nothing moves.
        expect($(el, '.rh-view-grid').textContent).toBe('Pipeline Review');
        expect($(el, '.rh-view-sep').textContent).toBe('›');
        expect($(el, '.rh-view-picker').getAttribute('aria-label')).toBe(
            'Pipeline Review › Open opportunities, select a view'
        );
        const call = lastCall(fetchRows);
        expect(call.filters).toEqual([OPEN]);
        expect(call.sortField).toBe('Amount');
        expect(call.groupBy).toEqual(['StageName']);
        expect(tableConfig(el).filters).toEqual([OPEN]);
        expect($(el, '.rh-filtered').textContent).toBe('Filtered by Stage');
        expect($(el, '.rh-view-changed')).toBeNull();
        expect($(el, '.rh-reset-layout')).toBeNull();
    });

    it('says whose a shared view is, and offers Save As but not Save on a change to it', async () => {
        const el = mount();
        await settle();
        await pick(el, 'Big deals');
        expect($(el, '.rh-shared-by').textContent).toBe('Shared by Marcus Webb');
        table(el).dispatchEvent(new CustomEvent('filterchange', { detail: { filters: [] } }));
        await settle();
        expect($(el, '.rh-view-changed-text').textContent).toBe('You changed this view: the filters.');
        expect($(el, '.rh-view-save-as')).not.toBeNull();
        expect($(el, '.rh-view-save')).toBeNull();
        const controls = $$(el, '.rh-view-controls lightning-menu-item');
        expect(controls.map(m => [m.label, m.disabled])).toEqual([
            ['New', false],
            ['Clone', false],
            ['Rename', true],
            ['Sharing Settings', true],
            ['Select Fields to Display', false],
            ['Delete', true],
            ['Reset Column Sorting', false],
            ['Reset Column Widths', false]
        ]);
    });
});

describe('a changed view', () => {
    it('Save keeps the view as shown now; the change bar goes', async () => {
        const el = mount();
        await settle();
        await pick(el, 'Open opportunities');
        table(el).dispatchEvent(new CustomEvent('groupchange', { detail: { grouping: [] } }));
        await settle();
        expect($(el, '.rh-view-changed-text').textContent).toBe('You changed this view: the grouping.');
        $(el, '.rh-view-save').click();
        await settle();
        const sent = lastCall(saveView);
        expect(sent.viewId).toBe(VIEW.id);
        expect(sent.name).toBeNull();
        expect(JSON.parse(sent.view)).toMatchObject({ grouping: [], filters: [OPEN] });
        expect($(el, '.rh-view-changed')).toBeNull();
    });

    it('Revert puts the view back as saved, and keeps the sort the user chose', async () => {
        const el = mount();
        await settle();
        await pick(el, 'Open opportunities');
        table(el).dispatchEvent(
            new CustomEvent('sortchange', { detail: { sort: [{ field: 'Name', direction: 'asc' }] } })
        );
        table(el).dispatchEvent(new CustomEvent('filterchange', { detail: { filters: [OPEN, BIG] } }));
        await settle();
        expect($(el, '.rh-view-changed-text').textContent).toBe('You changed this view: the filters.');
        $(el, '.rh-view-revert').click();
        await settle();
        expect(tableConfig(el).filters).toEqual([OPEN]);
        expect($(el, '.rh-view-changed')).toBeNull();
        expect(lastCall(fetchRows).sortField).toBe('Name');
    });

    it("keeps an unsaved change and the user's own sort with their layout; the admin's grid's own layout stays", async () => {
        openGrid.mockResolvedValue(
            opened({
                layout: JSON.stringify({
                    v: 1,
                    sort: [{ field: 'Amount', direction: 'asc' }],
                    grouping: [],
                    widths: { Name: 220 }
                })
            })
        );
        const el = mount();
        await settle();
        await pick(el, 'Open opportunities');
        table(el).dispatchEvent(new CustomEvent('filterchange', { detail: { filters: [OPEN, BIG] } }));
        await settle();
        await flushLayout();
        const kept = keptLayout();
        // The admin's grid as this user left it.
        expect(kept.sort).toEqual([{ field: 'Amount', direction: 'asc' }]);
        expect(kept.grouping).toEqual([]);
        expect(kept.widths).toEqual({ Name: 220 });
        // Their own part of the views.
        expect(kept.recent).toEqual([VIEW.id, '']);
        expect(kept.views[VIEW.id].sort).toEqual([{ field: 'Amount', direction: 'desc' }]);
        expect(kept.views[VIEW.id].draft.filters).toEqual([OPEN, BIG]);
        expect(kept.pin).toBeUndefined();
        // Back on the admin's grid: its sort, no filters.
        await pick(el, 'Pipeline Review');
        expect(lastCall(fetchRows).sortField).toBe('Amount');
        expect(tableConfig(el).filters).toEqual([]);
    });
});

describe('opening on a pinned view', () => {
    it('opens on the view the server read, with its unsaved change, and uses the first page that came with it', async () => {
        const draft = { ...KEPT, filters: [OPEN, BIG], logic: '1 OR 2' };
        openGrid.mockResolvedValue(
            opened({
                layout: JSON.stringify({ v: 1, sort: [], grouping: [], pin: VIEW.id, views: { [VIEW.id]: { draft } } }),
                view: VIEW,
                start: {
                    sortField: 'Amount',
                    sortDirection: 'desc',
                    groupBy: ['StageName'],
                    filters: [OPEN, BIG],
                    logic: '1 OR 2',
                    notes: []
                }
            })
        );
        const el = mount();
        await settle();
        expect($(el, '.rh-view-name').textContent).toBe('Open opportunities');
        expect($(el, '.rh-view-pin').alternativeText).toBe('This view is pinned.');
        expect(fetchRows).not.toHaveBeenCalled();
        expect(tableConfig(el).filters).toEqual([OPEN, BIG]);
        expect(tableConfig(el).filterLogic).toBe('1 OR 2');
        expect($(el, '.rh-view-changed-text').textContent).toBe('You changed this view: the filters.');
    });

    it("tells the user when a view's filter no longer fits the grid", async () => {
        openGrid.mockResolvedValue(
            opened({
                layout: JSON.stringify({ v: 1, pin: VIEW.id }),
                view: VIEW,
                start: {
                    sortField: 'Amount',
                    sortDirection: 'desc',
                    groupBy: ['StageName'],
                    filters: [OPEN],
                    logic: null,
                    notes: ['Cannot filter by Weight__c.']
                }
            })
        );
        const el = mount();
        await settle();
        expect($(el, '.rh-notice').textContent).toBe('Cannot filter by Weight__c.');
    });

    it('pins a view, and a pinned view that is gone is unpinned quietly', async () => {
        const el = mount();
        await settle();
        await pick(el, 'Open opportunities');
        expect($(el, '.rh-view-pin').alternativeText).toBe('Pin this view.');
        $(el, '.rh-view-pin').click();
        await settle();
        await flushLayout();
        expect(keptLayout().pin).toBe(VIEW.id);
        expect($(el, '.rh-view-pin').alternativeText).toBe('This view is pinned.');
        el.remove();
        openGrid.mockResolvedValue(opened({ layout: JSON.stringify({ v: 1, pin: VIEW.id }), view: null }));
        const again = mount();
        await settle();
        expect($(again, '.rh-view-name').textContent).toBe('Pipeline Review');
        expect($(again, '.rh-notice')).toBeNull();
    });
});

describe('View Controls', () => {
    it("New saves a view that starts as the admin's grid, shows it and opens Filters", async () => {
        const el = mount();
        await settle();
        $(el, '.rh-view-controls').dispatchEvent(new CustomEvent('select', { detail: { value: 'viewNew' } }));
        await settle();
        const dialog = $(el, 'c-grid-view-dialog');
        expect(dialog.mode).toBe('new');
        expect(dialog.canShare).toBe(true);
        dialog.dispatchEvent(
            new CustomEvent('save', { detail: { name: 'Closing this quarter', shareMode: 'me', groupIds: [] } })
        );
        await settle();
        const sent = lastCall(saveView);
        expect(sent.viewId).toBeNull();
        expect(sent.name).toBe('Closing this quarter');
        expect(JSON.parse(sent.view)).toEqual({
            v: 1,
            grouping: [],
            sort: [{ field: 'Name', direction: 'asc' }],
            filters: [],
            charts: []
        });
        expect($(el, 'c-grid-view-dialog')).toBeNull();
        expect($(el, 'c-grid-filters-panel')).not.toBeNull();
        expect($(el, '.rh-view-name').textContent).toBe('Closing this quarter');
    });

    it('Clone starts from "Copy of" and saves the view as shown; a refusal stays in the dialog', async () => {
        const el = mount();
        await settle();
        await pick(el, 'Open opportunities');
        $(el, '.rh-view-controls').dispatchEvent(new CustomEvent('select', { detail: { value: 'viewClone' } }));
        await settle();
        expect($(el, 'c-grid-view-dialog').name).toBe('Copy of Open opportunities');
        saveView.mockRejectedValueOnce({ body: { message: 'You already have a view named "Mine" of this grid.' } });
        $(el, 'c-grid-view-dialog').dispatchEvent(
            new CustomEvent('save', { detail: { name: 'Mine', shareMode: 'me' } })
        );
        await settle();
        expect($(el, 'c-grid-view-dialog').error).toBe('You already have a view named "Mine" of this grid.');
        $(el, 'c-grid-view-dialog').dispatchEvent(
            new CustomEvent('save', { detail: { name: 'Mine too', shareMode: 'me' } })
        );
        await settle();
        expect(JSON.parse(lastCall(saveView).view).filters).toEqual([OPEN]);
        expect($(el, '.rh-view-name').textContent).toBe('Mine too');
    });

    it("Delete removes the user's own view and goes back to the admin's grid, unpinning it", async () => {
        openGrid.mockResolvedValue(
            opened({
                layout: JSON.stringify({ v: 1, pin: VIEW.id }),
                view: VIEW,
                start: { sortField: 'Amount', sortDirection: 'desc', groupBy: ['StageName'], filters: [OPEN] }
            })
        );
        const el = mount();
        await settle();
        $(el, '.rh-view-controls').dispatchEvent(new CustomEvent('select', { detail: { value: 'viewDelete' } }));
        await settle();
        $(el, 'c-grid-view-dialog').dispatchEvent(new CustomEvent('delete'));
        await settle();
        expect(deleteView).toHaveBeenCalledWith({ configName: 'Pipeline_Review', viewId: VIEW.id });
        expect($(el, '.rh-view-name').textContent).toBe('Pipeline Review');
        await flushLayout();
        expect(keptLayout().pin).toBeUndefined();
    });

    it("Reset Column Sorting puts back the view's own sort", async () => {
        const el = mount();
        await settle();
        await pick(el, 'Open opportunities');
        table(el).dispatchEvent(
            new CustomEvent('sortchange', { detail: { sort: [{ field: 'Name', direction: 'desc' }] } })
        );
        await settle();
        $(el, '.rh-view-controls').dispatchEvent(new CustomEvent('select', { detail: { value: 'resetSort' } }));
        await settle();
        expect(lastCall(fetchRows).sortField).toBe('Amount');
        expect(tableConfig(el).userLayout.sort).toEqual([{ field: 'Amount', direction: 'desc' }]);
    });
});

describe('a child table', () => {
    it('has no views: its title is plain, and there are no View Controls or Filters', async () => {
        const el = createElement('c-grid-view', { is: GridView });
        el.configName = 'Pipeline_Review';
        el.parent = { link: 'Accounts_Opportunities', id: '001000000000001AAA', name: 'Edge Communications', level: 2 };
        document.body.appendChild(el);
        await settle();
        expect($(el, '.rh-view-picker')).toBeNull();
        expect($(el, '.rh-view-controls')).toBeNull();
        expect($(el, '.rh-filters-toggle')).toBeNull();
    });
});
