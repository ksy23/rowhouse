/**
 * The lookup and owner editor: search as you type, choose with the
 * keyboard or the mouse, and commit the record Id with its name.
 */
import { createElement } from 'lwc';
import CellLookup, { SEARCH_DELAY_MS } from 'c/cellLookup';
import searchLookup from '@salesforce/apex/GridController.searchLookup';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ACME = { id: '001000000000001AAA', name: 'Acme Corp', kind: 'Account' };
const ACORN = { id: '001000000000002AAA', name: 'Acorn Ltd', kind: 'Account' };

describe('cellLookup', () => {
    let el;
    let commits;
    const input = () => el.shadowRoot.querySelector('input');
    const options = () => [...el.shadowRoot.querySelectorAll('[role="option"]')];
    const key = k =>
        input().dispatchEvent(
            new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true })
        );
    const type = async text => {
        input().value = text;
        input().dispatchEvent(new CustomEvent('input', { bubbles: true, composed: true }));
        await wait(SEARCH_DELAY_MS + 20);
        await flush();
    };

    beforeEach(async () => {
        searchLookup.mockResolvedValue([ACME, ACORN]);
        el = createElement('c-cell-lookup', { is: CellLookup });
        Object.assign(el, {
            mode: 'edit',
            label: 'Account',
            configName: 'Test_Records',
            field: 'Lookup_Field__c',
            value: '001000000000009AAA',
            valueLabel: 'Current Co'
        });
        commits = [];
        el.addEventListener('commit', e => commits.push(e.detail));
        document.body.appendChild(el);
        await flush();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        jest.clearAllMocks();
    });

    it('starts with the current record name, and no list', () => {
        expect(input().value).toBe('Current Co');
        expect(input().getAttribute('role')).toBe('combobox');
        expect(input().getAttribute('aria-expanded')).toBe('false');
        expect(options()).toHaveLength(0);
    });

    it('searches the grid column after the user pauses, and lists the matches', async () => {
        await type('ac');
        expect(searchLookup).toHaveBeenCalledTimes(1);
        expect(searchLookup).toHaveBeenCalledWith({ configName: 'Test_Records', field: 'Lookup_Field__c', term: 'ac' });
        expect(options().map(o => o.textContent)).toEqual(['Acme CorpAccount', 'Acorn LtdAccount']);
        expect(input().getAttribute('aria-expanded')).toBe('true');
        expect(options()[0].getAttribute('aria-selected')).toBe('true');
        expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    });

    it('hangs the matches from the box’s left edge, or its right when the table says so', async () => {
        const list = () => el.shadowRoot.querySelector('[role="listbox"]');
        expect(list().classList).toContain('rh-lookup-list');
        expect(list().classList).toContain('slds-dropdown_left');
        el.dropdownAlign = 'right';
        await flush();
        expect(list().classList).toContain('slds-dropdown_right');
        expect(list().classList).not.toContain('slds-dropdown_left');
    });

    it('opens the matches above the box when the table says there is no room below', async () => {
        const list = () => el.shadowRoot.querySelector('[role="listbox"]');
        expect(list().classList).not.toContain('slds-dropdown_bottom');
        el.dropdownUp = true;
        await flush();
        expect(list().classList).toContain('slds-dropdown_bottom');
    });

    it("shows each match with its object's icon, the record icon when it has none", async () => {
        searchLookup.mockResolvedValue([
            { ...ACME, object: 'Account' },
            { ...ACORN, object: 'Other__c' }
        ]);
        el.icons = { Account: 'standard:account' };
        await type('ac');
        const icons = [...el.shadowRoot.querySelectorAll('[role="option"] lightning-icon')].map(i => i.iconName);
        expect(icons).toEqual(['standard:account', 'standard:record']);
    });

    it('scrolls new matches into view, once per answer', async () => {
        // JSDOM has no scrollIntoView; the browser's is replaced for this test only.
        const scroll = jest.fn();
        Element.prototype.scrollIntoView = scroll;
        try {
            await type('ac');
            expect(scroll).toHaveBeenCalledTimes(1);
            expect(scroll.mock.contexts[0].getAttribute('role')).toBe('listbox');
            expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
            key('ArrowDown'); // re-renders, but the list did not just open
            await flush();
            expect(scroll).toHaveBeenCalledTimes(1);
            searchLookup.mockResolvedValue([]);
            await type('zzz');
            expect(scroll).toHaveBeenCalledTimes(1);
        } finally {
            delete Element.prototype.scrollIntoView;
        }
    });

    it('moves through the matches with the arrows and commits the chosen one with its name', async () => {
        await type('ac');
        key('ArrowDown');
        await flush();
        expect(options()[1].getAttribute('aria-selected')).toBe('true');
        key('Enter');
        expect(commits).toEqual([{ value: ACORN.id, label: ACORN.name }]);
    });

    it('commits a match that is clicked', async () => {
        await type('ac');
        options()[0].click();
        expect(commits).toEqual([{ value: ACME.id, label: ACME.name }]);
    });

    it('clears the lookup when the box is emptied', async () => {
        await type('');
        key('Enter');
        expect(commits).toEqual([{ value: null, label: null }]);
        expect(searchLookup).not.toHaveBeenCalled();
    });

    it('keeps the value it had when the user leaves without choosing', async () => {
        await type('zzz');
        key('Tab');
        expect(commits).toEqual([{ value: '001000000000009AAA', label: 'Current Co' }]);
    });

    it('cancels on Escape, saying whether a list was open', async () => {
        const cancels = [];
        el.addEventListener('cancel', e => cancels.push(e.detail));
        await type('ac');
        key('Escape');
        key('Escape');
        expect(cancels).toEqual([{ listOpen: true }, { listOpen: false }]);
        expect(commits).toEqual([]);
    });

    it('keeps Tab for the grid, and in a form lets it move on, showing the name chosen', async () => {
        await type('ac');
        let tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true });
        input().dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true); // the grid moves focus itself
        el.tabLeaves = true;
        await type('ac');
        key('ArrowDown');
        key('Enter');
        // A form keeps the choice as the lookup's value, as the dialog does.
        Object.assign(el, { value: ACORN.id, valueLabel: ACORN.name });
        await flush();
        expect(input().value).toBe(ACORN.name);
        tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true });
        input().dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(false);
        expect(commits[commits.length - 1]).toEqual({ value: ACORN.id, label: ACORN.name });
    });

    it('drops an answer that arrives after a newer search started', async () => {
        let resolveFirst;
        searchLookup.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    resolveFirst = resolve;
                })
        );
        await type('a');
        searchLookup.mockResolvedValueOnce([ACORN]);
        await type('aco');
        resolveFirst([ACME]);
        await flush();
        expect(options().map(o => o.dataset.index)).toEqual(['0']);
        expect(options()[0].textContent).toContain('Acorn Ltd');
    });

    it('says so when nothing matches, and when the search fails', async () => {
        const status = () => el.shadowRoot.querySelector('[aria-live="polite"]').textContent;
        searchLookup.mockResolvedValueOnce([]);
        await type('none');
        expect(status()).toBe('No matches.');
        searchLookup.mockRejectedValueOnce({ body: { message: 'No access' } });
        await type('boom');
        expect(status()).toBe('Search failed: No access');
    });
});
