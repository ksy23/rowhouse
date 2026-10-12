/**
 * A row's Change Owner: the search box asks for owners, the button waits for
 * one to be chosen, a spinner shows while the grid saves, and a refusal is
 * said in the dialog.
 */
import { createElement } from 'lwc';
import GridChangeOwner from 'c/gridChangeOwner';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);

async function mount(props = {}) {
    el = createElement('c-grid-change-owner', { is: GridChangeOwner });
    Object.assign(el, { configName: 'Consignments', recordName: 'Kennebec Lumber, 7 bundles', ...props });
    events = [];
    el.addEventListener('confirm', e => events.push({ name: 'confirm', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
}
const choose = async (value, label) => {
    $('c-cell-lookup').dispatchEvent(new CustomEvent('commit', { detail: { value, label } }));
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it('asks who should own the record, with a search for owners of this grid', async () => {
    await mount();
    expect($('h1').textContent).toBe('Change Owner');
    expect($('.rh-change-owner-question').textContent).toBe(
        'Who should own Kennebec Lumber, 7 bundles? Choose a user, or a queue.'
    );
    const lookup = $('c-cell-lookup');
    expect(lookup.ownerSearch).toBe(true);
    expect(lookup.configName).toBe('Consignments');
    expect(lookup.label).toBe('New Owner');
    expect(lookup.required).toBe(true);
});

it('waits for an owner to be chosen, then says which', async () => {
    await mount();
    expect($('.rh-change-owner-confirm').disabled).toBe(true);
    await choose('005000000000077AAA', 'Nora Pelletier');
    const confirm = $('.rh-change-owner-confirm');
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(events).toEqual([
        { name: 'confirm', detail: { ownerId: '005000000000077AAA', ownerName: 'Nora Pelletier' } }
    ]);
});

it('shows a spinner and holds its buttons while the grid saves', async () => {
    await mount({ busy: true });
    await choose('005000000000077AAA', 'Nora Pelletier');
    expect($('lightning-spinner')).not.toBeNull();
    expect($('.rh-change-owner-confirm').disabled).toBe(true);
    expect($('.rh-change-owner-cancel').disabled).toBe(true);
    $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual([]);
});

it('says why the owner was not changed', async () => {
    await mount({ error: 'insufficient access rights on object id' });
    expect($('.rh-change-owner-error').textContent).toBe('insufficient access rights on object id');
});

it('cancels on Escape, but the first Escape in the search box only closes its list', async () => {
    await mount();
    $('c-cell-lookup').dispatchEvent(new CustomEvent('cancel', { detail: { listOpen: true } }));
    expect(events).toEqual([]);
    $('c-cell-lookup').dispatchEvent(new CustomEvent('cancel', { detail: { listOpen: false } }));
    expect(events).toEqual([{ name: 'cancel' }]);
});

it('is accessible', async () => {
    await mount();
    await expect(el).toBeAccessible();
});
