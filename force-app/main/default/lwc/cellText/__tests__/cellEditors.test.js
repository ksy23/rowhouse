/**
 * What every cell editor shares:
 * - a required field left blank is refused in the editor, with the record
 *   form's message, and the editor stays open (commit() returns false);
 * - the text, number and lookup editors take the character typed on the cell
 *   (`seed`) as the new value so far.
 * The table's side (keeping the editor open, passing the seed) is in
 * gridTable.editing.test.js.
 */
import { createElement } from 'lwc';
import CellText, { REQUIRED_MESSAGE } from 'c/cellText';
import CellNumber from 'c/cellNumber';
import CellDate from 'c/cellDate';
import CellPicklist from 'c/cellPicklist';
import CellMultiPicklist from 'c/cellMultiPicklist';
import CellLookup from 'c/cellLookup';
import searchLookup from '@salesforce/apex/GridController.searchLookup';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn(() => Promise.resolve([])) }), {
    virtual: true
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = (Ctor, props) => {
    const el = createElement('rowhouse-cell', { is: Ctor });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
};
const alertOf = el => el.shadowRoot.querySelector('[role="alert"]');

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.useRealTimers();
    searchLookup.mockClear();
});

describe('a required field left blank', () => {
    const cases = [
        ['text', CellText, { value: null }],
        ['number', CellNumber, { value: null, type: 'number' }],
        ['date', CellDate, { value: null }],
        ['picklist', CellPicklist, { value: null, options: [{ value: 'A', label: 'A' }] }],
        ['multi-select picklist', CellMultiPicklist, { value: null, options: [{ value: 'A', label: 'A' }] }],
        ['lookup', CellLookup, { value: null, configName: 'Test_Records', field: 'Lookup_Field__c' }]
    ];

    it.each(cases)('the %s editor refuses it, says why, and reports nothing', async (name, Ctor, props) => {
        const el = mount(Ctor, { mode: 'edit', label: 'Field', required: true, ...props });
        await flush();
        const heard = jest.fn();
        el.addEventListener('commit', heard);
        expect(el.commit()).toBe(false);
        await flush();
        expect(heard).not.toHaveBeenCalled();
        expect(alertOf(el).textContent).toBe(REQUIRED_MESSAGE);
    });

    it.each(cases)('the %s editor commits a blank when the field is not required', async (name, Ctor, props) => {
        const el = mount(Ctor, { mode: 'edit', label: 'Field', required: false, ...props });
        await flush();
        const heard = jest.fn();
        el.addEventListener('commit', heard);
        expect(el.commit()).toBe(true);
        expect(heard).toHaveBeenCalledTimes(1);
        await flush();
        expect(alertOf(el)).toBeNull();
    });

    it("uses the record form's words", () => {
        expect(REQUIRED_MESSAGE).toBe('Complete this field.');
    });

    it('clears the message once something is typed, and then commits it', async () => {
        const el = mount(CellText, { mode: 'edit', label: 'Field', required: true, value: null });
        await flush();
        el.commit();
        await flush();
        expect(alertOf(el)).not.toBeNull();
        el.shadowRoot
            .querySelector('lightning-input')
            .dispatchEvent(new CustomEvent('change', { detail: { value: 'x' } }));
        await flush();
        expect(alertOf(el)).toBeNull();
        const heard = jest.fn();
        el.addEventListener('commit', heard);
        expect(el.commit()).toBe(true);
        expect(heard.mock.calls[0][0].detail.value).toBe('x');
    });

    it('marks the picklist invalid for a screen reader while it refuses', async () => {
        const el = mount(CellPicklist, {
            mode: 'edit',
            label: 'Field',
            required: true,
            value: null,
            options: [{ value: 'A', label: 'A' }]
        });
        await flush();
        el.commit();
        await flush();
        const select = el.shadowRoot.querySelector('select');
        expect(select.getAttribute('aria-invalid')).toBe('true');
        expect(el.shadowRoot.querySelector('.slds-form-element').classList).toContain('slds-has-error');
    });
});

describe('typing on a cell starts the edit with what was typed', () => {
    it('the text editor starts from the typed character, not the old value', async () => {
        const el = mount(CellText, { mode: 'edit', label: 'Field', value: 'old', seed: 'n' });
        await flush();
        expect(el.shadowRoot.querySelector('lightning-input').value).toBe('n');
        const heard = jest.fn();
        el.addEventListener('commit', heard);
        el.commit();
        expect(heard.mock.calls[0][0].detail.value).toBe('n');
    });

    it('the number editor starts from the typed digit', async () => {
        const el = mount(CellNumber, { mode: 'edit', label: 'Field', value: 12, type: 'number', seed: '7' });
        await flush();
        expect(el.shadowRoot.querySelector('lightning-input').value).toBe('7');
    });

    it('without a seed, the editor starts from the value', async () => {
        const el = mount(CellText, { mode: 'edit', label: 'Field', value: 'old' });
        await flush();
        expect(el.shadowRoot.querySelector('lightning-input').value).toBe('old');
    });

    it('the lookup editor keeps the typed character: the caret goes after it, not a selection over it', async () => {
        const el = mount(CellLookup, {
            mode: 'edit',
            label: 'Account',
            value: null,
            valueLabel: 'Old Co',
            configName: 'Test_Records',
            field: 'Lookup_Field__c',
            seed: 'a'
        });
        await flush();
        el.focus();
        const input = el.shadowRoot.querySelector('input');
        expect(input.selectionStart).toBe(1);
        expect(input.selectionEnd).toBe(1);
        // Without a seed the name is selected, so typing replaces it.
        const plain = mount(CellLookup, {
            mode: 'edit',
            label: 'Account',
            value: '001000000000001AAA',
            valueLabel: 'Old Co',
            configName: 'Test_Records',
            field: 'Lookup_Field__c'
        });
        await flush();
        plain.focus();
        const box = plain.shadowRoot.querySelector('input');
        expect([box.selectionStart, box.selectionEnd]).toEqual([0, 'Old Co'.length]);
    });

    it('the lookup editor searches for the typed character', async () => {
        jest.useFakeTimers();
        const el = mount(CellLookup, {
            mode: 'edit',
            label: 'Account',
            value: null,
            configName: 'Test_Records',
            field: 'Lookup_Field__c',
            seed: 'a'
        });
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('input').value).toBe('a');
        jest.runOnlyPendingTimers();
        expect(searchLookup).toHaveBeenCalledWith(expect.objectContaining({ term: 'a' }));
    });
});
