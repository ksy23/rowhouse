/**
 * The New record dialog behind a lookup's New item.
 */
import { createElement } from 'lwc';
import GridNewRecord from 'c/gridNewRecord';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const mount = async props => {
    el = createElement('c-grid-new-record', { is: GridNewRecord });
    Object.assign(el, props);
    events = [];
    el.addEventListener('created', e => events.push({ name: 'created', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('gridNewRecord', () => {
    it('is a labelled dialog with Salesforce\'s own form for the object', async () => {
        await mount({ objectApiName: 'Account', objectLabel: 'Account', fieldLabel: 'Related Account' });
        expect($('section').getAttribute('role')).toBe('dialog');
        expect($('section').getAttribute('aria-modal')).toBe('true');
        expect($('h1').textContent).toBe('New Account');
        expect($('.rh-new-record-where').textContent).toBe('When it is saved, it goes in Related Account as an unsaved change.');
        const form = $('lightning-record-form');
        expect(form.objectApiName).toBe('Account');
        expect(form.layoutType).toBe('Full');
        expect(form.mode).toBe('edit');
    });

    it('says the new record\'s Id when the form saves it', async () => {
        await mount({ objectApiName: 'Account', objectLabel: 'Account' });
        $('lightning-record-form').dispatchEvent(new CustomEvent('success', { detail: { id: '001000000000001AAA' } }));
        expect(events).toEqual([{ name: 'created', detail: { id: '001000000000001AAA' } }]);
    });

    it('cancels from the form, the close button and Escape', async () => {
        await mount({ objectApiName: 'Account', objectLabel: 'Account' });
        $('lightning-record-form').dispatchEvent(new CustomEvent('cancel'));
        $('.rh-new-record-close').click();
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(events).toEqual([{ name: 'cancel' }, { name: 'cancel' }, { name: 'cancel' }]);
    });
});
