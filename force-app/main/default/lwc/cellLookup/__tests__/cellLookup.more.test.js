/**
 * The lookup editor's New item and lookup filters.
 */
import { createElement } from 'lwc';
import CellLookup, { SEARCH_DELAY_MS, SETTLE_MS } from 'c/cellLookup';
import searchLookup from '@salesforce/apex/GridController.searchLookup';
import lookupName from '@salesforce/apex/GridController.lookupName';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.lookupName', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const CASCO = { id: '001000000000001AAA', name: 'Casco Bay Marine', kind: 'Account', object: 'Account' };
const ROW = 'a00000000000001AAA';

let el;
let events;
const mount = async props => {
    el = createElement('c-cell-lookup', { is: CellLookup });
    Object.assign(el, {
        mode: 'edit',
        label: 'Account',
        configName: 'Consignments',
        field: 'Shipper__c',
        value: null,
        ...props
    });
    events = [];
    ['commit', 'cancel', 'newrecord'].forEach(name =>
        el.addEventListener(name, e => events.push({ name, detail: e.detail }))
    );
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const options = () => [...el.shadowRoot.querySelectorAll('[role="option"]')];
const type = async text => {
    $('input').value = text;
    $('input').dispatchEvent(new CustomEvent('input', { bubbles: true, composed: true }));
    await wait(SEARCH_DELAY_MS + 20);
    await flush();
};
const key = (target, k) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('the New item', () => {
    const NEW = [{ object: 'Account', label: 'Account' }];

    it('ends the list, after the matches, even when nothing matches', async () => {
        searchLookup.mockResolvedValue([CASCO]);
        await mount({ newTargets: NEW });
        await type('casco');
        expect(options().map(o => o.textContent)).toEqual(['Casco Bay MarineAccount', 'New Account']);
        expect(options()[1].classList).toContain('rh-lookup-new');
        searchLookup.mockResolvedValue([]);
        await type('wachusett');
        expect(options().map(o => o.textContent)).toEqual(['New Account']);
        expect(el.shadowRoot.querySelector('[aria-live="polite"]').textContent).toBe('No matches. Or create a record.');
    });

    it('asks the grid for the record form, by click or by Enter, and commits nothing', async () => {
        searchLookup.mockResolvedValue([CASCO]);
        await mount({ newTargets: NEW });
        await type('Casco');
        options()[1].click();
        await flush();
        expect(events).toEqual([{ name: 'newrecord', detail: { object: 'Account', label: 'Account', term: 'Casco' } }]);
        events.length = 0;
        await type('Casco');
        key($('input'), 'ArrowDown');
        await flush();
        key($('input'), 'Enter');
        await flush();
        expect(events.map(e => e.name)).toEqual(['newrecord']);
    });

    it('is not offered without targets the user may create', async () => {
        searchLookup.mockResolvedValue([CASCO]);
        await mount({});
        await type('casco');
        expect(options().map(o => o.textContent)).toEqual(['Casco Bay MarineAccount']);
    });
});

describe('a field with a lookup filter', () => {
    const FILTERED = {
        filtered: true,
        fieldApiName: 'Bill_To__c',
        objectApiName: 'Consignment__c',
        recordId: ROW,
        field: 'Bill_To__c'
    };

    it("is edited with Salesforce's own lookup, on the row's record, which applies the filter", async () => {
        await mount({ ...FILTERED, value: CASCO.id });
        expect($('input')).toBeNull();
        const form = $('lightning-record-edit-form');
        expect(form.objectApiName).toBe('Consignment__c');
        expect(form.recordId).toBe(ROW);
        const field = $('lightning-input-field');
        expect(field.fieldName).toBe('Bill_To__c');
        expect(field.value).toBe(CASCO.id);
    });

    it('has no record for a row not saved yet', async () => {
        await mount({ ...FILTERED, recordId: 'new-1' });
        expect($('lightning-record-edit-form').recordId).toBeNull();
    });

    it('commits the record chosen with its name, read from the server', async () => {
        lookupName.mockResolvedValue('Casco Bay Marine');
        await mount(FILTERED);
        $('lightning-input-field').dispatchEvent(new CustomEvent('change', { detail: { value: [CASCO.id] } }));
        await flush();
        expect(lookupName).toHaveBeenCalledWith({
            configName: 'Consignments',
            field: 'Bill_To__c',
            recordId: CASCO.id
        });
        expect(events).toEqual([{ name: 'commit', detail: { value: CASCO.id, label: 'Casco Bay Marine' } }]);
    });

    it("waits, on the grid's focus-out, for the record a click on the lookup's list chose", async () => {
        lookupName.mockResolvedValue('Casco Bay Marine');
        await mount(FILTERED);
        expect(el.commit()).toBe(true); // the grid's focus-out, before the lookup's change
        expect(events).toEqual([]);
        $('lightning-input-field').dispatchEvent(new CustomEvent('change', { detail: { value: CASCO.id } }));
        await flush();
        await wait(SETTLE_MS + 20);
        expect(events).toEqual([{ name: 'commit', detail: { value: CASCO.id, label: 'Casco Bay Marine' } }]);
    });

    it('commits what it had when nothing is chosen after the focus-out', async () => {
        await mount({ ...FILTERED, value: CASCO.id, valueLabel: 'Casco Bay Marine' });
        el.commit();
        await wait(SETTLE_MS + 20);
        expect(events).toEqual([{ name: 'commit', detail: { value: CASCO.id, label: 'Casco Bay Marine' } }]);
    });

    it('commits a cleared lookup, cancels on Escape and commits on Tab', async () => {
        await mount({ ...FILTERED, value: CASCO.id, valueLabel: 'Casco Bay Marine' });
        $('lightning-input-field').dispatchEvent(new CustomEvent('change', { detail: { value: null } }));
        await flush();
        expect(events).toEqual([{ name: 'commit', detail: { value: null, label: null } }]);
        events.length = 0;
        key($('lightning-input-field'), 'Escape');
        expect(events).toEqual([{ name: 'cancel', detail: { listOpen: false } }]);
        events.length = 0;
        key($('lightning-input-field'), 'Tab');
        expect(events).toEqual([{ name: 'commit', detail: { value: CASCO.id, label: 'Casco Bay Marine' } }]);
    });
});
