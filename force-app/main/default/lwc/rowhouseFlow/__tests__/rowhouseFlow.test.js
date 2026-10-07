/**
 * The page a screen-flow action runs on: it reads what the grid sent,
 * asks the server which flow that is, runs it with the row's Id or the
 * selected Ids, and goes back to the grid, marked, when it finishes or is
 * left.
 */
import { createElement } from 'lwc';
import RowhouseFlow from 'c/rowhouseFlow';
import screenFlow from '@salesforce/apex/GridController.screenFlow';
import { CurrentPageReference } from 'lightning/navigation';
import { STORE_PREFIX } from 'c/gridFlowRoute';

jest.mock('@salesforce/apex/GridController.screenFlow', () => ({ default: jest.fn() }), { virtual: true });

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
            [GenerateUrl]() {
                return Promise.resolve('');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const ID = 'a01000000000003AAA';
const BACK = {
    type: 'standard__navItemPage',
    attributes: { apiName: 'Rowhouse_Dev' },
    state: { c__grid: 'Test_Records' }
};
const NOTE = {
    name: 'Add_Note',
    label: 'Add a note',
    flowName: 'Rowhouse_Test_Screen_Flow',
    inputName: 'recordId',
    onRow: true,
    onSelection: true
};
const rowState = (extra = {}) => ({
    c__grid: 'Test_Records',
    c__action: 'Add_Note',
    c__on: 'row',
    c__token: 'tok1',
    c__ids: ID,
    c__back: JSON.stringify(BACK),
    ...extra
});

const settle = async () => {
    for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

let el;
let toasts;
const mount = async state => {
    el = createElement('c-rowhouse-flow', { is: RowhouseFlow });
    toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    document.body.appendChild(el);
    // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
    CurrentPageReference.emit({ type: 'standard__component', attributes: { componentName: 'c__rowhouseFlow' }, state });
    await settle();
};
const $ = selector => el.shadowRoot.querySelector(selector);

beforeEach(() => {
    screenFlow.mockResolvedValue(NOTE);
    sessionStorage.clear();
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('running the flow', () => {
    it("asks the server which flow, and runs it with the row's Id under the action's label", async () => {
        await mount(rowState());
        expect(screenFlow).toHaveBeenCalledWith({ configName: 'Test_Records', actionName: 'Add_Note' });
        expect($('h1').textContent).toBe('Add a note');
        expect($('.rh-flow-rows').textContent).toBe('On one row');
        const flow = $('lightning-flow');
        expect(flow.flowApiName).toBe('Rowhouse_Test_Screen_Flow');
        expect(flow.flowInputVariables).toEqual([{ name: 'recordId', type: 'String', value: ID }]);
    });

    it('runs on a selection with the Ids as the text collection ids, from session storage when there are many', async () => {
        const ids = Array.from({ length: 30 }, (_, i) => 'a01' + String(i).padStart(15, '0'));
        sessionStorage.setItem(STORE_PREFIX + 'tok2', JSON.stringify({ ids, back: BACK }));
        await mount({ c__grid: 'Test_Records', c__action: 'Add_Note', c__on: 'selection', c__token: 'tok2' });
        expect($('lightning-flow').flowInputVariables).toEqual([{ name: 'ids', type: 'String', value: ids }]);
        expect($('.rh-flow-rows').textContent).toBe('On 30 selected rows');
        expect(sessionStorage.getItem(STORE_PREFIX + 'tok2')).toBeNull(); // read once, then forgotten
    });

    it('shows a spinner while it asks', async () => {
        let release;
        screenFlow.mockReturnValueOnce(
            new Promise(resolve => {
                release = resolve;
            })
        );
        await mount(rowState());
        expect($('lightning-spinner')).not.toBeNull();
        expect($('lightning-flow')).toBeNull();
        release(NOTE);
        await settle();
        expect($('lightning-spinner')).toBeNull();
        expect($('lightning-flow')).not.toBeNull();
    });
});

describe('going back to the grid', () => {
    it('says the flow finished, once, and goes back to the grid marked with the token', async () => {
        await mount(rowState());
        const flow = $('lightning-flow');
        flow.dispatchEvent(new CustomEvent('statuschange', { detail: { status: 'STARTED' } }));
        expect(mockNavigate).not.toHaveBeenCalled();
        flow.dispatchEvent(new CustomEvent('statuschange', { detail: { status: 'FINISHED_SCREEN' } }));
        flow.dispatchEvent(new CustomEvent('statuschange', { detail: { status: 'FINISHED' } }));
        expect(toasts).toEqual([{ title: 'Add a note', message: 'Add a note: finished.', variant: 'success' }]);
        expect(mockNavigate).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith({ ...BACK, state: { ...BACK.state, c__flowDone: 'tok1' } });
    });

    it('goes back without finishing on Cancel, marked too, so the grid reads the row again', async () => {
        await mount(rowState());
        $('.rh-flow-cancel').click();
        expect(toasts).toEqual([]);
        expect(mockNavigate).toHaveBeenCalledWith({ ...BACK, state: { ...BACK.state, c__flowDone: 'tok1' } });
    });

    it("goes back in the browser's history when it was not told the way", async () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
        await mount(rowState({ c__back: undefined }));
        $('.rh-flow-cancel').click();
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(back).toHaveBeenCalled();
        back.mockRestore();
    });
});

describe('what it will not run', () => {
    it('says why when the grid has no such screen flow for this user', async () => {
        screenFlow.mockRejectedValue({
            body: { message: 'This grid has no screen flow called "Nope" that you can run.' }
        });
        await mount(rowState({ c__action: 'Nope' }));
        expect($('.rh-flow-error').textContent).toContain('no screen flow called "Nope"');
        expect($('lightning-flow')).toBeNull();
    });

    it('will not run a row-only action on a selection', async () => {
        screenFlow.mockResolvedValue({ ...NOTE, onSelection: false });
        await mount(rowState({ c__on: 'selection' }));
        expect($('.rh-flow-error h2').textContent).toBe('Add a note does not run on selected rows in this grid.');
    });

    it('says what is missing when it was opened without a grid', async () => {
        await mount({});
        expect(screenFlow).not.toHaveBeenCalled();
        expect($('.rh-flow-error').textContent).toMatch(/not told which/);
    });
});
