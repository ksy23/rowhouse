/**
 * The narrow layout: below 480px the grid renders
 * record cards. Same data, same editors, same events; native keyboard and
 * screen-reader behaviour instead of the ARIA grid model.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

let el;
const mount = async config => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = config;
    document.body.appendChild(el);
    await flush();
};
const cards = () => [...el.shadowRoot.querySelectorAll('li.rh-card')];
const editButton = (id, field) =>
    el.shadowRoot.querySelector(`[data-card-edit][data-row-id="${id}"][data-field="${field}"]`);

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    delete global.ResizeObserver;
});

const manyRows = n =>
    Array.from({ length: n }, (_, i) => ({
        Id: 'a00' + String(i).padStart(15, '0'),
        Name: 'Row ' + (i + 1),
        Number_Field__c: String(i)
    }));

describe('choosing the layout', () => {
    it('renders cards, not a grid, when the config asks for them', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'cards' });
        expect(el.shadowRoot.querySelector('[role="grid"]')).toBeNull();
        expect(cards()).toHaveLength(3);
        const first = cards()[0];
        expect(first.querySelector('h3').textContent).toBe(seedRows[0].Name);
        // The title is not repeated as a field; three fields show.
        const labels = [...first.querySelectorAll('dt')].map(n => n.textContent);
        expect(labels).toEqual(columns.slice(1, 4).map(c => c.label));
    });

    it('shows every field on request, the editable title among them', async () => {
        await mount({ columns, rows: seedRows.slice(0, 1), layout: 'cards' });
        const more = cards()[0].querySelector('.rh-card-more');
        // Every column but the three shown, and the title, which is editable.
        expect(more.textContent).toContain(`Show all fields (${columns.length - 4 + 1} more)`);
        expect(more.getAttribute('aria-expanded')).toBe('false');
        more.click();
        await flush();
        const labels = [...cards()[0].querySelectorAll('dt')].map(n => n.textContent);
        expect(labels).toEqual(columns.map(c => c.label));
        const less = cards()[0].querySelector('.rh-card-more');
        expect(less.textContent).toContain('Show fewer fields');
        expect(less.getAttribute('aria-expanded')).toBe('true');
        less.click();
        await flush();
        expect(cards()[0].querySelectorAll('dt')).toHaveLength(3);
    });

    it('links the title to the record when it is the name field', async () => {
        const named = columns.map((c, i) => (i === 0 ? { ...c, isName: true } : c));
        await mount({ columns: named, rows: seedRows.slice(0, 1), layout: 'cards' });
        const link = cards()[0].querySelector('h3 a');
        expect(link.getAttribute('href')).toBe(`/lightning/r/${seedRows[0].Id}/view`);
        expect(link.textContent).toBe(seedRows[0].Name);
    });

    it('leaves the title plain when it is not the name field', async () => {
        await mount({ columns, rows: seedRows.slice(0, 1), layout: 'cards' });
        expect(cards()[0].querySelector('h3 a')).toBeNull();
    });

    it('switches when its own width crosses the breakpoint (ResizeObserver)', async () => {
        const observers = [];
        global.ResizeObserver = class {
            constructor(cb) {
                this.cb = cb;
                observers.push(this);
            }
            observe(target) {
                this.target = target;
            }
            disconnect() {
                this.disconnected = true;
            }
        };
        await mount({ columns, rows: seedRows.slice(0, 3) });
        expect(el.shadowRoot.querySelector('[role="grid"]')).not.toBeNull();
        const ro = observers[0];
        // HR-24: the component observes its own root, never a shared element.
        expect(ro.target.hasAttribute('data-grid-root')).toBe(true);

        ro.cb([{ contentRect: { width: 400 } }]);
        await flush();
        expect(el.shadowRoot.querySelector('[role="grid"]')).toBeNull();
        expect(cards()).toHaveLength(3);

        ro.cb([{ contentRect: { width: 900 } }]);
        await flush();
        expect(el.shadowRoot.querySelector('[role="grid"]')).not.toBeNull();

        document.body.firstChild.remove();
        expect(ro.disconnected).toBe(true);
    });

    it('falls back to window resize where ResizeObserver does not exist (HR-23)', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        const root = el.shadowRoot.querySelector('[data-grid-root]');
        Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 360 });
        window.dispatchEvent(new CustomEvent('resize'));
        await flush();
        expect(cards()).toHaveLength(3);
    });

    it('stays a table when the config pins it, whatever the width', async () => {
        const observers = [];
        global.ResizeObserver = class {
            constructor(cb) {
                this.cb = cb;
                observers.push(this);
            }
            observe() {}
            disconnect() {}
        };
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'table' });
        observers[0].cb([{ contentRect: { width: 320 } }]);
        await flush();
        expect(el.shadowRoot.querySelector('[role="grid"]')).not.toBeNull();
    });
});

describe('editing in a card', () => {
    it('opens the same editor, reports the same event, and returns focus to the edit button', async () => {
        const target = seedRows[1];
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'cards' });
        const handler = jest.fn();
        el.addEventListener('cellchange', handler);

        editButton(target.Id, 'Text_Field__c').click();
        await flush();
        const editor = el.shadowRoot.querySelector('c-cell-text[data-editor]');
        expect(editor.mode).toBe('edit');
        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: 'from a phone' } }));
        await flush();

        expect(handler.mock.calls[0][0].detail).toEqual(
            expect.objectContaining({ recordId: target.Id, field: 'Text_Field__c', value: 'from a phone' })
        );
        expect(el.shadowRoot.querySelector('c-cell-text[data-editor]')).toBeNull();
        expect(el.shadowRoot.activeElement).toBe(editButton(target.Id, 'Text_Field__c'));
    });

    it('offers no edit button for a read-only field', async () => {
        await mount({ columns, rows: seedRows.slice(0, 1), layout: 'cards' });
        expect(editButton(seedRows[0].Id, 'Test_Case__c')).toBeNull();
        // The name is the card's title; it is edited among all the fields.
        expect(editButton(seedRows[0].Id, 'Name')).toBeNull();
        cards()[0].querySelector('.rh-card-more').click();
        await flush();
        expect(editButton(seedRows[0].Id, 'Name')).not.toBeNull();
        expect(editButton(seedRows[0].Id, 'Test_Case__c')).toBeNull();
    });

    it('shows drafts, cell errors (described by the edit button) and row errors', async () => {
        const id = seedRows[0].Id;
        await mount({
            columns,
            rows: seedRows.slice(0, 1),
            layout: 'cards',
            drafts: { [id]: { Text_Field__c: 'draft value' } },
            errors: { [id]: { row: 'Record is locked.', fields: { Text_Field__c: 'Too long.' } } }
        });
        const card = cards()[0];
        expect(card.textContent).toContain('draft value');
        expect(card.textContent).toContain('Unsaved');
        expect(card.querySelector('.rh-card-row-error').textContent).toBe('Error: Record is locked.');
        const button = editButton(id, 'Text_Field__c');
        const describedBy = button.getAttribute('aria-describedby');
        const described = el.shadowRoot.querySelectorAll(`[id="${describedBy}"]`);
        expect(described).toHaveLength(1); // the table's hidden copy is not rendered in cards
        expect(described[0].textContent).toBe('Too long.');
    });

    it('announces an empty value instead of leaving a silent gap', async () => {
        const row = { Id: 'a00000000000000999', Name: 'Sparse', Text_Field__c: null };
        await mount({ columns, rows: [row], layout: 'cards' });
        // The value is its edit button: its name says it is empty, then what it does.
        const button = editButton(row.Id, 'Text_Field__c');
        const said = [...button.querySelectorAll('.slds-assistive-text')].map(n => n.textContent);
        expect(said).toEqual(['No value', 'Edit Text of Sparse']);
    });
});

describe('the save footer in cards', () => {
    it('sticks to the bottom of the screen instead of sitting after the last card', async () => {
        const id = seedRows[0].Id;
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'cards', drafts: { [id]: { Name: 'x' } } });
        const footer = el.shadowRoot.querySelector('.rh-footer');
        expect(footer.classList).toContain('rh-footer_sticky');
        expect(footer.classList).not.toContain('rh-footer_docked');
        // The list scrolls with the page, so the grid keeps no band for the bar.
        expect(el.shadowRoot.querySelector('.rh-grid').classList).not.toContain('rh-has-footer');
    });

    it('floats in a band of its own under the table in the table layout', async () => {
        const id = seedRows[0].Id;
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'table', drafts: { [id]: { Name: 'x' } } });
        expect(el.shadowRoot.querySelector('.rh-footer').classList).toContain('rh-footer_docked');
        expect(el.shadowRoot.querySelector('.rh-grid').classList).toContain('rh-has-footer');
    });
});

describe('paging and sorting cards', () => {
    it('renders fifty at a time and moves focus to the first new card', async () => {
        await mount({ columns: [columns[0], columns[3]], rows: manyRows(120), layout: 'cards' });
        expect(cards()).toHaveLength(50);
        const more = el.shadowRoot.querySelector('.rh-show-more');
        expect(more.textContent).toBe('Show 50 more (70 remaining)');
        more.click();
        await flush();
        expect(cards()).toHaveLength(100);
        expect(el.shadowRoot.activeElement.textContent).toBe('Row 51');
        expect(el.shadowRoot.querySelector('.rh-card-count').textContent).toBe('Showing 100 of 120');
        el.shadowRoot.querySelector('.rh-show-more').click();
        await flush();
        expect(cards()).toHaveLength(120);
        expect(el.shadowRoot.querySelector('.rh-show-more')).toBeNull();
    });

    it('sorts from the menu and the direction button, and reports sortchange', async () => {
        const rows = manyRows(5);
        await mount({ columns: [columns[0], columns[3]], rows, layout: 'cards' });
        const handler = jest.fn();
        el.addEventListener('sortchange', handler);
        const select = el.shadowRoot.querySelector('select');
        select.value = 'Number_Field__c';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(handler.mock.calls[0][0].detail.sort).toEqual([{ field: 'Number_Field__c', direction: 'asc' }]);
        el.shadowRoot.querySelector('.rh-card-direction').click();
        await flush();
        expect(handler.mock.calls[1][0].detail.sort).toEqual([{ field: 'Number_Field__c', direction: 'desc' }]);
        expect([...el.shadowRoot.querySelectorAll('li.rh-card h3')].map(h => h.textContent)).toEqual([
            'Row 5',
            'Row 4',
            'Row 3',
            'Row 2',
            'Row 1'
        ]);
    });

    it('leaves arrow keys to the browser: the grid keyboard model is for the table only', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'cards' });
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            composed: true,
            cancelable: true
        });
        el.shadowRoot.querySelector('[data-grid-root]').dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });
});

describe('selection and accessibility in cards', () => {
    it('selects a record from its card', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3), layout: 'cards', selection: 'multi' });
        const handler = jest.fn();
        el.addEventListener('selectionchange', handler);
        cards()[1].querySelector('input[type="checkbox"]').click();
        await flush();
        expect(handler.mock.calls[0][0].detail.selectedIds).toEqual([seedRows[1].Id]);
    });

    it('has no axe violations', async () => {
        await mount({ columns, rows: seedRows.slice(0, 5), layout: 'cards', selection: 'multi' });
        await frame();
        await expect(el).toBeAccessible();
    });
});
