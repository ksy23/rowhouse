/**
 * Room for an open menu. A column's menu and a row's actions menu sit
 * inside the grid's scroller, which clips them: on a grid showing one row, a
 * column menu showed only its first item and a row menu had no room either
 * way. As for an editor,
 * a short grid grows while a menu is open, never past its maximum; a row menu
 * opens upwards only where it fits under the header. JSDOM has no layout, so
 * each test gives the boxes.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    { field: 'Text__c', label: 'Text', type: 'text', editable: true, sortable: true }
];
const ROW_ID = 'a01000000000001AAA';
const ROWS = [{ Id: ROW_ID, Name: 'One', Text__c: 'x' }];
const ACTIONS = [
    { name: 'Add_Note', label: 'Add a note' },
    { name: 'Mark_Seen', label: 'Mark as seen' },
    { name: 'Log_Call', label: 'Log a call' }
];

let el;
let rects;
const $ = selector => el.shadowRoot.querySelector(selector);
const scroller = () => $('[data-scroller]');
const rowMenu = () => $('.rh-row-menu');

/** The boxes, by selector; anything else has no size, as in JSDOM. */
const layout = (boxes, scrollerClientHeight) => {
    rects = Object.entries(boxes).map(([selector, r]) => [selector, { left: 0, right: 1200, ...r }]);
    Object.defineProperty(scroller(), 'clientHeight', { value: scrollerClientHeight, configurable: true });
};

const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, rowActions: ACTIONS, configName: 'Test_Records', ...config };
    document.body.appendChild(el);
    await flush();
};

beforeEach(() => {
    rects = [];
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
        const hit = rects.find(([selector]) => this.matches(selector));
        return hit ? hit[1] : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    });
});

afterEach(() => {
    jest.restoreAllMocks();
    while (document.body.firstChild) document.body.firstChild.remove();
});

const openColumnMenu = async field => {
    $(`[data-menu-button][data-field="${field}"]`).click();
    await flush();
    await frame();
};

const openRowMenu = async () => {
    $(`[data-row-menu-button][data-row-id="${ROW_ID}"]`).click();
    await flush();
    await frame();
};

describe('room for an open column menu', () => {
    it('grows a one-row grid to hold the menu, then gives the room back', async () => {
        await mount({ height: 600 });
        // The box is one row tall; the menu, drawn below the header, ends 130px below its top.
        layout({ '[data-scroller]': { top: 100, bottom: 170 }, '.rh-column-menu': { top: 133, bottom: 230 } }, 70);
        await openColumnMenu('Name');
        expect(scroller().style.minHeight).toBe(`${230 - 100 + 4}px`);
        expect(scroller().style.maxHeight).toBe('600px');
        $('[data-menu-button][data-field="Name"]').click();
        await flush();
        expect($('.rh-column-menu')).toBeNull();
        expect(scroller().style.minHeight).toBe('');
    });

    it('never grows past the grid’s own height', async () => {
        await mount({ height: 160 }); // the smallest Height an admin can give (MIN_FIXED_HEIGHT)
        layout({ '[data-scroller]': { top: 100, bottom: 170 }, '.rh-column-menu': { top: 133, bottom: 330 } }, 70);
        await openColumnMenu('Name');
        expect(scroller().style.minHeight).toBe('160px');
    });

    it('leaves a grid alone when the menu already fits', async () => {
        await mount({ height: 600 });
        layout({ '[data-scroller]': { top: 100, bottom: 700 }, '.rh-column-menu': { top: 133, bottom: 230 } }, 600);
        await openColumnMenu('Name');
        expect(scroller().style.minHeight).toBe('');
    });

    it('counts a horizontal scrollbar, which hides the bottom of the box', async () => {
        await mount({ height: 600 });
        // 15px of the 70px box is a scrollbar; the menu ends inside the box but under it.
        layout({ '[data-scroller]': { top: 100, bottom: 170 }, '.rh-column-menu': { top: 133, bottom: 160 } }, 55);
        await openColumnMenu('Name');
        expect(scroller().style.minHeight).toBe(`${160 - 100 + 4 + 15}px`);
    });
});

describe('room for an open row menu', () => {
    it('opens downwards on a one-row grid, where the header leaves no room above, and grows the grid', async () => {
        await mount({ height: 600 });
        layout({
            '[data-scroller]': { top: 100, bottom: 170 },
            thead: { top: 100, bottom: 133 },
            'td[data-field="__actions"]': { top: 133, bottom: 166 },
            '.rh-row-menu': { top: 166, bottom: 290 }
        }, 70);
        await openRowMenu();
        expect(rowMenu().classList).not.toContain('slds-dropdown_bottom');
        expect(scroller().style.minHeight).toBe(`${290 - 100 + 4}px`);
        const item = el.shadowRoot.querySelector(`[role="menuitem"][data-row-id="${ROW_ID}"]`);
        item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
        await flush();
        expect(rowMenu()).toBeNull();
        expect(scroller().style.minHeight).toBe('');
    });

    it('opens upwards when it does not fit below the row but fits between the row and the header', async () => {
        await mount({ height: 600 });
        layout({
            '[data-scroller]': { top: 100, bottom: 700 },
            thead: { top: 100, bottom: 133 },
            'td[data-field="__actions"]': { top: 650, bottom: 683 },
            '.rh-row-menu': { top: 534, bottom: 650 }
        }, 600);
        await openRowMenu();
        expect(rowMenu().classList).toContain('slds-dropdown_bottom');
        expect(scroller().style.minHeight).toBe('');
    });

    it('does not open upwards under the header, even with more room above than below', async () => {
        await mount({ height: 600 });
        // Three actions need 116px. Below the row: 67px; above it, under the header: 67px.
        layout({
            '[data-scroller]': { top: 100, bottom: 300 },
            thead: { top: 100, bottom: 133 },
            'td[data-field="__actions"]': { top: 200, bottom: 233 },
            '.rh-row-menu': { top: 233, bottom: 349 }
        }, 200);
        await openRowMenu();
        expect(rowMenu().classList).not.toContain('slds-dropdown_bottom');
        expect(scroller().style.minHeight).toBe(`${349 - 100 + 4}px`);
    });
});

describe('room for an open filter panel', () => {
    it('grows a short grid to hold the panel, measured inside the panel, and gives it back', async () => {
        await mount({ height: 600, columns: COLUMNS.map(c => ({ ...c, filterable: true })) });
        // The panel is drawn inside its own component; it ends 290px below the box's top.
        layout({ '[data-scroller]': { top: 100, bottom: 170 }, '.rh-filter-panel': { top: 133, bottom: 390 } }, 70);
        await openColumnMenu('Text__c');
        $('a[data-filter="open"][data-field="Text__c"]').click();
        await flush();
        await frame();
        expect($('c-grid-filter-panel')).not.toBeNull();
        expect(scroller().style.minHeight).toBe(`${390 - 100 + 4}px`);
        $('c-grid-filter-panel').dispatchEvent(new CustomEvent('cancel'));
        await flush();
        expect($('c-grid-filter-panel')).toBeNull();
        expect(scroller().style.minHeight).toBe('');
    });
});
