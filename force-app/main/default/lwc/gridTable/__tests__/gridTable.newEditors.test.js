/**
 * The date/time, time and text area editors in the table and in cards,
 * and values the server shortened (row._cut, TC-055): such a cell is edited in
 * the text area editor, which reads the whole text first, whatever the
 * column's type, and is never the source of a fill down. The editors' own
 * behaviour is tested in c/cellDateTime, c/cellTime and c/cellTextarea; here,
 * only which editor the table opens and what it hands it.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import fetchFullText from '@salesforce/apex/GridController.fetchFullText';

jest.mock('@salesforce/apex/GridController.fetchFullText', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, length: 80 },
    { field: 'Picked_Up__c', label: 'Picked Up', type: 'datetime', editable: true, required: true },
    { field: 'Pickup_Time__c', label: 'Pickup Time', type: 'time', editable: true },
    { field: 'Delivery_Notes__c', label: 'Delivery Notes', type: 'textarea', editable: true, length: 32768 },
    { field: 'Handling_Instructions__c', label: 'Handling Instructions', type: 'text', editable: true, length: 255 },
    { field: 'Billing_Notes__c', label: 'Billing Notes', type: 'textarea', editable: false }
];
const ROW1 = 'a01000000000001AAA';
const ROW2 = 'a01000000000002AAA';
const ROW3 = 'a01000000000003AAA';
// the first 1,000 characters, as the server sends them
const LONG = 'Call dispatch 30 minutes before arriving in Bath. '.repeat(20);
const ROWS = [
    {
        Id: ROW1,
        Name: 'Kennebec Lumber, 12 bundles',
        Picked_Up__c: '2026-10-01T14:30:00.000Z',
        Pickup_Time__c: '09:15:00.000Z',
        Delivery_Notes__c: 'Leave at the side door',
        Handling_Instructions__c: 'Keep dry',
        Billing_Notes__c: 'Rebilled to Wachusett Paper'
    },
    // The server shortened two long values in this row (TC-055).
    {
        Id: ROW2,
        Name: 'Penobscot Paper, full truck',
        Picked_Up__c: null,
        Pickup_Time__c: '17:30:00.000Z',
        Delivery_Notes__c: LONG,
        Handling_Instructions__c: 'Fragile glassware; keep upright and do not stack. '.repeat(4),
        Billing_Notes__c: null,
        _cut: ['Delivery_Notes__c', 'Handling_Instructions__c']
    },
    {
        Id: ROW3,
        Name: 'Reefer load, Machias',
        Picked_Up__c: null,
        Pickup_Time__c: null,
        Delivery_Notes__c: 'Call ahead for the liftgate',
        Handling_Instructions__c: 'Stack two high',
        Billing_Notes__c: null
    }
];

let el;
let change;
let changes;
const mount = async (extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, configName: 'Consignments', ...extra };
    change = jest.fn();
    changes = [];
    el.addEventListener('cellchange', change);
    el.addEventListener('cellschange', e => changes.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const cell = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);
const editors = () => $$('[data-editor]');
const announcement = () => $('[data-grid-root] > [aria-live="polite"]').textContent;
const key = async (target, k, mods = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    await flush();
    return event;
};
const focusOn = async (rowId, field) => {
    const td = cell(rowId, field);
    td.focus();
    await flush();
    return td;
};
const editByPencil = async (rowId, field) => {
    cell(rowId, field).querySelector('button').click();
    await flush();
};

beforeEach(() => {
    fetchFullText.mockResolvedValue('Call dispatch 30 minutes before arriving in Bath. '.repeat(100));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('the new editors in the table', () => {
    it('a date/time cell opens the date/time editor with its value, label and required', async () => {
        await mount();
        await editByPencil(ROW1, 'Picked_Up__c');
        expect(editors()).toHaveLength(1);
        const editor = $('c-cell-date-time[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.mode).toBe('edit');
        expect(editor.value).toBe(ROWS[0].Picked_Up__c);
        expect(editor.label).toBe('Picked Up');
        expect(editor.required).toBe(true);
        expect(editor.dropdownAlign).toBe('left');
        // It sits in the cell's edit popover.
        expect(cell(ROW1, 'Picked_Up__c').querySelector('section.rh-edit-popover').contains(editor)).toBe(true);
    });

    it('a time cell opens the time editor, from F2', async () => {
        await mount();
        const td = await focusOn(ROW2, 'Pickup_Time__c');
        await key(td, 'F2');
        const editor = $('c-cell-time[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.value).toBe('17:30:00.000Z');
        expect(editor.label).toBe('Pickup Time');
        expect(editor.required).toBe(false);
    });

    it("a text area cell opens the text area editor, from Enter, with the field's length", async () => {
        await mount();
        const td = await focusOn(ROW1, 'Delivery_Notes__c');
        await key(td, 'Enter');
        const editor = $('c-cell-textarea[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.value).toBe('Leave at the side door');
        expect(editor.maxLength).toBe(32768);
        expect(editor.cut).toBe(false); // the whole value is here: nothing to read
        expect(editor.recordId).toBe(ROW1);
        expect(editor.field).toBe('Delivery_Notes__c');
        expect(editor.configName).toBe('Consignments');
        expect(fetchFullText).not.toHaveBeenCalled();
    });

    it('a double-click opens them too', async () => {
        await mount();
        cell(ROW3, 'Picked_Up__c').dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true })
        );
        await flush();
        expect($('c-cell-date-time[data-editor]')).not.toBeNull();
    });

    it('typing on a time or a date/time cell opens its editor on the stored value, not the character', async () => {
        await mount();
        const td = await focusOn(ROW1, 'Pickup_Time__c');
        await key(td, '7');
        const editor = $('c-cell-time[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.value).toBe('09:15:00.000Z');
        expect(editor.seed).toBeUndefined();
    });

    it.each([
        ['Picked_Up__c', 'c-cell-date-time', '2026-12-24T09:00:00.000Z'],
        ['Pickup_Time__c', 'c-cell-time', '18:00:00.000Z'],
        ['Delivery_Notes__c', 'c-cell-textarea', 'Rear dock only\nCall ahead on arrival']
    ])('%s: a commit from %s reports the new value', async (field, tag, value) => {
        await mount();
        await editByPencil(ROW1, field);
        $(`${tag}[data-editor]`).dispatchEvent(new CustomEvent('commit', { detail: { value } }));
        await flush();
        expect(change).toHaveBeenCalledTimes(1);
        expect(change.mock.calls[0][0].detail).toEqual({ recordId: ROW1, field, value, originalValue: ROWS[0][field] });
        expect(editors()).toHaveLength(0);
        // Focus is back on the same cell (HR-13).
        expect(el.shadowRoot.activeElement).toBe(cell(ROW1, field));
    });

    it('a cancel leaves the cell as it was', async () => {
        await mount();
        await editByPencil(ROW1, 'Pickup_Time__c');
        $('c-cell-time[data-editor]').dispatchEvent(new CustomEvent('cancel'));
        await flush();
        expect(change).not.toHaveBeenCalled();
        expect(editors()).toHaveLength(0);
    });

    it('a read-only text area has no editor', async () => {
        await mount();
        expect(cell(ROW1, 'Billing_Notes__c').querySelector('button').disabled).toBe(true);
        const td = await focusOn(ROW1, 'Billing_Notes__c');
        await key(td, 'F2');
        expect(editors()).toHaveLength(0);
    });
});

describe('a value the server shortened (row._cut)', () => {
    it('opens the text area editor, which reads the whole text for the grid, record and field', async () => {
        await mount();
        await editByPencil(ROW2, 'Delivery_Notes__c');
        const editor = $('c-cell-textarea[data-editor]');
        expect(editor.cut).toBe(true);
        expect(editor.configName).toBe('Consignments');
        expect(editor.recordId).toBe(ROW2);
        expect(editor.field).toBe('Delivery_Notes__c');
        expect(editor.maxLength).toBe(32768);
        expect(fetchFullText).toHaveBeenCalledWith({
            configName: 'Consignments',
            recordId: ROW2,
            field: 'Delivery_Notes__c'
        });
    });

    it("opens the text area editor whatever the column's type", async () => {
        await mount();
        const td = await focusOn(ROW2, 'Handling_Instructions__c');
        await key(td, 'Enter');
        expect($('c-cell-text[data-editor]')).toBeNull();
        const editor = $('c-cell-textarea[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.cut).toBe(true);
        expect(editor.maxLength).toBe(255); // the text field's own length
        expect(editor.field).toBe('Handling_Instructions__c');
    });

    it('does not take a typed character as the start of a new value', async () => {
        await mount();
        const td = await focusOn(ROW2, 'Handling_Instructions__c');
        await key(td, 'q');
        const editor = $('c-cell-textarea[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.value).toBe(ROWS[1].Handling_Instructions__c);
    });

    it('only in the row that was shortened: the same column elsewhere opens its own editor', async () => {
        await mount();
        await editByPencil(ROW1, 'Handling_Instructions__c');
        expect($('c-cell-text[data-editor]')).not.toBeNull();
        expect($('c-cell-textarea[data-editor]')).toBeNull();
    });

    it("with an unsaved edit, opens the column's own editor on the edit: there is nothing more to read", async () => {
        await mount({ drafts: { [ROW2]: { Handling_Instructions__c: 'Keep dry, do not stack' } } });
        await editByPencil(ROW2, 'Handling_Instructions__c');
        const editor = $('c-cell-text[data-editor]');
        expect(editor).not.toBeNull();
        expect(editor.value).toBe('Keep dry, do not stack');
        expect(fetchFullText).not.toHaveBeenCalled();
    });

    it('reports the whole new text when committed', async () => {
        await mount();
        await editByPencil(ROW2, 'Delivery_Notes__c');
        const whole = 'Deliver to the rear dock on Commercial Street, Portland. '.repeat(70);
        $('c-cell-textarea[data-editor]').dispatchEvent(new CustomEvent('commit', { detail: { value: whole } }));
        await flush();
        expect(change.mock.calls[0][0].detail).toEqual({
            recordId: ROW2,
            field: 'Delivery_Notes__c',
            value: whole,
            originalValue: LONG
        });
    });

    it("makes room for the text area under a shortened text cell, not a text box's", async () => {
        await mount({ height: 600 });
        const scroller = $('[data-scroller]');
        scroller.getBoundingClientRect = () => ({ top: 100, bottom: 170, left: 0, right: 1200 });
        Object.defineProperty(scroller, 'clientHeight', { value: 70, configurable: true });
        cell(ROW2, 'Handling_Instructions__c').getBoundingClientRect = () => ({
            top: 133,
            bottom: 166,
            left: 0,
            right: 150
        });
        await editByPencil(ROW2, 'Handling_Instructions__c');
        // 66px to the row's bottom and 280px for the text area (EDITOR_ROOM_BY.textarea).
        expect(scroller.style.minHeight).toBe(`${66 + 280}px`);
    });
});

describe('fill down from a shortened value', () => {
    it('leaves that column out, says so, and fills the rest of the range', async () => {
        await mount();
        await focusOn(ROW2, 'Delivery_Notes__c');
        await key(cell(ROW2, 'Delivery_Notes__c'), 'ArrowDown', { shiftKey: true });
        await key(cell(ROW3, 'Delivery_Notes__c'), 'ArrowLeft', { shiftKey: true });
        await key(cell(ROW3, 'Pickup_Time__c'), 'd', { metaKey: true });
        expect(changes).toHaveLength(1);
        expect(changes[0].label).toBe('fill down');
        expect(changes[0].changes).toEqual([
            { recordId: ROW3, field: 'Pickup_Time__c', value: ROWS[1].Pickup_Time__c, originalValue: null }
        ]);
        // What was filled is said first, then what was left out.
        expect(announcement()).toBe(
            'Filled down 1 cell. Delivery Notes not filled down: the text is too long to copy here. Edit it on its own.'
        );
    });

    it('on one cell, Cmd+D under a shortened value fills nothing', async () => {
        await mount();
        await focusOn(ROW3, 'Handling_Instructions__c');
        await key(cell(ROW3, 'Handling_Instructions__c'), 'd', { ctrlKey: true });
        expect(changes).toEqual([]);
        expect(announcement()).toBe(
            'Handling Instructions not filled down: the text is too long to copy here. Edit it on its own.'
        );
    });

    it('names every column left out', async () => {
        await mount();
        await focusOn(ROW2, 'Delivery_Notes__c');
        await key(cell(ROW2, 'Delivery_Notes__c'), 'ArrowRight', { shiftKey: true });
        await key(cell(ROW2, 'Handling_Instructions__c'), 'ArrowDown', { shiftKey: true });
        await key(cell(ROW3, 'Handling_Instructions__c'), 'd', { metaKey: true });
        expect(changes).toEqual([]);
        expect(announcement()).toBe(
            'Delivery Notes, Handling Instructions not filled down: the text is too long to copy here. Edit it on its own.'
        );
    });

    it('fills from a shortened value that has an unsaved edit: the edit is whole', async () => {
        await mount({ drafts: { [ROW2]: { Delivery_Notes__c: 'Deliver to the rear dock' } } });
        await focusOn(ROW3, 'Delivery_Notes__c');
        await key(cell(ROW3, 'Delivery_Notes__c'), 'd', { metaKey: true });
        expect(changes[0].changes).toEqual([
            {
                recordId: ROW3,
                field: 'Delivery_Notes__c',
                value: 'Deliver to the rear dock',
                originalValue: 'Call ahead for the liftgate'
            }
        ]);
    });

    it('fills a shortened value from a whole one above it', async () => {
        await mount();
        await focusOn(ROW2, 'Delivery_Notes__c');
        await key(cell(ROW2, 'Delivery_Notes__c'), 'd', { metaKey: true });
        expect(changes[0].changes).toEqual([
            { recordId: ROW2, field: 'Delivery_Notes__c', value: 'Leave at the side door', originalValue: LONG }
        ]);
    });
});

describe('the new editors in cards', () => {
    // A card shows its title (the first column) and three fields: Picked Up, Pickup Time and Delivery Notes.
    const cardEdit = async (rowId, field) => {
        $(`[data-card-edit][data-row-id="${rowId}"][data-field="${field}"]`).click();
        await flush();
    };
    const cardEditor = () => $('.rh-card-editor [data-editor]');

    it.each([
        ['Picked_Up__c', 'C-CELL-DATE-TIME'],
        ['Pickup_Time__c', 'C-CELL-TIME'],
        ['Delivery_Notes__c', 'C-CELL-TEXTAREA']
    ])('%s opens %s, and its commit reports the value', async (field, tag) => {
        await mount({ layout: 'cards' });
        await cardEdit(ROW1, field);
        const editor = cardEditor();
        expect(editor.tagName).toBe(tag);
        expect(editor.value).toBe(ROWS[0][field]);
        expect(editor.label).toBe(COLUMNS.find(c => c.field === field).label);
        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: null } }));
        await flush();
        expect(change.mock.calls[0][0].detail).toEqual({
            recordId: ROW1,
            field,
            value: null,
            originalValue: ROWS[0][field]
        });
    });

    it('a shortened value opens the text area editor, which reads the whole text', async () => {
        await mount({ layout: 'cards' });
        await cardEdit(ROW2, 'Delivery_Notes__c');
        const editor = cardEditor();
        expect(editor.tagName).toBe('C-CELL-TEXTAREA');
        expect(editor.cut).toBe(true);
        expect(editor.configName).toBe('Consignments');
        expect(editor.recordId).toBe(ROW2);
        expect(editor.field).toBe('Delivery_Notes__c');
        expect(editor.maxLength).toBe(32768);
        expect(fetchFullText).toHaveBeenCalledWith({
            configName: 'Consignments',
            recordId: ROW2,
            field: 'Delivery_Notes__c'
        });
    });

    it('a shortened text value opens the text area editor in a card too', async () => {
        await mount({ layout: 'cards' });
        $(`.rh-card-more[data-row-id="${ROW2}"]`).click(); // Handling Instructions is the fourth field: show them all
        await flush();
        await cardEdit(ROW2, 'Handling_Instructions__c');
        expect(cardEditor().tagName).toBe('C-CELL-TEXTAREA');
        expect(cardEditor().maxLength).toBe(255);
    });
});
