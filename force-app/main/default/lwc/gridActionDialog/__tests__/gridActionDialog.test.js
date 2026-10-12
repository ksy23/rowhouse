/**
 * The action dialog: it asks the admin's question (or "Label?"), names
 * the rows and warns about unsaved changes. Focus stays inside. Screen flows
 * run on their own page (rowhouseFlow), so it never holds one.
 */
import { createElement } from 'lwc';
import GridActionDialog, { NAMED } from 'c/gridActionDialog';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const mount = async props => {
    el = createElement('c-grid-action-dialog', { is: GridActionDialog });
    Object.assign(el, props);
    events = [];
    ['confirm', 'cancel'].forEach(name => el.addEventListener(name, () => events.push(name)));
    document.body.appendChild(el);
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('asking first', () => {
    it('asks "Label?" by default, names the row, and starts on Cancel', async () => {
        await mount({ label: 'Mark as seen', names: ['Kennebec Lumber, 12 bundles'], count: 1 });
        expect($('section').getAttribute('role')).toBe('alertdialog');
        expect($('section').getAttribute('aria-modal')).toBe('true');
        expect($('h1').textContent).toBe('Mark as seen?');
        expect($('.rh-action-runs-on').textContent).toBe('It runs on 1 record:');
        expect($$('.rh-action-names li').map(li => li.textContent)).toEqual(['Kennebec Lumber, 12 bundles']);
        expect($('.rh-action-confirm').textContent).toBe('Mark as seen');
        expect(el.shadowRoot.activeElement).toBe($('.rh-action-cancel'));
        expect($('lightning-flow')).toBeNull();
    });

    it("asks the admin's own question when there is one", async () => {
        await mount({
            label: 'Recalculate charges',
            question: 'Recalculate charges on these consignments?',
            names: ['Penobscot Paper, full truck', 'Reefer load, Machias'],
            count: 2
        });
        expect($('h1').textContent).toBe('Recalculate charges on these consignments?');
        expect($('.rh-action-runs-on').textContent).toBe('It runs on 2 records:');
    });

    it(`names the first ${NAMED} rows, then says how many more`, async () => {
        const names = [
            'Kennebec Lumber, 12 bundles',
            'Penobscot Paper, full truck',
            'Reefer load, Machias',
            'Casco Bay Marine, 4 pallets',
            'Wachusett Paper, 6 rolls',
            'Bangor Brick & Tile, 2 crates',
            'Green Mountain Maple, 30 cases'
        ];
        await mount({ label: 'Mark delivered', names, count: 9 });
        expect($$('.rh-action-names li').map(li => li.textContent)).toEqual(names.slice(0, NAMED));
        expect($('.rh-action-more').textContent).toBe('and 4 more');
    });

    it('says that unsaved changes are not part of it', async () => {
        await mount({ label: 'Mark delivered', names: ['Kennebec Lumber, 12 bundles'], count: 1 });
        expect($('.rh-action-drafts')).toBeNull();
        el.hasDrafts = true;
        await flush();
        expect($('.rh-action-drafts').textContent).toBe(
            'Unsaved changes on this row are not part of it: it works on the saved record. Save first to include them.'
        );
    });

    it('runs on the confirm button, and not on Cancel, the close button or Escape', async () => {
        await mount({ label: 'Mark delivered', names: ['Kennebec Lumber, 12 bundles'], count: 1 });
        $('.rh-action-cancel').click();
        $('.rh-action-close').click();
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(events).toEqual(['cancel', 'cancel', 'cancel']);
        $('.rh-action-confirm').click();
        expect(events[3]).toBe('confirm');
    });

    it('keeps focus inside: each guard sends it round', async () => {
        await mount({ label: 'Mark delivered', names: ['Kennebec Lumber, 12 bundles'], count: 1 });
        $('[data-guard="end"]').dispatchEvent(new FocusEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-action-close'));
        $('[data-guard="start"]').dispatchEvent(new FocusEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-action-confirm'));
    });
});
