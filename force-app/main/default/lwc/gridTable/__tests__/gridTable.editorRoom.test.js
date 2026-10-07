/**
 * Room for an open editor. The edit popover sits inside the grid's
 * scroller, which clips it: a short grid grows while an editor is open, and
 * what hangs below an editor's box (a lookup's matches, the date calendar, a
 * multi-select's lists) opens leftwards when there is no room to its right. JSDOM has no layout,
 * so the scroller's and the cell's boxes are given to each test.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn(() => Promise.resolve([])) }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true },
    { field: 'Lookup_Field__c', label: 'Account', type: 'reference', editable: true, referenceTo: ['Account'] }
];
const ROWS = [{ Id: 'a01000000000001AAA', Name: 'One', Lookup_Field__c: null }];

describe('room for an open editor', () => {
    let el;
    const scroller = () => el.shadowRoot.querySelector('[data-scroller]');
    const cell = field => el.shadowRoot.querySelector(`td[data-field="${field}"]`);
    const popover = () => el.shadowRoot.querySelector('section.rh-edit-popover');
    const box = (node, rect, clientHeight) => {
        node.getBoundingClientRect = () => rect;
        if (clientHeight !== undefined) Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true });
    };
    const mount = async config => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows: ROWS, configName: 'Test_Records', ...config };
        document.body.appendChild(el);
        await flush();
    };
    const edit = async field => {
        cell(field).querySelector('button').click();
        await flush();
    };

    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('grows a one-row grid to hold the editor, then gives the room back', async () => {
        await mount({ height: 600 });
        // The box is one row tall: 70px, with the row ending 66px below its top.
        box(scroller(), { top: 100, bottom: 170, left: 0, right: 1200 }, 70);
        box(cell('Name'), { top: 133, bottom: 166, left: 0, right: 150 });
        await edit('Name');
        expect(scroller().style.minHeight).toBe(`${66 + 320}px`);
        expect(scroller().style.maxHeight).toBe('600px');
        popover().querySelector('[data-editor]').dispatchEvent(new CustomEvent('cancel'));
        await flush();
        expect(scroller().style.minHeight).toBe('');
    });

    it('never grows past the grid’s own height', async () => {
        await mount({ height: 200 });
        box(scroller(), { top: 100, bottom: 170, left: 0, right: 1200 }, 70);
        box(cell('Name'), { top: 133, bottom: 166, left: 0, right: 150 });
        await edit('Name');
        expect(scroller().style.minHeight).toBe('200px');
    });

    it('leaves a grid alone when the editor already fits', async () => {
        await mount({ height: 600 });
        box(scroller(), { top: 100, bottom: 700, left: 0, right: 1200 }, 600);
        box(cell('Name'), { top: 133, bottom: 166, left: 0, right: 150 });
        await edit('Name');
        expect(scroller().style.minHeight).toBe('');
    });

    it('hangs a lookup’s matches leftwards when there is no room to their right', async () => {
        await mount({ height: 600 });
        box(scroller(), { top: 100, bottom: 700, left: 0, right: 1000 }, 600);
        box(cell('Lookup_Field__c'), { top: 133, bottom: 166, left: 850, right: 1000 });
        await edit('Lookup_Field__c');
        expect(popover().querySelector('[data-editor]').dropdownAlign).toBe('right');
    });

    it('hangs them rightwards when there is room, and a text editor has nothing to hang', async () => {
        await mount({ height: 600 });
        box(scroller(), { top: 100, bottom: 700, left: 0, right: 1000 }, 600);
        box(cell('Lookup_Field__c'), { top: 133, bottom: 166, left: 150, right: 300 });
        await edit('Lookup_Field__c');
        expect(popover().querySelector('[data-editor]').dropdownAlign).toBe('left');
        popover().querySelector('[data-editor]').dispatchEvent(new CustomEvent('cancel'));
        await flush();
        box(cell('Name'), { top: 133, bottom: 166, left: 850, right: 1000 });
        await edit('Name');
        expect(popover().querySelector('c-cell-text')).not.toBeNull();
        expect(el.shadowRoot.querySelector('[data-editor]').dropdownAlign).toBeUndefined();
    });

    it('the box is the cell’s width for every editor: no wide or right-hand popover any more', async () => {
        await mount({ height: 600 });
        box(scroller(), { top: 100, bottom: 700, left: 0, right: 1000 }, 600);
        box(cell('Lookup_Field__c'), { top: 133, bottom: 166, left: 850, right: 1000 });
        await edit('Lookup_Field__c');
        expect([...popover().classList]).toEqual(['slds-popover', 'slds-popover_edit', 'rh-edit-popover']);
    });

    it('makes more room below a date, whose calendar is taller than a list of matches', async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = {
            columns: [...COLUMNS, { field: 'Date__c', label: 'Date', type: 'date', editable: true }],
            rows: [{ ...ROWS[0], Date__c: '2026-09-30' }],
            configName: 'Test_Records',
            height: 800
        };
        document.body.appendChild(el);
        await flush();
        box(scroller(), { top: 100, bottom: 170, left: 0, right: 1200 }, 70);
        box(cell('Date__c'), { top: 133, bottom: 166, left: 900, right: 1050 });
        await edit('Date__c');
        expect(scroller().style.minHeight).toBe(`${66 + 400}px`);
        // 900 + 320 runs past 1200, and there is room to the left: the calendar opens leftwards.
        expect(popover().querySelector('c-cell-date').dropdownAlign).toBe('right');
    });

    const mountWithDate = async height => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = {
            columns: [...COLUMNS, { field: 'Date__c', label: 'Date', type: 'date', editable: true }],
            rows: [{ ...ROWS[0], Date__c: '2026-09-30' }],
            configName: 'Test_Records',
            height
        };
        document.body.appendChild(el);
        await flush();
    };

    it('opens a date’s calendar upwards near the bottom of a grid that cannot grow any taller', async () => {
        // Found following the pipeline tutorial: only the calendar's first week showed.
        await mountWithDate(600);
        box(scroller(), { top: 100, bottom: 700, left: 0, right: 1200 }, 600);
        box(cell('Date__c'), { top: 640, bottom: 673, left: 300, right: 450 });
        await edit('Date__c');
        expect(popover().querySelector('c-cell-date').dropdownUp).toBe(true);
        expect(scroller().style.minHeight).toBe(''); // nothing to grow: the calendar hangs above
        popover().querySelector('[data-editor]').dispatchEvent(new CustomEvent('cancel'));
        await flush();
        box(cell('Date__c'), { top: 133, bottom: 166, left: 300, right: 450 });
        await edit('Date__c');
        expect(popover().querySelector('c-cell-date').dropdownUp).toBe(false);
    });

    it('keeps it below, growing the grid as far as it may, when there is no room above either', async () => {
        await mountWithDate(300);
        box(scroller(), { top: 100, bottom: 170, left: 0, right: 1200 }, 70);
        box(cell('Date__c'), { top: 133, bottom: 166, left: 300, right: 450 });
        await edit('Date__c');
        expect(popover().querySelector('c-cell-date').dropdownUp).toBe(false);
        expect(scroller().style.minHeight).toBe('300px');
    });

    it('a text editor never opens upwards: it has nothing hanging from it', async () => {
        await mount({ height: 600 });
        box(scroller(), { top: 100, bottom: 700, left: 0, right: 1200 }, 600);
        box(cell('Name'), { top: 640, bottom: 673, left: 0, right: 150 });
        await edit('Name');
        expect(popover().querySelector('c-cell-text').dropdownUp).toBeUndefined();
    });

    it('scrolls the open editor into view', async () => {
        const scroll = jest.fn();
        Element.prototype.scrollIntoView = scroll;
        try {
            await mount({ height: 600 });
            await edit('Name');
            expect(scroll.mock.contexts.some(node => node === popover())).toBe(true);
            expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
        } finally {
            delete Element.prototype.scrollIntoView;
        }
    });
});
