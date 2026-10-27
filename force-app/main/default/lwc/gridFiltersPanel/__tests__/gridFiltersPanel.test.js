/**
 * The Filters panel: the admin's filters locked, the user's numbered, more
 * than one on a column, filter logic, and nothing applied until Apply.
 */
import { createElement } from 'lwc';
import GridFiltersPanel from 'c/gridFiltersPanel';

const COLUMNS = [
    { field: 'Name', label: 'Opportunity', type: 'text', filterable: true },
    {
        field: 'StageName',
        label: 'Stage',
        type: 'picklist',
        filterable: true,
        options: [
            { value: 'Prospecting', label: 'Prospecting' },
            { value: 'Qualification', label: 'Qualification' },
            { value: 'Closed Won', label: 'Closed Won' }
        ]
    },
    { field: 'Amount', label: 'Amount', type: 'currency', filterable: true, scale: 2 },
    { field: 'Description', label: 'Description', type: 'textarea', filterable: false }
];
const PROSPECTING = { field: 'StageName', operator: 'equals', value: 'Prospecting', valueTo: null };
const QUALIFICATION = { field: 'StageName', operator: 'equals', value: 'Qualification', valueTo: null };

let el;
let events;
const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const mount = async ({ filters = [], logic = '', adminFilters = [] } = {}) => {
    el = createElement('c-grid-filters-panel', { is: GridFiltersPanel });
    Object.assign(el, { columns: COLUMNS, filters, logic, adminFilters });
    events = [];
    ['apply', 'close'].forEach(type => el.addEventListener(type, e => events.push({ type, detail: e.detail })));
    document.body.appendChild(el);
    await settle();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const cards = () => $$('.rh-filters-edit').map(b => b.title);
const editor = () => el.shadowRoot.querySelector('c-grid-filter-panel');

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('the Filters panel', () => {
    it("shows the admin's filters locked and the user's numbered, matching all of them", async () => {
        await mount({ filters: [PROSPECTING], adminFilters: [{ text: 'Close Date is this quarter' }] });
        expect($('h2').textContent).toBe('Filters');
        expect($('.rh-filters-locked').textContent).toBe('Close Date is this quarter');
        expect($('.rh-filters-matching').textContent).toBe('Matching all of these filters');
        expect(cards()).toEqual(['Edit filter 1: Stage equals Prospecting']);
        expect($('.rh-filters-apply')).toBeNull(); // nothing to apply yet
        await expect(el).toBeAccessible();
    });

    it('adds a filter on a column that already has one, and applies only on Apply', async () => {
        await mount({ filters: [PROSPECTING] });
        $('.rh-filters-add').click();
        await settle();
        const field = $('.rh-filters-field');
        expect([...field.options].map(o => o.textContent)).toEqual([
            'Choose a column',
            'Amount',
            'Opportunity',
            'Stage'
        ]);
        field.value = 'StageName';
        field.dispatchEvent(new CustomEvent('change'));
        await settle();
        expect(editor().inline).toBe(true);
        editor().dispatchEvent(new CustomEvent('apply', { detail: { filter: QUALIFICATION } }));
        await settle();
        expect(cards()).toEqual([
            'Edit filter 1: Stage equals Prospecting',
            'Edit filter 2: Stage equals Qualification'
        ]);
        expect(events).toEqual([]);
        expect($('.rh-filters-card_changed')).not.toBeNull();
        // Two filters on Stage need OR: filter logic, written with AND to start.
        $('.rh-filters-add-logic').click();
        await settle();
        const logic = $('.rh-filters-logic');
        expect(logic.value).toBe('1 AND 2');
        logic.value = '1 or 2';
        logic.dispatchEvent(new CustomEvent('change', { detail: { value: logic.value } }));
        await settle();
        expect($('.rh-filters-matching').textContent).toBe('Matching the filter logic below');
        $('.rh-filters-apply').click();
        expect(events).toEqual([{ type: 'apply', detail: { filters: [PROSPECTING, QUALIFICATION], logic: '1 OR 2' } }]);
    });

    it("refuses logic that cannot work, in the server's words, and applies nothing", async () => {
        await mount({ filters: [PROSPECTING, QUALIFICATION], logic: '1 OR 2' });
        const logic = $('.rh-filters-logic');
        logic.value = '1 OR 3';
        logic.dispatchEvent(new CustomEvent('change', { detail: { value: logic.value } }));
        await settle();
        $('.rh-filters-apply').click();
        await settle();
        expect(events).toEqual([]);
        expect($('.rh-filters-logic-problem').textContent).toBe('The filter logic references an undefined filter: 3.');
    });

    it('a filter removed clears the logic, whose numbers no longer match; Cancel puts everything back', async () => {
        await mount({ filters: [PROSPECTING, QUALIFICATION], logic: '1 OR 2' });
        $$('.rh-filters-remove')[0].click();
        await settle();
        expect(cards()).toEqual(['Edit filter 1: Stage equals Qualification']);
        expect($('.rh-filters-logic')).toBeNull();
        $('.rh-filters-cancel').click();
        await settle();
        expect(cards().length).toBe(2);
        expect($('.rh-filters-logic').value).toBe('1 OR 2');
    });

    it('edits a filter in place, and Remove All takes every filter and the logic', async () => {
        await mount({ filters: [PROSPECTING, QUALIFICATION], logic: '1 OR 2' });
        $$('.rh-filters-edit')[1].click();
        await settle();
        expect(editor().filter).toEqual(QUALIFICATION);
        editor().dispatchEvent(
            new CustomEvent('apply', { detail: { filter: { ...QUALIFICATION, value: 'Closed Won' } } })
        );
        await settle();
        expect(cards()[1]).toBe('Edit filter 2: Stage equals Closed Won');
        $('.rh-filters-remove-all').click();
        await settle();
        expect(cards()).toEqual([]);
        $('.rh-filters-apply').click();
        expect(events).toEqual([{ type: 'apply', detail: { filters: [], logic: '' } }]);
    });

    it('closes from its cross, and on Escape', async () => {
        await mount();
        $('.rh-filters-close').click();
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(events.map(e => e.type)).toEqual(['close', 'close']);
    });
});
