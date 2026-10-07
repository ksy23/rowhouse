/**
 * Column filters in the table: Filter… in a filterable column's menu,
 * the filter panel under the header, the filter icon on a filtered column, and
 * the chips above the table, the admin's locked. The table never filters rows
 * itself: it tells the parent the new list (filterchange) and shows whatever
 * filters the parent hands back. What each filter means is tested in
 * c/gridFilters; the panel's own controls in c/gridFilterPanel.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { describeFilter } from 'c/gridFilters';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, filterable: true },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true, sortable: true, filterable: true,
        options: [{ value: 'Open', label: 'Open' }, { value: 'Won', label: 'Won' }, { value: 'Lost', label: 'Lost' }] },
    { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, editable: true, sortable: true, filterable: true },
    { field: 'Notes__c', label: 'Notes', type: 'text', editable: true, sortable: true },
    { field: 'Region__c', label: 'Region', type: 'text', sortable: true, filterable: true },
    { field: 'Count__c', label: 'Count', type: 'number', sortable: false, filterable: true },
    // A formula column is never filterable, whatever the server says.
    { field: 'Score__c', label: 'Score', type: 'number', sortable: true, filterable: true, isFormula: true }
];
const ROWS = [
    { Id: 'a01000000000001AAA', Name: 'Acme', Stage__c: 'Open', Amount__c: 100, Notes__c: 'First', Region__c: 'North', Score__c: 3 },
    { Id: 'a01000000000002AAA', Name: 'Globex', Stage__c: 'Won', Amount__c: 900, Notes__c: 'Second', Region__c: 'South', Score__c: 7 }
];
const column = field => COLUMNS.find(c => c.field === field);
const STAGE_WON = { field: 'Stage__c', operator: 'equals', value: 'Won', valueTo: null };
const NAME_ACME = { field: 'Name', operator: 'contains', value: 'Acme', valueTo: null };
const ADMIN = [{ text: 'Status equals Active' }, { text: 'Created in the last 90 days' }];

let el;
let changes;
const mount = async (extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, ...extra };
    changes = [];
    el.addEventListener('filterchange', e => changes.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
/** The parent hands the table its filters back: a new config object (HR-17). */
const handBack = async extra => {
    el.config = { ...el.config, ...extra };
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const th = field => $(`th[data-field="${field}"]`);
const menuButton = field => $(`[data-menu-button][data-field="${field}"]`);
const items = () => $$('[role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitem"]');
const labels = () => items().map(i => i.textContent.trim());
const item = label => items().find(i => i.textContent.trim() === label);
const panel = () => $('c-grid-filter-panel');
const announcement = () => $('[data-grid-root] > [aria-live="polite"]').textContent;
const chips = () => $$('.rh-filter-chips .rh-filter-chip');
const chipText = chip => chip.querySelector('.slds-pill__label').textContent;
const key = async (target, k, mods = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    await flush();
    return event;
};
const openMenu = async field => {
    menuButton(field).click();
    await flush();
};
const openPanel = async (field, label = 'Filter…') => {
    await openMenu(field);
    item(label).click();
    await flush();
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('Filter… in the column menu', () => {
    it('is offered on a filterable column, after sorting and wrapping, with a divider above it', async () => {
        await mount();
        await openMenu('Name');
        expect(labels()).toEqual(['Sort ascending', 'Sort descending', 'Wrap text', 'Clip text', 'Filter…', 'Hide column']);
        const filter = item('Filter…');
        expect(filter.getAttribute('role')).toBe('menuitem'); // an action, not a choice
        expect(filter.closest('li').classList).toContain('slds-has-divider_top-space');
    });

    it('is offered on a column that has no other menu item but sorting', async () => {
        await mount();
        await openMenu('Amount__c');
        expect(labels()).toEqual(['Sort ascending', 'Sort descending', 'Filter…', 'Hide column']);
    });

    it('gives a column that cannot be sorted a menu of its own, for filtering', async () => {
        await mount();
        expect(th('Count__c').classList).toContain('slds-has-button-menu');
        await openMenu('Count__c');
        expect(labels()).toEqual(['Filter…', 'Hide column']);
        expect(item('Filter…').closest('li').classList).not.toContain('slds-has-divider_top-space');
    });

    it('is not offered on a column that is not filterable, or on a formula column', async () => {
        await mount();
        await openMenu('Notes__c');
        expect(labels()).not.toContain('Filter…');
        await openMenu('Score__c');
        expect(labels()).toEqual(['Sort ascending', 'Sort descending', 'Hide column']);
    });

    it('becomes Edit filter… and Remove filter once the column is filtered', async () => {
        await mount({ filters: [STAGE_WON] });
        await openMenu('Stage__c');
        expect(labels().slice(-3)).toEqual(['Edit filter…', 'Remove filter', 'Hide column']);
        // Only that column: the others still offer Filter….
        await openMenu('Name');
        expect(labels()).toContain('Filter…');
        expect(labels()).not.toContain('Remove filter');
    });

    it('is not in the cards layout, which has no column menus', async () => {
        await mount({ layout: 'cards' });
        expect(menuButton('Name')).toBeNull();
        expect(panel()).toBeNull();
    });
});

describe('the filter panel', () => {
    it('opens under the column\'s header, for that column, and the menu closes', async () => {
        await mount();
        await openPanel('Stage__c');
        expect($('[role="menu"]')).toBeNull();
        const p = panel();
        expect(p).not.toBeNull();
        expect(th('Stage__c').contains(p)).toBe(true); // under its own header
        expect(p.column.field).toBe('Stage__c');
        expect(p.filter).toBeNull();
        expect($$('c-grid-filter-panel')).toHaveLength(1);
        // Its heading names the column.
        expect(p.shadowRoot.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Filter Stage');
    });

    it('puts focus on the condition as it opens', async () => {
        await mount();
        await openPanel('Name');
        expect(el.shadowRoot.activeElement).toBe(panel());
        expect(panel().shadowRoot.activeElement).toBe(panel().shadowRoot.querySelector('select.rh-filter-operator'));
    });

    it('opens on the column\'s filter when it has one', async () => {
        await mount({ filters: [NAME_ACME, STAGE_WON] });
        await openPanel('Stage__c', 'Edit filter…');
        expect(panel().filter).toEqual(STAGE_WON);
    });

    it('apply: the table tells the parent the new list of filters, closes the panel and says so', async () => {
        await mount({ filters: [NAME_ACME] });
        await openPanel('Stage__c');
        panel().dispatchEvent(new CustomEvent('apply', { detail: { filter: STAGE_WON } }));
        await flush();
        expect(changes).toEqual([{ filters: [NAME_ACME, STAGE_WON] }]); // added after the ones there
        expect(panel()).toBeNull();
        expect(announcement()).toBe('Filtered: Stage equals Won');
        // Focus goes back to the column's menu button.
        expect(el.shadowRoot.activeElement).toBe(menuButton('Stage__c'));
    });

    it('apply on a filtered column replaces its filter in place: one filter per column', async () => {
        await mount({ filters: [NAME_ACME, STAGE_WON] });
        await openPanel('Name', 'Edit filter…');
        const next = { field: 'Name', operator: 'starts_with', value: 'Gl', valueTo: null };
        panel().dispatchEvent(new CustomEvent('apply', { detail: { filter: next } }));
        await flush();
        expect(changes).toEqual([{ filters: [next, STAGE_WON] }]);
    });

    it('remove: the table tells the parent the list without that column\'s filter', async () => {
        await mount({ filters: [NAME_ACME, STAGE_WON] });
        await openPanel('Stage__c', 'Edit filter…');
        panel().dispatchEvent(new CustomEvent('remove'));
        await flush();
        expect(changes).toEqual([{ filters: [NAME_ACME] }]);
        expect(panel()).toBeNull();
        expect(announcement()).toBe('Stage: filter removed');
    });

    it('cancel: closes the panel and changes nothing', async () => {
        await mount({ filters: [STAGE_WON] });
        await openPanel('Stage__c', 'Edit filter…');
        panel().dispatchEvent(new CustomEvent('cancel'));
        await flush();
        expect(panel()).toBeNull();
        expect(changes).toEqual([]);
        expect(el.shadowRoot.activeElement).toBe(menuButton('Stage__c'));
    });

    it('closes, changing nothing, when focus leaves it for the page', async () => {
        await mount();
        await openPanel('Name');
        panel().dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: document.body }));
        await flush();
        expect(panel()).toBeNull();
        expect(changes).toEqual([]);
    });

    it('stays open while focus moves between its own controls', async () => {
        await mount();
        await openPanel('Name');
        const inner = panel().shadowRoot.querySelector('button.rh-filter-cancel');
        panel().dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: inner }));
        await flush();
        // The relatedTarget is retargeted to the panel itself, which is inside the trigger.
        expect(panel()).not.toBeNull();
    });

    it('applies what the user chose in the panel: a complete filter, as the server takes it', async () => {
        await mount();
        await openPanel('Amount__c');
        const root = panel().shadowRoot;
        const operator = root.querySelector('select.rh-filter-operator');
        operator.value = 'between';
        operator.dispatchEvent(new CustomEvent('change'));
        await flush();
        const from = root.querySelector('input.rh-filter-value');
        from.value = '100';
        from.dispatchEvent(new CustomEvent('input'));
        const to = root.querySelector('input.rh-filter-value-to');
        to.value = '500';
        to.dispatchEvent(new CustomEvent('input'));
        await flush();
        root.querySelector('button.rh-filter-apply').click();
        await flush();
        const filter = { field: 'Amount__c', operator: 'between', value: '100', valueTo: '500' };
        expect(changes).toEqual([{ filters: [filter] }]);
        expect(announcement()).toBe('Filtered: ' + describeFilter(filter, column('Amount__c')));
    });

    it('does not tell the parent anything while the filter is incomplete', async () => {
        await mount();
        await openPanel('Name');
        panel().shadowRoot.querySelector('button.rh-filter-apply').click(); // Contains, with no value
        await flush();
        expect(changes).toEqual([]);
        expect(panel()).not.toBeNull(); // still open, saying what is missing
        expect(panel().shadowRoot.querySelector('.rh-filter-problem').textContent).toBe('Enter a value.');
    });
});

describe('from the keyboard', () => {
    it('Down Arrow opens the menu, arrows reach Filter…, Enter opens the panel', async () => {
        await mount();
        await key(menuButton('Stage__c'), 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(items()[0]);
        await key(items()[0], 'End');
        expect(el.shadowRoot.activeElement).toBe(item('Hide column')); // the last item
        await key(item('Hide column'), 'ArrowUp');
        expect(el.shadowRoot.activeElement).toBe(item('Filter…'));
        await key(item('Filter…'), 'Enter');
        expect($('[role="menu"]')).toBeNull();
        expect(panel()).not.toBeNull();
        expect(panel().column.field).toBe('Stage__c');
    });

    it('Enter in the panel applies; focus goes back to the menu button', async () => {
        await mount();
        await key(menuButton('Stage__c'), 'ArrowUp'); // opens on the last item: Hide column
        expect(el.shadowRoot.activeElement).toBe(item('Hide column'));
        await key(item('Hide column'), 'ArrowUp');
        expect(el.shadowRoot.activeElement).toBe(item('Filter…'));
        await key(item('Filter…'), ' ');
        // A picklist filter opens complete: Equals, the first value.
        const operator = panel().shadowRoot.querySelector('select.rh-filter-operator');
        await key(operator, 'Enter');
        expect(changes).toEqual([{ filters: [{ field: 'Stage__c', operator: 'equals', value: 'Open', valueTo: null }] }]);
        expect(panel()).toBeNull();
        expect(el.shadowRoot.activeElement).toBe(menuButton('Stage__c'));
    });

    it('Escape in the panel cancels, and does not reach the grid', async () => {
        await mount();
        await openPanel('Name');
        const operator = panel().shadowRoot.querySelector('select.rh-filter-operator');
        const event = await key(operator, 'Escape');
        expect(event.defaultPrevented).toBe(true);
        expect(panel()).toBeNull();
        expect(changes).toEqual([]);
        expect(el.shadowRoot.activeElement).toBe(menuButton('Name'));
    });

    it('typing in the panel does not start editing a cell', async () => {
        await mount();
        await openPanel('Name');
        await key(panel().shadowRoot.querySelector('select.rh-filter-operator'), 'a');
        expect($('[data-editor]')).toBeNull();
        expect(panel()).not.toBeNull();
    });

    it('Remove filter in the menu takes the column\'s filter off at once', async () => {
        await mount({ filters: [NAME_ACME, STAGE_WON] });
        await key(menuButton('Name'), 'ArrowUp'); // the last item: Hide column
        await key(item('Hide column'), 'ArrowUp');
        expect(el.shadowRoot.activeElement).toBe(item('Remove filter'));
        await key(item('Remove filter'), 'Enter');
        expect(changes).toEqual([{ filters: [STAGE_WON] }]);
        expect(panel()).toBeNull();
        expect(announcement()).toBe('Name: filter removed');
        expect(el.shadowRoot.activeElement).toBe(menuButton('Name'));
    });
});

describe('a filtered column', () => {
    it('shows the filter icon beside its label, and only that column', async () => {
        await mount({ filters: [STAGE_WON] });
        expect(th('Stage__c').querySelector('.rh-header-filter')).not.toBeNull();
        expect(th('Stage__c').querySelector('.rh-header-filter').getAttribute('aria-hidden')).toBe('true');
        expect($$('.rh-header-filter')).toHaveLength(1);
    });

    it('says so in its name, after "read only" for a column no one can edit here', async () => {
        await mount({ filters: [STAGE_WON, { field: 'Region__c', operator: 'is_blank', value: null, valueTo: null }] });
        expect(th('Stage__c').getAttribute('aria-label')).toBe('Stage, filtered');
        expect(th('Region__c').getAttribute('aria-label')).toBe('Region, read only, filtered');
        expect(th('Name').getAttribute('aria-label')).toBe('Name');
    });

    it('shows the filter in its label\'s tooltip', async () => {
        await mount({ filters: [STAGE_WON] });
        expect(th('Stage__c').querySelector('.slds-truncate[title]').getAttribute('title')).toBe('Stage: Stage equals Won');
        expect(th('Name').querySelector('.slds-truncate[title]').getAttribute('title')).toBe('Name');
    });

    it('changes only when the parent hands the filters back', async () => {
        await mount();
        await openPanel('Stage__c');
        panel().dispatchEvent(new CustomEvent('apply', { detail: { filter: STAGE_WON } }));
        await flush();
        expect(th('Stage__c').querySelector('.rh-header-filter')).toBeNull(); // not until the parent says so
        await handBack({ filters: changes[0].filters });
        expect(th('Stage__c').querySelector('.rh-header-filter')).not.toBeNull();
        expect(th('Stage__c').getAttribute('aria-label')).toBe('Stage, filtered');
    });
});

describe('the chips above the table', () => {
    it('are not there with no filters', async () => {
        await mount();
        expect($('.rh-filter-chips')).toBeNull();
    });

    it('show the admin\'s filters first, locked: a lock, no remove button, and who set them', async () => {
        await mount({ adminFilters: ADMIN, filters: [STAGE_WON] });
        const group = $('.rh-filter-chips');
        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-label')).toBe('Filters');
        expect(chips().map(chipText))
            .toEqual(['Status equals Active', 'Created in the last 90 days', 'Stage equals Won']);
        const admin = chips()[0];
        expect(admin.querySelector('.rh-filter-lock')).not.toBeNull();
        expect(admin.querySelector('button')).toBeNull();
        expect(admin.querySelector('.slds-assistive-text').textContent).toBe(', set by your Salesforce admin');
        expect(admin.querySelector('.slds-pill__label').getAttribute('title')).toBe('Status equals Active. Set by your Salesforce admin.');
    });

    it('show each of the user\'s filters with a button that removes it', async () => {
        await mount({ adminFilters: ADMIN, filters: [NAME_ACME, STAGE_WON] });
        const user = chips()[3];
        expect(user.querySelector('.rh-filter-lock')).toBeNull();
        const remove = user.querySelector('button.slds-pill__remove');
        expect(remove.getAttribute('title')).toBe('Remove filter: Stage equals Won');
        expect(remove.querySelector('.slds-assistive-text').textContent).toBe('Remove filter: Stage equals Won');
        remove.click();
        await flush();
        expect(changes).toEqual([{ filters: [NAME_ACME] }]);
        expect(announcement()).toBe('Stage: filter removed');
    });

    it('describe a filter in words, with the value as the column shows it', async () => {
        await mount({ filters: [NAME_ACME, { field: 'Amount__c', operator: 'greater_than', value: '500', valueTo: null }] });
        const text = chips().map(chipText);
        expect(text[0]).toBe('Name contains “Acme”');
        expect(text[1]).toBe(describeFilter({ field: 'Amount__c', operator: 'greater_than', value: '500' }, column('Amount__c')));
        expect(text[1]).toMatch(/^Amount greater than .*500\.00$/);
    });

    it('Clear filters takes off every one of the user\'s filters, and leaves the admin\'s to the server', async () => {
        await mount({ adminFilters: ADMIN, filters: [NAME_ACME, STAGE_WON] });
        $('.rh-filter-clear').click();
        await flush();
        expect(changes).toEqual([{ filters: [] }]);
        expect(announcement()).toBe('Filters cleared');
    });

    it('offer Clear filters only when the user has filters of their own', async () => {
        await mount({ adminFilters: ADMIN });
        expect(chips()).toHaveLength(2);
        expect($('.rh-filter-clear')).toBeNull();
        await handBack({ filters: [STAGE_WON] });
        expect($('.rh-filter-clear')).not.toBeNull();
        await handBack({ filters: [] });
        expect($('.rh-filter-clear')).toBeNull();
    });

    it('show above the cards too', async () => {
        await mount({ layout: 'cards', adminFilters: ADMIN.slice(0, 1), filters: [STAGE_WON] });
        expect(chips()).toHaveLength(2);
        chips()[1].querySelector('button').click();
        await flush();
        expect(changes).toEqual([{ filters: [] }]);
    });

    it('keep a filter on a column the grid no longer shows, by its field name', async () => {
        await mount({ filters: [{ field: 'Gone__c', operator: 'is_blank', value: null, valueTo: null }] });
        expect(chipText(chips()[0])).toBe('Gone__c is blank');
    });
});

describe('accessibility', () => {
    it('has no axe violations with chips and an open filter panel', async () => {
        await mount({ adminFilters: ADMIN, filters: [STAGE_WON] });
        await openPanel('Stage__c', 'Edit filter…');
        await frame();
        await expect(el).toBeAccessible();
    });
});
