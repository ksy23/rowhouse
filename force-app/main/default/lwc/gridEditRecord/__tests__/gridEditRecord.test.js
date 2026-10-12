/**
 * A row's Edit: Salesforce's own edit form for the record, with the record's
 * full layout, named in the heading; saved and cancelled as the form says.
 */
import { createElement } from 'lwc';
import GridEditRecord from 'c/gridEditRecord';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);

async function mount(props = {}) {
    el = createElement('c-grid-edit-record', { is: GridEditRecord });
    Object.assign(el, {
        recordId: 'a00000000000002AAA',
        objectApiName: 'Consignment__c',
        recordName: 'Casco Bay Marine, 4 crates',
        ...props
    });
    events = [];
    el.addEventListener('saved', e => events.push({ name: 'saved', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it("shows Salesforce's edit form for the record, with its full layout", async () => {
    await mount();
    expect($('h1').textContent).toBe('Edit Casco Bay Marine, 4 crates');
    const form = $('lightning-record-form');
    expect(form.recordId).toBe('a00000000000002AAA');
    expect(form.objectApiName).toBe('Consignment__c');
    expect(form.layoutType).toBe('Full');
    expect(form.mode).toBe('edit');
});

it('says which record was saved', async () => {
    await mount();
    $('lightning-record-form').dispatchEvent(new CustomEvent('success', { detail: { id: 'a00000000000002AAA' } }));
    expect(events).toEqual([{ name: 'saved', detail: { id: 'a00000000000002AAA' } }]);
});

it("cancels from the form's Cancel, the close button and Escape", async () => {
    await mount();
    $('lightning-record-form').dispatchEvent(new CustomEvent('cancel'));
    $('.rh-edit-record-close').click();
    $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual([{ name: 'cancel' }, { name: 'cancel' }, { name: 'cancel' }]);
});

it('names an unnamed record plainly', async () => {
    await mount({ recordName: '' });
    expect($('h1').textContent).toBe('Edit record');
});

it('is accessible', async () => {
    await mount();
    await expect(el).toBeAccessible();
});
