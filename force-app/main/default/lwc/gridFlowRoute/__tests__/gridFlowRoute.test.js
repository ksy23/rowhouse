/**
 * The hand-over of a screen flow to its own page and back, as plain
 * functions: what travels in the address, what in session storage, and what
 * the page reads back.
 */
import {
    FLOW_PAGE,
    IDS_IN_URL,
    STORE_PREFIX,
    namespaceOf,
    newToken,
    backRef,
    flowPageRef,
    readFlowState,
    forget,
    withDone,
    doneToken,
    flowInputs
} from 'c/gridFlowRoute';

const id = n => 'a01' + String(n).padStart(15, '0');
const PAGE = {
    type: 'standard__recordPage',
    attributes: { recordId: '001000000000001AAA', actionName: 'view' },
    state: { c__x: '1' }
};
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
    it("reads the namespace from a component's own element", () => {
        expect(namespaceOf({ tagName: 'C-GRID-VIEW' })).toBe('c');
        expect(namespaceOf({ tagName: 'ROWHOUSE-GRID-VIEW' })).toBe('rowhouse');
        expect(namespaceOf(null)).toBe('c');
    });

    it('makes a fresh token each time', () => {
        const a = newToken();
        expect(a).toMatch(/^[a-z0-9]{8,}$/);
        expect(newToken()).not.toBe(a);
    });
});

describe('the way back', () => {
    it('is a plain copy of the page, without an earlier marker', () => {
        const ref = backRef({ ...PAGE, state: { ...PAGE.state, c__flowDone: 'old' } }, 'c');
        expect(ref).toEqual(PAGE);
        expect(backRef(null, 'c')).toBeNull();
    });

    it('is marked with the token, which the grid reads back', () => {
        const back = withDone(PAGE, 'c', 'tok1');
        expect(back.state).toEqual({ c__x: '1', c__flowDone: 'tok1' });
        expect(PAGE.state.c__flowDone).toBeUndefined(); // not changed
        expect(doneToken(back, 'c')).toBe('tok1');
        expect(doneToken(PAGE, 'c')).toBe('');
        expect(withDone(null, 'c', 't')).toBeNull();
    });
});

describe('the address', () => {
    it(`carries up to ${IDS_IN_URL} Ids and the way back`, () => {
        const store = memory();
        const ref = flowPageRef(
            'c',
            { grid: 'Deals', action: 'Note', on: 'row', ids: [id(1)], back: PAGE, token: 't1' },
            store
        );
        expect(ref).toEqual({
            type: 'standard__component',
            attributes: { componentName: `c__${FLOW_PAGE}` },
            state: {
                c__grid: 'Deals',
                c__action: 'Note',
                c__on: 'row',
                c__token: 't1',
                c__ids: id(1),
                c__back: JSON.stringify(PAGE)
            }
        });
        expect(store.kept.size).toBe(0);
    });

    it('keeps more Ids in session storage, under the token', () => {
        const store = memory();
        const ids = Array.from({ length: IDS_IN_URL + 1 }, (_, i) => id(i));
        const ref = flowPageRef(
            'rowhouse',
            { grid: 'Deals', action: 'Note', on: 'selection', ids, back: PAGE, token: 't2' },
            store
        );
        expect(ref.attributes.componentName).toBe(`rowhouse__${FLOW_PAGE}`);
        expect(ref.state).toEqual({
            rowhouse__grid: 'Deals',
            rowhouse__action: 'Note',
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
        expect(flowPageRef('c', { grid: 'G', action: 'A', on: 'selection', ids, token: 't' }, broken)).toBeNull();
        expect(flowPageRef('c', { grid: 'G', action: 'A', on: 'selection', ids, token: 't' }, null)).toBeNull();
    });

    it('drops anything that is not a record Id', () => {
        const ref = flowPageRef(
            'c',
            { grid: 'G', action: 'A', on: 'row', ids: [id(1), 'x,y', ''], token: 't' },
            memory()
        );
        expect(ref.state.c__ids).toBe(id(1));
    });
});

describe('what the page reads', () => {
    it('reads the address', () => {
        const state = flowPageRef(
            'c',
            { grid: 'Deals', action: 'Note', on: 'row', ids: [id(7)], back: PAGE, token: 't' },
            memory()
        ).state;
        expect(readFlowState(state, null)).toEqual({
            grid: 'Deals',
            action: 'Note',
            on: 'row',
            ids: [id(7)],
            back: PAGE,
            token: 't'
        });
    });

    it('reads session storage for many Ids, and forgets them after', () => {
        const store = memory();
        const ids = Array.from({ length: IDS_IN_URL + 3 }, (_, i) => id(i));
        const state = flowPageRef(
            'rowhouse',
            { grid: 'Deals', action: 'Note', on: 'selection', ids, back: PAGE, token: 't3' },
            store
        ).state;
        expect(readFlowState(state, store)).toEqual({
            grid: 'Deals',
            action: 'Note',
            on: 'selection',
            ids,
            back: PAGE,
            token: 't3'
        });
        forget('t3', store);
        expect(store.kept.size).toBe(0);
        expect(readFlowState(state, store).error).toMatch(/not found in this browser tab/);
    });

    it('says what is missing, in words', () => {
        expect(readFlowState({}, null).error).toMatch(/not told which/);
        expect(readFlowState({ c__grid: 'G', c__action: 'A', c__ids: 'nope' }, null).error).toMatch(/not given a row/);
        expect(
            readFlowState({ c__grid: 'G', c__action: 'A', c__ids: id(1), c__back: 'not json' }, null).back
        ).toBeNull();
    });
});

describe("the flow's inputs", () => {
    it("hands one row's Id to the action's input, or recordId", () => {
        expect(flowInputs({ inputName: 'theRecord' }, { on: 'row', ids: [id(1)] })).toEqual([
            { name: 'theRecord', type: 'String', value: id(1) }
        ]);
        expect(flowInputs({ inputName: null }, { on: 'row', ids: [id(1)] })).toEqual([
            { name: 'recordId', type: 'String', value: id(1) }
        ]);
    });

    it("hands a selection's Ids as the text collection ids", () => {
        expect(flowInputs({ inputName: 'theRecord' }, { on: 'selection', ids: [id(1), id(2)] })).toEqual([
            { name: 'ids', type: 'String', value: [id(1), id(2)] }
        ]);
    });
});
