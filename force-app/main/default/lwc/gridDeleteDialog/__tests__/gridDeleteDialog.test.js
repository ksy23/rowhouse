/**
 * The delete dialog: it names what it deletes, says where it goes and
 * what else is lost, and keeps focus inside, starting on Cancel.
 */
import { createElement } from 'lwc';
import GridDeleteDialog, { NAMED } from 'c/gridDeleteDialog';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const mount = async props => {
    el = createElement('c-grid-delete-dialog', { is: GridDeleteDialog });
    Object.assign(el, props);
    events = [];
    el.addEventListener('confirm', () => events.push('confirm'));
    el.addEventListener('cancel', () => events.push('cancel'));
    document.body.appendChild(el);
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('gridDeleteDialog', () => {
    it('is a labelled, described alert dialog that asks about the rows by number', async () => {
        await mount({ names: ['Kennebec Lumber, 12 bundles'], count: 1 });
        const dialog = $('section');
        expect(dialog.getAttribute('role')).toBe('alertdialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect($('h1').textContent).toBe('Delete 1 record?');
        expect($('.rh-delete-where').textContent).toBe('It goes to the Recycle Bin, where it can be restored.');
    });

    it(`names the first ${NAMED} rows, then says how many more`, async () => {
        const names = [
            'Kennebec Lumber, 12 bundles',
            'Reefer load, Machias',
            'Penobscot Paper, full truck',
            'Casco Bay Marine, 4 pallets',
            'Wachusett Paper, 18 rolls',
            'Green Mountain Maple, 40 cases',
            'Bangor Brick & Tile, 2 pallets'
        ];
        await mount({ names, count: 8 });
        expect([...el.shadowRoot.querySelectorAll('.rh-delete-names li')].map(li => li.textContent)).toEqual(
            names.slice(0, NAMED)
        );
        expect($('.rh-delete-more').textContent).toBe('and 3 more');
        expect($('h1').textContent).toBe('Delete 8 records?');
        expect($('.rh-delete-where').textContent).toBe('They go to the Recycle Bin, where they can be restored.');
    });

    it('says so when unsaved changes will be lost', async () => {
        await mount({ names: ['Reefer load, Machias'], count: 1 });
        expect($('.rh-delete-drafts')).toBeNull();
        el.hasDrafts = true;
        await flush();
        expect($('.rh-delete-drafts').textContent).toBe('Unsaved changes on these rows will be lost.');
    });

    it('says so when every matching record is deleted, not only the loaded rows', async () => {
        await mount({ names: ['Reefer load, Machias', 'Penobscot Paper, full truck'], count: 2 });
        expect($('.rh-delete-matching')).toBeNull();
        el.matching = true;
        el.count = 12500;
        await flush();
        expect($('h1').textContent).toBe('Delete 12,500 records?');
        expect($('.rh-delete-more').textContent).toBe('and 12,498 more');
        expect($('.rh-delete-matching').textContent).toBe(
            'This deletes every record that matches the search and filters, including the ones not loaded in the grid.'
        );
    });

    it('names a row with no name plainly', async () => {
        await mount({ names: [null, ''], count: 2 });
        expect([...el.shadowRoot.querySelectorAll('.rh-delete-names li')].map(li => li.textContent)).toEqual([
            'A record with no name',
            'A record with no name'
        ]);
    });

    it('offers a destructive Delete, and Cancel, which has focus first', async () => {
        await mount({ names: ['Reefer load, Machias'], count: 1 });
        expect($('.rh-delete-confirm').classList).toContain('slds-button_destructive');
        expect(el.shadowRoot.activeElement).toBe($('.rh-delete-cancel'));
        $('.rh-delete-confirm').click();
        $('.rh-delete-cancel').click();
        $('.rh-delete-close').click();
        expect(events).toEqual(['confirm', 'cancel', 'cancel']);
    });

    it('cancels on Escape', async () => {
        await mount({ names: ['Reefer load, Machias'], count: 1 });
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
        $('.rh-delete-cancel').dispatchEvent(event);
        expect(events).toEqual(['cancel']);
        expect(event.defaultPrevented).toBe(true);
    });

    it('keeps focus inside: each guard sends it round to the other end', async () => {
        await mount({ names: ['Reefer load, Machias'], count: 1 });
        $('[data-guard="start"]').dispatchEvent(new FocusEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-delete-confirm'));
        $('[data-guard="end"]').dispatchEvent(new FocusEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-delete-close'));
    });

    it('has no axe violations', async () => {
        await mount({ names: ['Reefer load, Machias', 'Penobscot Paper, full truck'], count: 2, hasDrafts: true });
        await expect(el).toBeAccessible();
    });
});
