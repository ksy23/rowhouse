import {
    viewFrom,
    parseView,
    asLayout,
    filtersOf,
    changesBetween,
    changedText,
    viewStore,
    withRecent,
    withViewState,
    onlyViews,
    pickerItems,
    whoSees,
    copyName,
    ADMIN_VIEW,
    MAX_RECENT,
    MAX_VIEW_STATES
} from 'c/gridSavedViews';

const COLUMNS = [
    { field: 'Name', label: 'Opportunity', type: 'text', filterable: true },
    { field: 'StageName', label: 'Stage', type: 'picklist', filterable: true },
    { field: 'Amount', label: 'Amount', type: 'currency', filterable: true },
    { field: 'Description', label: 'Description', type: 'textarea', filterable: false }
];

const STATE = {
    columnChoice: { order: ['Name', 'Amount', 'StageName'], hidden: ['StageName'] },
    frozen: 1,
    grouping: [{ field: 'StageName', unit: null }],
    groupView: { order: { by: 'name' }, percent: false },
    sort: [{ field: 'Amount', direction: 'desc' }],
    filters: [
        { field: 'StageName', operator: 'not_equals', value: 'Closed Won' },
        { field: 'Amount', operator: 'greater_than', value: '200000', valueTo: null }
    ],
    logic: '1 OR 2',
    chart: { type: 'hbar', measure: 'count', field: null, groupBy: 'StageName', unit: null },
    chartsOpen: true
};

describe('what a view keeps', () => {
    it('keeps the columns, frozen columns, grouping, sort, filters, logic and its chart in a list of one', () => {
        expect(viewFrom(STATE)).toEqual({
            v: 1,
            columns: STATE.columnChoice,
            frozen: 1,
            grouping: [{ field: 'StageName', unit: null }],
            sort: [{ field: 'Amount', direction: 'desc' }],
            filters: [
                { field: 'StageName', operator: 'not_equals', value: 'Closed Won', valueTo: null },
                { field: 'Amount', operator: 'greater_than', value: '200000', valueTo: null }
            ],
            logic: '1 OR 2',
            charts: [{ ...STATE.chart, open: true }]
        });
    });

    it("leaves out what is the admin's: no columns, no frozen columns, groups by name, no logic without filters", () => {
        const v = viewFrom({ grouping: [], sort: [], filters: [], logic: '1', chart: null });
        expect(v).toEqual({ v: 1, grouping: [], sort: [], filters: [], charts: [] });
        expect(viewFrom({ groupView: { order: { by: 'count', direction: 'desc' }, percent: true } }).groups).toEqual({
            order: { by: 'count', direction: 'desc' },
            percent: true
        });
    });

    it('reads what was saved, and nothing that is not a JSON object', () => {
        expect(parseView('{"v":1}')).toEqual({ v: 1 });
        expect(parseView({ v: 1 })).toEqual({ v: 1 });
        expect(parseView('[1,2]')).toBeNull();
        expect(parseView('not JSON')).toBeNull();
        expect(parseView('')).toBeNull();
    });

    it("hands a layout reader the view's own parts, its first chart as the layout's chart", () => {
        const layout = asLayout(viewFrom(STATE));
        expect(layout.sort).toEqual(STATE.sort);
        expect(layout.grouping).toEqual(STATE.grouping);
        expect(layout.columns).toEqual(STATE.columnChoice);
        expect(layout.frozen).toBe(1);
        expect(layout.chart).toEqual({ ...STATE.chart, open: true });
        expect(asLayout('{}')).toEqual({ grouping: [] });
    });

    it('keeps the filters that still fit the grid, and the logic only while every filter is left', () => {
        expect(filtersOf(viewFrom(STATE), COLUMNS)).toEqual({
            filters: viewFrom(STATE).filters,
            logic: '1 OR 2'
        });
        const gone = {
            ...viewFrom(STATE),
            filters: [...viewFrom(STATE).filters, { field: 'Description', operator: 'contains', value: 'x' }]
        };
        gone.logic = '1 OR 2 OR 3';
        expect(filtersOf(gone, COLUMNS)).toEqual({ filters: viewFrom(STATE).filters, logic: '' });
        expect(filtersOf({ filters: [{ field: 'Amount', operator: 'is_blank' }], logic: '1 AND' }, COLUMNS).logic).toBe(
            ''
        );
        expect(filtersOf({ filters: 'Amount' }, COLUMNS)).toEqual({ filters: [], logic: '' });
    });
});

describe('telling a change from the view as saved', () => {
    it("names what changed, and not the sort or whether the chart panel is open, which are each user's own", () => {
        const saved = viewFrom(STATE);
        expect(changesBetween(saved, viewFrom({ ...STATE, sort: [] }))).toEqual([]);
        expect(changesBetween(saved, viewFrom({ ...STATE, chartsOpen: false }))).toEqual([]);
        expect(changesBetween(saved, viewFrom({ ...STATE, frozen: null }))).toEqual(['columns']);
        expect(changesBetween(saved, viewFrom({ ...STATE, grouping: [] }))).toEqual(['grouping']);
        expect(changesBetween(saved, viewFrom({ ...STATE, logic: '1 AND 2' }))).toEqual(['filters']);
        expect(changesBetween(saved, viewFrom({ ...STATE, chart: { ...STATE.chart, type: 'donut' } }))).toEqual([
            'chart'
        ]);
        expect(changesBetween(saved, viewFrom({ ...STATE, grouping: [], filters: [], chart: null }))).toEqual([
            'grouping',
            'filters',
            'chart'
        ]);
    });

    it('says what changed in words', () => {
        expect(changedText(['filters'])).toBe('the filters');
        expect(changedText(['grouping', 'filters'])).toBe('the grouping and the filters');
        expect(changedText(['columns', 'grouping', 'chart'])).toBe('the columns, the grouping and the chart');
        expect(changedText([])).toBe('');
    });
});

describe("each user's own part", () => {
    it("reads the pin, the recent views and each view's own sort and unsaved change, and nothing else", () => {
        expect(viewStore({ pin: 'a01', recent: ['a01', 7, ''], views: { a01: { sort: [] }, a02: 'x' } })).toEqual({
            pin: 'a01',
            recent: ['a01', ''],
            views: { a01: { sort: [] } }
        });
        expect(viewStore(null)).toEqual({ pin: null, recent: [], views: {} });
    });

    it('keeps the views opened last, newest first, at most MAX_RECENT', () => {
        let recent = [];
        ['a', 'b', 'c', 'd', 'e', 'f', 'b'].forEach(id => {
            recent = withRecent(recent, id);
        });
        expect(recent).toEqual(['b', 'f', 'e', 'd', 'c']);
        expect(recent.length).toBe(MAX_RECENT);
    });

    it("sets one view's own sort and unsaved change, the latest last, and drops the oldest past MAX_VIEW_STATES", () => {
        let views = {};
        for (let i = 0; i < MAX_VIEW_STATES + 2; i++) views = withViewState(views, 'v' + i, { sort: [] });
        expect(Object.keys(views).length).toBe(MAX_VIEW_STATES);
        expect(views.v0).toBeUndefined();
        views = withViewState(views, 'v5', { sort: [{ field: 'Amount', direction: 'asc' }], draft: { v: 1 } });
        expect(Object.keys(views).pop()).toBe('v5');
        expect(views.v5).toEqual({ sort: [{ field: 'Amount', direction: 'asc' }], draft: { v: 1 } });
        views = withViewState(views, 'v5', null);
        expect(views.v5).toBeUndefined();
        expect(onlyViews({ a: {}, b: {} }, ['b'])).toEqual({ b: {} });
    });
});

describe('the picker', () => {
    const VIEWS = [
        { id: 'a03', name: 'Won this year', mine: false, ownerName: 'Priya Raman' },
        { id: 'a01', name: 'Closing this quarter', mine: true },
        { id: 'a02', name: 'Big deals over $200K', mine: false, ownerName: 'Marcus Webb' }
    ];

    it("lists Recent Views, the one shown first and ticked, then All Other Views A to Z, the admin's grid among them", () => {
        const lists = pickerItems({
            views: VIEWS,
            recent: ['a02', ADMIN_VIEW, 'gone'],
            currentId: 'a01',
            pinId: 'a02',
            gridTitle: 'Pipeline Review',
            term: ''
        });
        expect(lists.recent.map(i => [i.label, i.current, i.pinned])).toEqual([
            ['Closing this quarter', true, false],
            ['Big deals over $200K', false, true],
            ['Pipeline Review', false, false]
        ]);
        expect(lists.others.map(i => i.label)).toEqual(['Won this year']);
        expect(lists.recent[1].owner).toBe('Marcus Webb');
    });

    it("pins the admin's grid when nothing else is pinned, and a search narrows both lists", () => {
        const lists = pickerItems({
            views: VIEWS,
            recent: [],
            currentId: ADMIN_VIEW,
            gridTitle: 'Pipeline Review',
            term: 'DEAL'
        });
        expect(lists.recent).toEqual([]);
        expect(lists.others.map(i => i.label)).toEqual(['Big deals over $200K']);
        const all = pickerItems({ views: VIEWS, recent: [], currentId: ADMIN_VIEW, gridTitle: 'Pipeline Review' });
        expect(all.recent.map(i => [i.label, i.pinned])).toEqual([['Pipeline Review', true]]);
    });
});

describe('sharing and names', () => {
    it("says who sees a view, as the Grid Admin tab's Views list does", () => {
        expect(whoSees({ sharing: 'me', groups: [] })).toBe('Only the owner');
        expect(whoSees({ sharing: 'all', groups: [] })).toBe('All users');
        expect(
            whoSees({ sharing: 'groups', groups: [{ name: 'Sales New England' }, { name: 'Sales Managers' }] })
        ).toBe('2 groups: Sales New England, Sales Managers');
        expect(whoSees({ sharing: 'groups', groups: [{ name: 'CEO' }] })).toBe('1 group: CEO');
    });

    it('names a clone as Salesforce names a cloned list view, cut to 80 characters', () => {
        expect(copyName('Closing this quarter')).toBe('Copy of Closing this quarter');
        expect(copyName('x'.repeat(90)).length).toBe(80);
    });
});
