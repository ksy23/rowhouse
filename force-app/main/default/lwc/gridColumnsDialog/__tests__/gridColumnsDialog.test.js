import { createElement } from 'lwc';
import GridColumnsDialog from 'c/gridColumnsDialog';

const COLUMNS = [
    { field: 'Name', label: 'Opportunity', alwaysShown: true },
    { field: 'StageName', label: 'Stage' },
    { field: 'Amount', label: 'Amount' },
    { field: 'CloseDate', label: 'Close Date' }
];

let el;
let events;
const mount = async (choice = null, columns = COLUMNS) => {
    el = createElement('c-grid-columns-dialog', { is: GridColumnsDialog });
    el.columns = columns;
    el.choice = choice;
    events = [];
    ['save', 'cancel'].forEach(type => el.addEventListener(type, e => events.push({ type, detail: e.detail })));
    document.body.appendChild(el);
    await Promise.resolve();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const lists = () => $('lightning-dual-listbox');

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('Choose columns', () => {
    it('offers every column, with the visible ones in the user\'s order, and keeps the admin\'s locked ones in', async () => {
        await mount({ order: ['Amount', 'Name', 'StageName', 'CloseDate'], hidden: ['StageName'] });
        expect($('h1').textContent).toBe('Choose columns');
        expect(lists().options).toEqual([
            { label: 'Opportunity', value: 'Name' },
            { label: 'Stage', value: 'StageName' },
            { label: 'Amount', value: 'Amount' },
            { label: 'Close Date', value: 'CloseDate' }
        ]);
        expect(lists().value).toEqual(['Amount', 'Name', 'CloseDate']);
        expect(lists().requiredOptions).toEqual(['Name']);
        expect(lists().sourceLabel).toBe('Available');
        expect(lists().selectedLabel).toBe('Visible');
        expect(String(lists().min)).toBe('1');
        expect($('.rh-columns-kept').textContent).toBe('Your admin keeps Opportunity on screen: it can be moved, not hidden.');
    });

    it('starts from the admin\'s columns without a choice, and says nothing of locks when there are none', async () => {
        await mount(null, COLUMNS.map(c => ({ field: c.field, label: c.label })));
        expect(lists().value).toEqual(['Name', 'StageName', 'Amount', 'CloseDate']);
        expect($('.rh-columns-kept')).toBeNull();
    });

    it('Save sends the Visible list as the user left it', async () => {
        await mount();
        lists().dispatchEvent(new CustomEvent('change', { detail: { value: ['StageName', 'Name'] } }));
        await Promise.resolve();
        $('.rh-columns-save').click();
        expect(events).toEqual([{ type: 'save', detail: { visible: ['StageName', 'Name'] } }]);
    });

    it('Save with nothing changed sends the columns as they are', async () => {
        await mount();
        $('.rh-columns-save').click();
        expect(events[0].detail.visible).toEqual(['Name', 'StageName', 'Amount', 'CloseDate']);
    });

    it('Cancel, the close button and Escape cancel', async () => {
        await mount();
        $('.rh-columns-cancel').click();
        $('.rh-columns-close').click();
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        $('section').dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(events.map(e => e.type)).toEqual(['cancel', 'cancel', 'cancel']);
    });

    it('is a modal dialog that keeps focus in itself', async () => {
        await mount();
        const section = $('section');
        expect(section.getAttribute('role')).toBe('dialog');
        expect(section.getAttribute('aria-modal')).toBe('true');
        $('[data-guard="end"]').dispatchEvent(new CustomEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-columns-close'));
        $('[data-guard="start"]').dispatchEvent(new CustomEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-columns-save'));
    });
});
