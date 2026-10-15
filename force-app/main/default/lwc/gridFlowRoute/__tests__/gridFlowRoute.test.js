/**
 * The hand-over of a screen flow to its own page and back, as plain
 * functions: what travels in the address, what in session storage, what
 * the page reads back, and which pages it may go back to.
 */
import {
    FLOW_PAGE,
    IDS_IN_URL,
    STORE_PREFIX,
    BACK_TYPES,
    namespaceOf,
    packageNamespace,
    newToken,
    safeBack,
    backRef,
    flowPageRef,
    readFlowState,
    forget,
    withDone,
    doneToken,
    flowInputs,
    QUICK_PATH,
    quickActionUrl,
    isQuickActionPath
} from 'c/gridFlowRoute';

const id = n => 'a01' + String(n).padStart(15, '0');
const PAGE = {
    type: 'standard__recordPage',
    attributes: { recordId: '001000000000001AAA', actionName: 'view' },
    state: { c__tab: 'Consignments' }
};
const WEB = { type: 'standard__webPage', attributes: { url: 'https://granite-coast-login.net/verify' } };
const memory = () => {
    const kept = new Map();
    return {
        getItem: k => (kept.has(k) ? kept.get(k) : null),
        setItem: (k, v) => kept.set(k, String(v)),
        removeItem: k => kept.delete(k),
        kept
    };
};

describe('the namespace, and a token', () => {
    it("reads the namespace from a component's own element when the package has none", () => {
        expect(namespaceOf({ tagName: 'C-GRID-VIEW' })).toBe('c');
        expect(namespaceOf({ tagName: 'ROWHOUSE-GRID-VIEW' })).toBe('rowhouse');
        expect(namespaceOf(null)).toBe('c');
    });

    it("takes the package's namespace from its logo's address", () => {
        // In the package a nested component is still tagged c-, so the
        // address of the package's own static resource tells the namespace.
        expect(packageNamespace('/resource/1760000000000/rowhouse__RowhouseLogo')).toBe('rowhouse');
        expect(packageNamespace('/sfsites/c/resource/1760000000000/rowhouse__RowhouseLogo')).toBe('rowhouse');
        expect(packageNamespace('/resource/1760000000000/gcf_ops__RowhouseLogo')).toBe('gcf_ops');
        expect(packageNamespace('/resource/1760000000000/RowhouseLogo')).toBe('');
        expect(packageNamespace('/resource/1760000000000/rowhouse__RowhouseMark')).toBe('');
        expect(packageNamespace('RowhouseLogo')).toBe('');
        expect(packageNamespace(undefined)).toBe('');
    });

    it('makes a fresh token each time', () => {
        const a = newToken();
        expect(a).toMatch(/^[a-z0-9]{8,}$/);
        expect(newToken()).not.toBe(a);
    });
});

describe('the way back', () => {
    it('is a plain copy of the page, without an earlier marker', () => {
        const ref = backRef({ ...PAGE, state: { ...PAGE.state, c__flowDone: 'k7m2q9xd' } }, 'c');
        expect(ref).toEqual(PAGE);
        expect(backRef(null, 'c')).toBeNull();
    });

    it('is marked with the token, which the grid reads back', () => {
        const back = withDone(PAGE, 'c', 'tok1');
        expect(back.state).toEqual({ c__tab: 'Consignments', c__flowDone: 'tok1' });
        expect(PAGE.state.c__flowDone).toBeUndefined(); // not changed
        expect(doneToken(back, 'c')).toBe('tok1');
        expect(doneToken(PAGE, 'c')).toBe('');
        expect(withDone(null, 'c', 't')).toBeNull();
    });
});

describe('only a Salesforce page is a way back', () => {
    const PAGES = {
        standard__navItemPage: { attributes: { apiName: 'Rowhouse_Dev' } },
        standard__recordPage: { attributes: { recordId: '001000000000001AAA', actionName: 'view' } },
        standard__objectPage: { attributes: { objectApiName: 'Account', actionName: 'list' } },
        standard__namedPage: { attributes: { pageName: 'home' } },
        standard__app: { attributes: { appTarget: 'c__Rowhouse' } },
        standard__recordRelationshipPage: {
            attributes: { recordId: '001000000000001AAA', relationshipApiName: 'Contacts', actionName: 'view' }
        }
    };

    it.each(Object.keys(PAGES))('keeps %s, as a plain copy', type => {
        const ref = { type, ...PAGES[type], state: { c__grid: 'Consignments' } };
        const kept = safeBack(ref);
        expect(kept).toEqual(ref);
        expect(kept).not.toBe(ref);
        expect(kept.state).not.toBe(ref.state);
    });

    it('allows exactly those six kinds of page', () => {
        expect([...BACK_TYPES].sort()).toEqual(Object.keys(PAGES).sort());
    });

    it('gives a page with no attributes or state empty ones', () => {
        expect(safeBack({ type: 'standard__namedPage' })).toEqual({
            type: 'standard__namedPage',
            attributes: {},
            state: {}
        });
    });

    it.each([
        ['a web address', WEB],
        [
            'a component, with any state',
            { type: 'standard__component', attributes: { componentName: 'c__payrollExport' } }
        ],
        ['an Experience Cloud page', { type: 'comm__namedPage', attributes: { name: 'Home' } }],
        [
            'a Knowledge article',
            { type: 'standard__knowledgeArticlePage', attributes: { urlName: 'reset-your-password' } }
        ],
        ['a made-up kind', { type: 'standard__webPageX', attributes: {} }]
    ])('refuses %s', (label, ref) => {
        expect(safeBack(ref)).toBeNull();
    });

    it.each([
        ['nothing', undefined],
        ['null', null],
        ['text', 'standard__namedPage'],
        ['a list', [PAGE]],
        ['no kind', { attributes: { pageName: 'home' } }],
        ['a kind that is not text', { type: ['standard__namedPage'] }],
        ['attributes that are text', { type: 'standard__namedPage', attributes: 'home' }],
        ['attributes that are a list', { type: 'standard__namedPage', attributes: ['home'] }],
        ['state that is text', { type: 'standard__namedPage', attributes: {}, state: 'c__tab=Consignments' }]
    ])('refuses %s', (label, ref) => {
        expect(safeBack(ref)).toBeNull();
    });

    it("checks an app page's page inside it too", () => {
        const app = { type: 'standard__app', attributes: { appTarget: 'c__Rowhouse', pageRef: PAGE }, state: {} };
        expect(safeBack(app)).toEqual(app);
        expect(safeBack({ ...app, attributes: { appTarget: 'c__Rowhouse', pageRef: WEB } })).toBeNull();
        expect(safeBack({ ...app, attributes: { appTarget: 'c__Rowhouse', pageRef: 'Consignments' } })).toBeNull();
        expect(safeBack({ ...app, attributes: { appTarget: 'c__Rowhouse', pageRef: app } })).toBeNull(); // one level only
        expect(safeBack({ ...PAGE, attributes: { ...PAGE.attributes, pageRef: PAGE } })).toBeNull();
    });
});

describe('the address', () => {
    it(`keeps the Ids and the way back in the tab, and carries up to ${IDS_IN_URL} Ids, never the way back`, () => {
        const store = memory();
        const ref = flowPageRef(
            'c',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'row', ids: [id(1)], back: PAGE, token: 't1' },
            store
        );
        expect(ref).toEqual({
            type: 'standard__component',
            attributes: { componentName: `c__${FLOW_PAGE}` },
            state: {
                c__grid: 'Consignments',
                c__action: 'Reschedule_Pickup',
                c__on: 'row',
                c__token: 't1',
                c__ids: id(1)
            }
        });
        expect(JSON.parse(store.getItem(STORE_PREFIX + 't1'))).toEqual({ ids: [id(1)], back: PAGE });
    });

    it(`carries up to ${IDS_IN_URL} Ids and the way back when there is no session storage`, () => {
        const ref = flowPageRef(
            'c',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'row', ids: [id(1)], back: PAGE, token: 't1' },
            null
        );
        expect(ref.state).toEqual({
            c__grid: 'Consignments',
            c__action: 'Reschedule_Pickup',
            c__on: 'row',
            c__token: 't1',
            c__ids: id(1),
            c__back: JSON.stringify(PAGE)
        });
    });

    it('never keeps or carries a web address as the way back', () => {
        const store = memory();
        const run = {
            grid: 'Consignments',
            action: 'Reschedule_Pickup',
            on: 'row',
            ids: [id(1)],
            back: WEB,
            token: 't1'
        };
        flowPageRef('c', run, store);
        expect(JSON.parse(store.getItem(STORE_PREFIX + 't1')).back).toBeNull();
        expect(flowPageRef('c', run, null).state.c__back).toBeUndefined();
    });

    it('keeps more Ids in session storage, under the token', () => {
        const store = memory();
        const ids = Array.from({ length: IDS_IN_URL + 1 }, (_, i) => id(i));
        const ref = flowPageRef(
            'rowhouse',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'selection', ids, back: PAGE, token: 't2' },
            store
        );
        expect(ref.attributes.componentName).toBe(`rowhouse__${FLOW_PAGE}`);
        expect(ref.state).toEqual({
            rowhouse__grid: 'Consignments',
            rowhouse__action: 'Reschedule_Pickup',
            rowhouse__on: 'selection',
            rowhouse__token: 't2'
        });
        expect(JSON.parse(store.getItem(STORE_PREFIX + 't2'))).toEqual({ ids, back: PAGE });
    });

    it('has nowhere to go with many Ids and no storage', () => {
        const broken = {
            setItem: () => {
                throw new Error('QuotaExceeded');
            }
        };
        const ids = Array.from({ length: IDS_IN_URL + 1 }, (_, i) => id(i));
        expect(
            flowPageRef(
                'c',
                { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'selection', ids, token: 't' },
                broken
            )
        ).toBeNull();
        expect(
            flowPageRef(
                'c',
                { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'selection', ids, token: 't' },
                null
            )
        ).toBeNull();
    });

    it('drops anything that is not a record Id', () => {
        const ref = flowPageRef(
            'c',
            {
                grid: 'Consignments',
                action: 'Reschedule_Pickup',
                on: 'row',
                ids: [id(1), 'PRO-1001,PRO-1002', ''],
                token: 't'
            },
            memory()
        );
        expect(ref.state.c__ids).toBe(id(1));
    });
});

describe('what the page reads', () => {
    it('reads what this tab kept, and says the run came from this tab', () => {
        const store = memory();
        const state = flowPageRef(
            'c',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'row', ids: [id(7)], back: PAGE, token: 't' },
            store
        ).state;
        expect(readFlowState(state, store)).toEqual({
            grid: 'Consignments',
            action: 'Reschedule_Pickup',
            on: 'row',
            ids: [id(7)],
            back: PAGE,
            token: 't',
            fromThisTab: true
        });
    });

    it('reads a link from somewhere else from the address, and says it did not come from this tab', () => {
        const state = flowPageRef(
            'c',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'row', ids: [id(7)], back: PAGE, token: 't' },
            null
        ).state;
        expect(readFlowState(state, memory())).toEqual({
            grid: 'Consignments',
            action: 'Reschedule_Pickup',
            on: 'row',
            ids: [id(7)],
            back: PAGE,
            token: 't',
            fromThisTab: false
        });
        expect(readFlowState(state, null).fromThisTab).toBe(false);
    });

    it('takes the Ids from what this tab kept, not from the address', () => {
        const store = memory();
        store.setItem(STORE_PREFIX + 't', JSON.stringify({ ids: [id(1)], back: null }));
        const run = readFlowState(
            { c__grid: 'Consignments', c__action: 'Reschedule_Pickup', c__token: 't', c__ids: id(2) },
            store
        );
        expect(run.ids).toEqual([id(1)]);
        expect(run.fromThisTab).toBe(true);
    });

    it('refuses a web address as the way back, from the address or from session storage', () => {
        const link = {
            c__grid: 'Consignments',
            c__action: 'Reschedule_Pickup',
            c__token: 't',
            c__ids: id(1),
            c__back: JSON.stringify(WEB)
        };
        expect(readFlowState(link, memory()).back).toBeNull();
        const store = memory();
        store.setItem(STORE_PREFIX + 't', JSON.stringify({ ids: [id(1)], back: WEB }));
        const run = readFlowState({ c__grid: 'Consignments', c__action: 'Reschedule_Pickup', c__token: 't' }, store);
        expect(run.back).toBeNull();
        expect(run.fromThisTab).toBe(true);
    });

    it('treats an entry it cannot use as no entry', () => {
        const store = memory();
        store.setItem(STORE_PREFIX + 't', JSON.stringify({ ids: id(1) }));
        const run = readFlowState(
            { c__grid: 'Consignments', c__action: 'Reschedule_Pickup', c__token: 't', c__ids: id(2) },
            store
        );
        expect(run.ids).toEqual([id(2)]);
        expect(run.fromThisTab).toBe(false);
        store.setItem(STORE_PREFIX + 't', '{"ids":["a0B');
        expect(
            readFlowState({ c__grid: 'Consignments', c__action: 'Reschedule_Pickup', c__token: 't' }, store).error
        ).toMatch(/not found in this browser tab/);
    });

    it('reads session storage for many Ids, and forgets them after', () => {
        const store = memory();
        const ids = Array.from({ length: IDS_IN_URL + 3 }, (_, i) => id(i));
        const state = flowPageRef(
            'rowhouse',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'selection', ids, back: PAGE, token: 't3' },
            store
        ).state;
        expect(readFlowState(state, store)).toEqual({
            grid: 'Consignments',
            action: 'Reschedule_Pickup',
            on: 'selection',
            ids,
            back: PAGE,
            token: 't3',
            fromThisTab: true
        });
        forget('t3', store);
        expect(store.kept.size).toBe(0);
        expect(readFlowState(state, store).error).toMatch(/not found in this browser tab/);
    });

    it(`reads the address again once a hand-over of up to ${IDS_IN_URL} Ids is forgotten, without the way back`, () => {
        const store = memory();
        const state = flowPageRef(
            'c',
            { grid: 'Consignments', action: 'Reschedule_Pickup', on: 'row', ids: [id(7)], back: PAGE, token: 't4' },
            store
        ).state;
        forget('t4', store);
        const reloaded = readFlowState(state, store);
        expect(reloaded.ids).toEqual([id(7)]);
        expect(reloaded.back).toBeNull();
        expect(reloaded.fromThisTab).toBe(false);
    });

    it('says what is missing, in words', () => {
        expect(readFlowState({}, null).error).toMatch(/not told which/);
        expect(
            readFlowState({ c__grid: 'Consignments', c__action: 'Reschedule_Pickup', c__ids: 'PRO-1017' }, null).error
        ).toMatch(/not given a row/);
        expect(
            readFlowState(
                {
                    c__grid: 'Consignments',
                    c__action: 'Reschedule_Pickup',
                    c__ids: id(1),
                    c__back: '{"type":"standard__recordPage","attributes":{'
                },
                null
            ).back
        ).toBeNull();
    });
});

describe("the flow's inputs", () => {
    it("hands one row's Id to the action's input, or recordId", () => {
        expect(flowInputs({ inputName: 'consignmentId' }, { on: 'row', ids: [id(1)] })).toEqual([
            { name: 'consignmentId', type: 'String', value: id(1) }
        ]);
        expect(flowInputs({ inputName: null }, { on: 'row', ids: [id(1)] })).toEqual([
            { name: 'recordId', type: 'String', value: id(1) }
        ]);
    });

    it("hands a selection's Ids as the text collection ids", () => {
        expect(flowInputs({ inputName: 'consignmentId' }, { on: 'selection', ids: [id(1), id(2)] })).toEqual([
            { name: 'ids', type: 'String', value: [id(1), id(2)] }
        ]);
    });
});

describe("a quick action opens in Salesforce's own window", () => {
    const REC = '001000000000001AAA';

    it("at the address Lightning shows, over the grid's page", () => {
        expect(quickActionUrl('Global.LogACall', REC, '/lightning/n/Freight_Desk?c__tab=Open')).toBe(
            '/lightning/action/quick/Global.LogACall?objectApiName&context=RECORD_DETAIL&recordId=001000000000001AAA' +
                '&backgroundContext=%2Flightning%2Fn%2FFreight_Desk%3Fc__tab%3DOpen'
        );
        expect(quickActionUrl('Account.Flag_For_Review', REC, '/lightning/r/Account/001000000000001AAA/view')).toBe(
            '/lightning/action/quick/Account.Flag_For_Review?objectApiName&context=RECORD_DETAIL' +
                '&recordId=001000000000001AAA&backgroundContext=%2Flightning%2Fr%2FAccount%2F001000000000001AAA%2Fview'
        );
    });

    it('not with a name, a record or a page that is not what it should be', () => {
        expect(quickActionUrl('LogACall', REC, '/lightning/n/Freight_Desk')).toBeNull(); // Global. is the grid's to add
        expect(quickActionUrl('Global.Log a call', REC, '/lightning/n/Freight_Desk')).toBeNull();
        expect(quickActionUrl('Global.LogACall?x=1', REC, '/lightning/n/Freight_Desk')).toBeNull();
        expect(quickActionUrl('Global.LogACall', 'Wachusett', '/lightning/n/Freight_Desk')).toBeNull();
        expect(quickActionUrl('Global.LogACall', REC, '/s/freight-desk')).toBeNull(); // a site: no window there
        expect(quickActionUrl('Global.LogACall', REC, 'https://granite-coast-login.net/lightning/')).toBeNull();
        expect(quickActionUrl('Global.LogACall', REC, `${QUICK_PATH}Global.NewTask`)).toBeNull();
        expect(quickActionUrl(undefined, undefined, undefined)).toBeNull();
    });

    it('and the grid knows the window by its address', () => {
        expect(isQuickActionPath('/lightning/action/quick/Global.LogACall')).toBe(true);
        expect(isQuickActionPath('/lightning/n/Freight_Desk')).toBe(false);
        expect(isQuickActionPath(undefined)).toBe(false);
    });
});
