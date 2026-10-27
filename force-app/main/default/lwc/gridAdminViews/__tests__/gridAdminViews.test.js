/**
 * The Grid Admin tab's Views tab: every saved view of the grid, who owns it
 * and who sees it, and Delete, which asks first.
 */
import { createElement } from 'lwc';
import GridAdminViews from 'c/gridAdminViews';

const VIEWS = [
    {
        id: 'a00000000000001AAA',
        name: 'Closing this quarter',
        ownerName: 'Jenna Rossi',
        sharing: 'groups',
        groups: [{ name: 'Sales New England' }, { name: 'Sales Managers' }],
        lastModified: '2026-10-22T14:00:00.000Z'
    },
    { id: 'a00000000000002AAA', name: 'My open deals', ownerName: 'Daniel Okafor', sharing: 'me', groups: [] }
];

let el;
let events;
const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const mount = async props => {
    el = createElement('c-grid-admin-views', { is: GridAdminViews });
    Object.assign(el, props);
    events = [];
    el.addEventListener('remove', e => events.push(e.detail));
    document.body.appendChild(el);
    await settle();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('the Views tab', () => {
    it('lists every view with its owner and who sees it', async () => {
        await mount({ views: VIEWS });
        expect($$('.rh-admin-view-name').map(c => c.textContent)).toEqual(['Closing this quarter', 'My open deals']);
        expect($$('.rh-admin-view-who').map(c => c.textContent)).toEqual([
            '2 groups: Sales New England, Sales Managers',
            'Only the owner'
        ]);
        await expect(el).toBeAccessible();
    });

    it('says so while loading, when there are none, and when they could not be read', async () => {
        await mount({ views: null });
        expect($('.rh-admin-views-loading')).not.toBeNull();
        el.views = [];
        await settle();
        expect($('.rh-admin-views-none').textContent).toBe('No one has saved a view of this grid yet.');
        el.views = null;
        el.error = 'The views could not be read. No access.';
        await settle();
        expect($('.rh-admin-views-error').textContent).toContain('No access.');
        expect($('.rh-admin-views-loading')).toBeNull();
    });

    it('asks before deleting, and Cancel deletes nothing', async () => {
        await mount({ views: VIEWS });
        $$('.rh-admin-view-delete')[1].click();
        await settle();
        const dialog = $('c-grid-view-dialog');
        expect(dialog.mode).toBe('delete');
        dialog.dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect($('c-grid-view-dialog')).toBeNull();
        expect(events).toEqual([]);
        $$('.rh-admin-view-delete')[1].click();
        await settle();
        $('c-grid-view-dialog').dispatchEvent(new CustomEvent('delete'));
        await settle();
        expect(events).toEqual([{ id: 'a00000000000002AAA', name: 'My open deals' }]);
    });
});
