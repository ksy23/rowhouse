/**
 * The page a screen-flow action runs on: it reads what the grid sent,
 * asks the server which flow that is, runs it with the row's Id or the
 * selected Ids, and goes back to the grid, marked, when it finishes or is
 * left. A run a grid in this tab sent starts at once; one opened from a link
 * asks first, and never goes back to anything but a Salesforce page.
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
    state: { c__grid: 'Consignments' }
};
const WEB = { type: 'standard__webPage', attributes: { url: 'https://granite-coast-login.net/verify' } };
const NOTE = {
    name: 'Add_Note',
    label: 'Add a note',
    flowName: 'Add_Delivery_Note',
    inputName: 'recordId',
    onRow: true,
    onSelection: true
};
/** The address a grid sends: the Ids (up to 20) and the token; the way back stays in the tab. */
const rowState = (extra = {}) => ({
    c__grid: 'Consignments',
    c__action: 'Add_Note',
    c__on: 'row',
    c__token: 'tok1',
    c__ids: ID,
    ...extra
});
/** A run a grid in this tab sent: its hand-over is in the tab's session storage. */
const fromThisTab = (extra = {}, entry = { ids: [ID], back: BACK }) => {
    const state = rowState(extra);
    sessionStorage.setItem(STORE_PREFIX + state.c__token, JSON.stringify(entry));
    return state;
};
/** A link from somewhere else: everything in the address, nothing in this tab. */
const fromLink = (back = BACK, extra = {}) => rowState({ c__back: JSON.stringify(back), ...extra });

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
    it("asks the server which flow, and starts it at once, with the row's Id, when a grid in this tab sent it", async () => {
        await mount(fromThisTab());
        expect(screenFlow).toHaveBeenCalledWith({ configName: 'Consignments', actionName: 'Add_Note' });
        expect($('h1').textContent).toBe('Add a note');
        expect($('.rh-flow-rows').textContent).toBe('On one row');
        expect($('.rh-flow-run')).toBeNull(); // no question asked
        const flow = $('lightning-flow');
        expect(flow.flowApiName).toBe('Add_Delivery_Note');
        expect(flow.flowInputVariables).toEqual([{ name: 'recordId', type: 'String', value: ID }]);
        expect(sessionStorage.getItem(STORE_PREFIX + 'tok1')).toBeNull(); // read once, then forgotten
    });

    it('runs on a selection with the Ids as the text collection ids, from session storage when there are many', async () => {
        const ids = Array.from({ length: 30 }, (_, i) => 'a01' + String(i).padStart(15, '0'));
        sessionStorage.setItem(STORE_PREFIX + 'tok2', JSON.stringify({ ids, back: BACK }));
        await mount({ c__grid: 'Consignments', c__action: 'Add_Note', c__on: 'selection', c__token: 'tok2' });
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
        await mount(fromThisTab());
        expect($('lightning-spinner')).not.toBeNull();
        expect($('lightning-flow')).toBeNull();
        release(NOTE);
        await settle();
        expect($('lightning-spinner')).toBeNull();
        expect($('lightning-flow')).not.toBeNull();
    });
});

describe('opened from a link', () => {
    it("asks first, under the action's name and its rows, with Run focused, once the server has named the flow", async () => {
        await mount(fromLink());
        expect(screenFlow).toHaveBeenCalledWith({ configName: 'Consignments', actionName: 'Add_Note' });
        expect($('lightning-flow')).toBeNull();
        expect($('h1').textContent).toBe('Add a note');
        expect($('.rh-flow-rows').textContent).toBe('On one row');
        expect($('.rh-flow-confirm p').textContent).toBe(
            'This page was opened from a link, so it asks before running the flow.'
        );
        const run = $('.rh-flow-run');
        expect(run.textContent).toBe('Run');
        expect(run.classList).toContain('slds-button_brand');
        expect($('.rh-flow-confirm-cancel').textContent).toBe('Cancel');
        expect($('.rh-flow-cancel')).toBeNull(); // one Cancel, beside Run
        expect(el.shadowRoot.activeElement).toBe(run);
        expect(run.getAttribute('aria-describedby')).toBe($('.rh-flow-confirm p').getAttribute('id'));
        await expect(el).toBeAccessible();
    });

    it('asks on a reload too, once the hand-over has been read', async () => {
        const state = fromThisTab();
        await mount(state);
        expect($('lightning-flow')).not.toBeNull();
        el.remove();
        await mount(state); // the same address, reloaded: this tab no longer holds its hand-over
        expect($('lightning-flow')).toBeNull();
        expect($('.rh-flow-run')).not.toBeNull();
    });

    it('starts the flow on Run', async () => {
        await mount(fromLink());
        $('.rh-flow-run').click();
        await settle();
        expect($('.rh-flow-run')).toBeNull();
        const flow = $('lightning-flow');
        expect(flow.flowApiName).toBe('Add_Delivery_Note');
        expect(flow.flowInputVariables).toEqual([{ name: 'recordId', type: 'String', value: ID }]);
        expect($('.rh-flow-cancel')).not.toBeNull(); // the header's Cancel is back
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("goes back to the grid's Salesforce page on Cancel, without running anything", async () => {
        await mount(fromLink());
        $('.rh-flow-confirm-cancel').click();
        await settle();
        expect($('lightning-flow')).toBeNull();
        expect(mockNavigate).toHaveBeenCalledWith({ ...BACK, state: { ...BACK.state, c__flowDone: 'tok1' } });
    });

    it("never goes to a web address it was given: Cancel goes back in the browser's history", async () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
        await mount(fromLink(WEB));
        $('.rh-flow-confirm-cancel').click();
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(back).toHaveBeenCalledTimes(1);
        back.mockRestore();
    });

    it('never goes to a web address it was given: nor when the flow finishes', async () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
        await mount(fromLink(WEB));
        $('.rh-flow-run').click();
        await settle();
        $('lightning-flow').dispatchEvent(new CustomEvent('statuschange', { detail: { status: 'FINISHED' } }));
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(back).toHaveBeenCalledTimes(1);
        back.mockRestore();
    });

    it('does not ask when the server refuses the action: it says why', async () => {
        screenFlow.mockRejectedValue({
            body: { message: 'This grid has no screen flow of that name that you can run.' }
        });
        await mount(fromLink());
        expect($('.rh-flow-run')).toBeNull();
        expect($('.rh-flow-error').textContent).toContain('no screen flow of that name');
    });
});

describe('going back to the grid', () => {
    it('says the flow finished, once, and goes back to the grid marked with the token', async () => {
        await mount(fromThisTab());
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
        await mount(fromThisTab());
        $('.rh-flow-cancel').click();
        expect(toasts).toEqual([]);
        expect(mockNavigate).toHaveBeenCalledWith({ ...BACK, state: { ...BACK.state, c__flowDone: 'tok1' } });
    });

    it("goes back in the browser's history when it was not told the way", async () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
        await mount(fromThisTab({}, { ids: [ID], back: null }));
        $('.rh-flow-cancel').click();
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(back).toHaveBeenCalled();
        back.mockRestore();
    });

    it("goes back in the browser's history when this tab kept a web address as the way back", async () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
        await mount(fromThisTab({}, { ids: [ID], back: WEB }));
        expect($('lightning-flow')).not.toBeNull();
        $('.rh-flow-cancel').click();
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(back).toHaveBeenCalledTimes(1);
        back.mockRestore();
    });
});

describe('what it will not run', () => {
    it('says why when the grid has no such screen flow for this user', async () => {
        screenFlow.mockRejectedValue({
            body: { message: 'This grid has no screen flow of that name that you can run.' }
        });
        await mount(fromThisTab({ c__action: 'Consignment_Rerate' }));
        expect($('.rh-flow-error').textContent).toContain('no screen flow of that name');
        expect($('lightning-flow')).toBeNull();
    });

    it('will not run a row-only action on a selection', async () => {
        screenFlow.mockResolvedValue({ ...NOTE, onSelection: false });
        await mount(fromThisTab({ c__on: 'selection' }));
        expect($('.rh-flow-error h2').textContent).toBe('Add a note does not run on selected rows in this grid.');
    });

    it('says what is missing when it was opened without a grid', async () => {
        await mount({});
        expect(screenFlow).not.toHaveBeenCalled();
        expect($('.rh-flow-error').textContent).toMatch(/not told which/);
    });
});
