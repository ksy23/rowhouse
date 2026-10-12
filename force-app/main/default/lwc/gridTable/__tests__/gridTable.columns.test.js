/**
 * Each user's own columns, in the table: it draws config.columns in
 * the order config.columnChoice gives, without the hidden ones, and tells the
 * parent of a change it made (Hide column, a header dragged) with a
 * columnschange event. The parent keeps the choice and hands it back.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, alwaysShown: true },
    { field: 'Delivery_Notes__c', label: 'Delivery Notes', type: 'text', editable: true, sortable: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', scale: 2, editable: true, sortable: true },
    { field: 'Service_Level__c', label: 'Service Level', type: 'picklist', editable: true, sortable: false }
];
const id = n => 'a01' + String(n).padStart(15, '0');
const ROWS = [
    {
        Id: id(1),
        Name: 'Casco Bay Marine, 4 pallets',
        Delivery_Notes__c: 'Call before delivery',
        Freight_Charge__c: 100,
        Service_Level__c: 'Standard'
    },
    {
        Id: id(2),
        Name: 'Wachusett Paper, 6 rolls',
        Delivery_Notes__c: 'Use dock door 4',
        Freight_Charge__c: 300,
        Service_Level__c: 'Express'
    }
];

let el;
let changes;
const mount = async (extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, keyField: 'Id', ...extra };
    changes = [];
    el.addEventListener('columnschange', e => changes.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
const setConfig = async extra => {
    el.config = { ...el.config, ...extra };
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const headers = () => $$('thead th[data-field]').map(th => th.dataset.field);
const th = field => $(`thead th[data-field="${field}"]`);
const menuButton = field => $(`[data-menu-button][data-field="${field}"]`);
const menuLabels = () => $$('[role="menu"] a').map(a => a.textContent.trim());
const hideItem = () => $('[role="menu"] a[data-hide]');
const openMenu = async field => {
    menuButton(field).click();
    await flush();
};

/** A DragEvent jsdom can carry: an event with the fields the table reads. */
const drag = (target, type, { clientX = 0 } = {}) => {
    const event = new CustomEvent(type, { bubbles: true, cancelable: true, composed: true });
    event.dataTransfer = { setData: jest.fn(), effectAllowed: '', dropEffect: '' };
    event.clientX = clientX;
    target.dispatchEvent(event);
    return event;
};
const handle = field => th(field).querySelector('[draggable]');

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe("drawing the user's columns", () => {
    it("draws the admin's columns without a choice", async () => {
        await mount();
        expect(headers()).toEqual(['Name', 'Delivery_Notes__c', 'Freight_Charge__c', 'Service_Level__c']);
    });

    it("draws them in the user's order, without the hidden ones, and counts only those for ARIA", async () => {
        await mount({
            columnChoice: {
                order: ['Freight_Charge__c', 'Name', 'Delivery_Notes__c', 'Service_Level__c'],
                hidden: ['Delivery_Notes__c']
            }
        });
        expect(headers()).toEqual(['Freight_Charge__c', 'Name', 'Service_Level__c']);
        expect($('[role="grid"]').getAttribute('aria-colcount')).toBe('3');
        const cells = $$(`td[data-row-id="${id(1)}"]`).map(td => td.dataset.field);
        expect(cells).toEqual(['Freight_Charge__c', 'Name', 'Service_Level__c']);
    });

    it("freezes the first columns in the user's order", async () => {
        await mount({
            frozenColumns: 1,
            columnChoice: { order: ['Freight_Charge__c', 'Name', 'Delivery_Notes__c', 'Service_Level__c'], hidden: [] }
        });
        await frame(); // frozen columns pin the widths
        expect($$('thead th.rh-frozen').map(h => h.dataset.field)).toEqual(['Freight_Charge__c']);
    });

    it('measures the widths again when a column is hidden, if they were pinned only to freeze columns', async () => {
        await mount({ frozenColumns: 1 });
        await frame();
        expect($('table').style.width).not.toBe('');
        await setConfig({
            columnChoice: {
                order: ['Name', 'Delivery_Notes__c', 'Freight_Charge__c', 'Service_Level__c'],
                hidden: ['Delivery_Notes__c']
            }
        });
        expect($('table').style.width).toBe(''); // fills the grid again, pinned anew next frame
        await frame();
        expect($('table').style.width).not.toBe('');
    });

    it("lays cards out in the user's order", async () => {
        await mount({
            layout: 'cards',
            columnChoice: {
                order: ['Delivery_Notes__c', 'Name', 'Service_Level__c', 'Freight_Charge__c'],
                hidden: ['Freight_Charge__c']
            }
        });
        const card = $('.rh-card, [data-card]') || $$('article')[0];
        expect(card.querySelector('h3').textContent).toBe('Call before delivery');
        expect([...card.querySelectorAll('dt')].map(n => n.textContent)).toEqual(['Name', 'Service Level']);
    });
});

describe('Hide column, in the column menu', () => {
    it("is the last item of a column's menu", async () => {
        await mount();
        await openMenu('Delivery_Notes__c');
        expect(menuLabels()[menuLabels().length - 1]).toBe('Hide column');
        expect(hideItem().closest('li').classList).toContain('slds-has-divider_top-space');
    });

    it('is not offered for a column the admin keeps on screen', async () => {
        await mount();
        await openMenu('Name');
        expect(hideItem()).toBeNull();
    });

    it('is not offered for the last column showing', async () => {
        const two = [COLUMNS[1], COLUMNS[2]];
        await mount({
            columns: two,
            columnChoice: { order: ['Delivery_Notes__c', 'Freight_Charge__c'], hidden: ['Freight_Charge__c'] }
        });
        await openMenu('Delivery_Notes__c');
        expect(hideItem()).toBeNull();
    });

    it("tells the parent, says so, and puts focus on the next column's header", async () => {
        await mount();
        await openMenu('Delivery_Notes__c');
        hideItem().click();
        await flush();
        expect(changes).toEqual([
            {
                choice: {
                    order: ['Name', 'Delivery_Notes__c', 'Freight_Charge__c', 'Service_Level__c'],
                    hidden: ['Delivery_Notes__c']
                }
            }
        ]);
        expect(el.shadowRoot.textContent).toContain('Delivery Notes hidden. Choose columns shows it again.');
        await setConfig({ columnChoice: changes[0].choice });
        expect(headers()).toEqual(['Name', 'Freight_Charge__c', 'Service_Level__c']);
        // The column that took its place has the focus (its header, in action mode from the menu).
        expect(th('Freight_Charge__c').classList).toContain('slds-has-focus');
    });
});

describe('dragging a header', () => {
    it('marks where the column would land, and moves it there on drop', async () => {
        await mount();
        const start = drag(handle('Service_Level__c'), 'dragstart');
        expect(start.defaultPrevented).toBe(false);
        expect(start.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'Service Level');
        await flush();
        expect(th('Service_Level__c').classList).toContain('rh-dragging');
        // jsdom lays nothing out: every box is 0 wide at 0, so any x past 0 is the right half.
        const over = drag(th('Delivery_Notes__c'), 'dragover', { clientX: -1 });
        expect(over.defaultPrevented).toBe(true); // a drop is allowed here
        await flush();
        expect(th('Delivery_Notes__c').classList).toContain('rh-drop_before');
        drag(th('Delivery_Notes__c'), 'drop');
        await flush();
        expect(changes).toEqual([
            { choice: { order: ['Name', 'Service_Level__c', 'Delivery_Notes__c', 'Freight_Charge__c'], hidden: [] } }
        ]);
        expect(el.shadowRoot.textContent).toContain('Service Level moved before Delivery Notes.');
        expect(th('Delivery_Notes__c').classList).not.toContain('rh-drop_before');
        expect(th('Service_Level__c').classList).not.toContain('rh-dragging');
    });

    it('lands after a column when dropped on its right half', async () => {
        await mount();
        drag(handle('Name'), 'dragstart');
        drag(th('Freight_Charge__c'), 'dragover', { clientX: 1 });
        await flush();
        expect(th('Freight_Charge__c').classList).toContain('rh-drop_after');
        drag(th('Freight_Charge__c'), 'drop');
        expect(changes[0].choice.order).toEqual(['Delivery_Notes__c', 'Freight_Charge__c', 'Name', 'Service_Level__c']);
    });

    it('changes nothing dropped on itself, or when the drag ends elsewhere', async () => {
        await mount();
        drag(handle('Delivery_Notes__c'), 'dragstart');
        drag(th('Delivery_Notes__c'), 'dragover', { clientX: 1 });
        drag(th('Delivery_Notes__c'), 'drop');
        drag(handle('Freight_Charge__c'), 'dragstart');
        drag(handle('Freight_Charge__c'), 'dragend');
        await flush();
        expect(changes).toEqual([]);
        expect($$('.rh-dragging, .rh-drop_before, .rh-drop_after')).toHaveLength(0);
    });

    it('does not start while a cell is being edited', async () => {
        await mount();
        const cell = $(`td[data-row-id="${id(1)}"][data-field="Delivery_Notes__c"]`);
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        await flush();
        expect(drag(handle('Service_Level__c'), 'dragstart').defaultPrevented).toBe(true);
    });
});

describe('when the parent hides the focused column', () => {
    it('moves focus to the first column showing', async () => {
        await mount();
        const key = (target, k) =>
            target.dispatchEvent(
                new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true })
            );
        $(`td[data-row-id="${id(1)}"][data-field="Name"]`).focus();
        await flush();
        key(el.shadowRoot.activeElement, 'ArrowDown');
        key(el.shadowRoot.activeElement, 'ArrowRight');
        key(el.shadowRoot.activeElement, 'ArrowRight');
        await flush();
        expect(el.shadowRoot.activeElement).toBe($(`td[data-row-id="${id(2)}"][data-field="Freight_Charge__c"]`));
        await setConfig({
            columnChoice: {
                order: ['Name', 'Delivery_Notes__c', 'Freight_Charge__c', 'Service_Level__c'],
                hidden: ['Freight_Charge__c']
            }
        });
        expect($(`td[data-row-id="${id(2)}"][data-field="Name"]`).getAttribute('tabindex')).toBe('0');
    });
});
