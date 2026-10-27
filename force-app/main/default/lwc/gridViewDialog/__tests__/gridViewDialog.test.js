/**
 * A saved view's dialogs: New, Clone, Save As, Rename, Sharing Settings and
 * Delete, word for word as a list view's, and who sees the view.
 */
import { createElement } from 'lwc';
import GridViewDialog from 'c/gridViewDialog';
import viewGroupTypes from '@salesforce/apex/GridController.viewGroupTypes';
import searchViewGroups from '@salesforce/apex/GridController.searchViewGroups';

jest.mock('@salesforce/apex/GridController.viewGroupTypes', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.searchViewGroups', () => ({ default: jest.fn() }), { virtual: true });

const TYPES = [
    { value: 'Role', label: 'Roles' },
    { value: 'RoleAndSubordinatesInternal', label: 'Roles and Internal Subordinates' },
    { value: 'Regular', label: 'Public Groups' }
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
    el = createElement('c-grid-view-dialog', { is: GridViewDialog });
    Object.assign(el, { gridTitle: 'Pipeline Review', ...props });
    events = [];
    ['save', 'delete', 'cancel'].forEach(type =>
        el.addEventListener(type, e => events.push({ type, detail: e.detail }))
    );
    document.body.appendChild(el);
    await settle();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const typeName = async value => {
    const box = $('.rh-view-name');
    box.value = value;
    box.dispatchEvent(new CustomEvent('input'));
    await settle();
};
const choose = async value => {
    const radio = $$('input[name="who"]').find(r => r.value === value);
    radio.checked = true;
    radio.dispatchEvent(new CustomEvent('change'));
    await settle();
};

beforeEach(() => {
    jest.useFakeTimers();
    viewGroupTypes.mockResolvedValue(TYPES);
    searchViewGroups.mockResolvedValue([
        { id: '00G000000000001AAA', name: 'CEO', type: 'Role', typeLabel: 'Roles' },
        { id: '00G000000000002AAA', name: 'CFO', type: 'Role', typeLabel: 'Roles' }
    ]);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('New View', () => {
    it("asks for a name and who sees the view, as Salesforce's New List View does, and starts on the name", async () => {
        await mount({ mode: 'new', canShare: true });
        expect($('h1').textContent).toBe('New View');
        expect($('.rh-view-name-label').textContent).toBe('* View Name');
        expect($('legend').textContent).toBe('Who sees this view?');
        expect($$('.rh-view-share-option .slds-form-element__label').map(l => l.textContent)).toEqual([
            'Only I can see this view',
            'All users can see this view',
            'Share view with groups of users'
        ]);
        expect($$('input[name="who"]').find(r => r.checked).value).toBe('me');
        expect(el.shadowRoot.activeElement).toBe($('.rh-view-name'));
        jest.useRealTimers(); // axe needs real timers
        await expect(el).toBeAccessible();
    });

    it('offers only "Only I" without Manage Public List Views, and says why', async () => {
        await mount({ mode: 'new', canShare: false });
        expect($$('input[name="who"]').map(r => r.value)).toEqual(['me']);
        expect($('.rh-view-no-share').textContent).toContain('Manage Public List Views');
    });

    it('will not save without a name, and saves the name and who sees it', async () => {
        await mount({ mode: 'new', canShare: true });
        $('.rh-view-save').click();
        await settle();
        expect(events).toEqual([]);
        expect($('.rh-view-name-problem').textContent).toBe('Enter a view name.');
        await typeName('  Closing this quarter ');
        await choose('all');
        $('.rh-view-save').click();
        expect(events).toEqual([
            { type: 'save', detail: { name: 'Closing this quarter', shareMode: 'all', groupIds: [] } }
        ]);
    });

    it('shares with groups found by name, each picked shown as a pill and counted', async () => {
        await mount({ mode: 'new', canShare: true, name: 'Closing this quarter' });
        await choose('groups');
        expect(viewGroupTypes).toHaveBeenCalledTimes(1);
        expect($$('.rh-view-group-type option').map(o => o.textContent)).toEqual([
            'Roles',
            'Roles and Internal Subordinates',
            'Public Groups'
        ]);
        expect($('.rh-view-group-search').placeholder).toBe('Search Roles...');
        const box = $('.rh-view-group-search');
        box.value = 'C';
        box.dispatchEvent(new CustomEvent('input'));
        jest.runAllTimers();
        await settle();
        expect(searchViewGroups).toHaveBeenCalledWith({ type: 'Role', term: 'C' });
        expect($$('.rh-view-found-item').map(b => b.textContent.trim())).toEqual(['CEO', 'CFO']);
        $('.rh-view-found-item').click();
        await settle();
        expect($$('.rh-view-pill .slds-pill__label').map(p => p.textContent)).toEqual(['CEO']);
        expect($('.rh-view-group-count').textContent).toBe('Shared with 1 group of users.');
        $('.rh-view-save').click();
        expect(events[0].detail).toEqual({
            name: 'Closing this quarter',
            shareMode: 'groups',
            groupIds: ['00G000000000001AAA']
        });
        // A group can be taken off again.
        $('.rh-view-pill .slds-pill__remove').click();
        await settle();
        expect($('.rh-view-group-count').textContent).toBe('Shared with 0 groups of users.');
    });
});

describe('the other dialogs', () => {
    it('Clone and Save As start from the name they are given', async () => {
        await mount({ mode: 'clone', canShare: true, name: 'Copy of Closing this quarter' });
        expect($('h1').textContent).toBe('Clone View');
        expect($('.rh-view-name').value).toBe('Copy of Closing this quarter');
        el.remove();
        await mount({ mode: 'saveAs', canShare: false, name: 'Copy of Closing this quarter' });
        expect($('h1').textContent).toBe('Save As');
    });

    it('Rename asks only for the name, and says who sees the view as text', async () => {
        await mount({
            mode: 'rename',
            canShare: true,
            name: 'Closing this quarter',
            sharing: 'groups',
            groups: [{ id: '00G000000000001AAA', name: 'CEO' }]
        });
        expect($('h1').textContent).toBe('Rename View');
        expect($('fieldset')).toBeNull();
        expect($('.rh-view-who-text').textContent).toContain('Shared with 1 group of users');
        await typeName('Closing next quarter');
        $('.rh-view-save').click();
        expect(events[0].detail).toEqual({ name: 'Closing next quarter' });
    });

    it('Sharing Settings starts from who sees the view now', async () => {
        await mount({
            mode: 'sharing',
            canShare: true,
            sharing: 'groups',
            groups: [{ id: '00G000000000001AAA', name: 'CEO', type: 'Role', typeLabel: 'Roles' }]
        });
        await settle();
        expect($('h1').textContent).toBe('Sharing Settings');
        expect($('.rh-view-name')).toBeNull();
        expect($$('input[name="who"]').find(r => r.checked).value).toBe('groups');
        expect($$('.rh-view-pill .slds-pill__label').map(p => p.textContent)).toEqual(['CEO']);
        await choose('me');
        $('.rh-view-save').click();
        expect(events[0].detail).toEqual({ shareMode: 'me', groupIds: [] });
    });

    it('Delete asks first, starts on Cancel, and Escape cancels', async () => {
        await mount({ mode: 'delete' });
        expect($('h1').textContent).toBe('Delete');
        expect($('.rh-view-delete-text').textContent).toBe(
            'If you delete this view, it will be removed for everyone who can see it. Are you sure you want to delete it?'
        );
        expect(el.shadowRoot.activeElement).toBe($('.rh-view-cancel'));
        expect($('.rh-view-save').textContent).toBe('Delete');
        $('.rh-view-save').click();
        expect(events).toEqual([{ type: 'delete', detail: null }]);
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(events[1].type).toBe('cancel');
    });

    it("shows the server's refusal, and waits while busy", async () => {
        await mount({
            mode: 'new',
            name: 'Closing this quarter',
            error: 'You already have a view named "Closing this quarter" of this grid.',
            busy: true
        });
        expect($('.rh-view-error').textContent).toContain('already have a view named');
        expect($('.rh-view-save').disabled).toBe(true);
    });
});
