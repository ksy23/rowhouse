/**
 * Text wrap: a text column clips to one line or
 * wraps to at most three. The admin sets the default per column; the column
 * header menu switches it for the session. Cards always wrap.
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
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const cellText = (id, field) => $(`td[data-row-id="${id}"][data-field="${field}"] .slds-grid > span, td[data-row-id="${id}"][data-field="${field}"] .slds-grid > a`);
const menuButton = field => $(`[data-menu-button][data-field="${field}"]`);
const items = () => $$('[role="menuitemradio"]');
const key = (target, k) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
};
const withWrap = (field, wrap = true) => columns.map(c => (c.field === field ? { ...c, wrap } : c));
const id = seedRows[0].Id;

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('clip and wrap in the table', () => {
    it('clips to one line by default', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        const text = cellText(id, 'Test_Case__c');
        expect(text.classList).toContain('slds-truncate');
        expect(text.classList).not.toContain('slds-line-clamp');
        expect($('table').classList).not.toContain('rh-table_wrap');
    });

    it('wraps to three lines when the admin default says so, and only that column', async () => {
        await mount({ columns: withWrap('Test_Case__c'), rows: seedRows.slice(0, 3) });
        const text = cellText(id, 'Test_Case__c');
        expect(text.classList).toContain('slds-line-clamp'); // SLDS: three lines, pre-line
        expect(text.classList).toContain('rh-wrap-text'); // every wrapped cell three lines tall
        expect(text.getAttribute('title')).toBe(seedRows[0].Test_Case__c);
        expect(text.textContent).toBe(seedRows[0].Test_Case__c); // clamping is visual only
        expect($(`td[data-row-id="${id}"][data-field="Test_Case__c"]`).classList).toContain('slds-cell-wrap');
        expect(cellText(id, 'Name').classList).toContain('slds-truncate');
        expect($('table').classList).toContain('rh-table_wrap');
    });

    it('never wraps a number, date or checkbox, whatever the config says', async () => {
        await mount({ columns: withWrap('Number_Field__c'), rows: seedRows.slice(0, 3) });
        expect($('td[data-field="Number_Field__c"] .slds-line-clamp')).toBeNull();
        // Their menus sort; they offer no wrapping.
        const labels = async field => {
            menuButton(field).click();
            await flush();
            const out = items().map(i => i.textContent.trim());
            menuButton(field).click();
            await flush();
            return out;
        };
        for (const field of ['Number_Field__c', 'Date_Field__c', 'Checkbox_Field__c']) {
            // eslint-disable-next-line no-await-in-loop -- one menu open at a time
            expect(await labels(field)).toEqual(['Sort ascending', 'Sort descending']);
        }
        expect(await labels('Text_Field__c')).toContain('Wrap text');
        expect(await labels('Picklist_Field__c')).toContain('Wrap text');
    });
});

describe('the column header menu', () => {
    it('follows the SLDS header-menu markup and keeps a single tab stop', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        const th = $('th[data-field="Text_Field__c"]');
        expect(th.classList).toContain('slds-has-button-menu');
        const button = menuButton('Text_Field__c');
        expect(button.classList).toContain('slds-th__action-button');
        expect(button.getAttribute('aria-haspopup')).toBe('true');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.textContent).toBe('Show Text column actions');
        expect(button.getAttribute('tabindex')).toBe('-1'); // a control: actionable mode only
        expect($$('[tabindex="0"]')).toHaveLength(1);
    });

    it('opens on click, shows the current choice, and focuses the first item', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        menuButton('Test_Case__c').click();
        await flush();
        expect(menuButton('Test_Case__c').getAttribute('aria-expanded')).toBe('true');
        const menu = $('[role="menu"]');
        expect(menu.getAttribute('aria-label')).toBe('Test Case column actions');
        // Sorting first, as in a list view's column menu, then the text choice.
        expect(items().map(i => i.textContent.trim())).toEqual(['Sort ascending', 'Sort descending', 'Wrap text', 'Clip text']);
        expect(items().map(i => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true']);
        expect(items()[3].closest('li').classList).toContain('slds-is-selected');
        expect(items()[2].closest('li').classList).toContain('slds-has-divider_top-space');
        expect(el.shadowRoot.activeElement).toBe(items()[0]);
    });

    it('choosing Wrap text wraps the column, closes the menu, returns focus and announces it', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        menuButton('Test_Case__c').click();
        await flush();
        items()[2].click();
        await flush();
        expect($('[role="menu"]')).toBeNull();
        expect(cellText(id, 'Test_Case__c').classList).toContain('slds-line-clamp');
        expect(el.shadowRoot.activeElement).toBe(menuButton('Test_Case__c'));
        expect($('[data-grid-root] > [aria-live="polite"]').textContent).toBe('Test Case: text wrapped');
    });

    it('works from the keyboard: arrows move, Enter chooses, Up Arrow opens on the last item', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        key(menuButton('Text_Field__c'), 'ArrowDown');
        await flush();
        expect(el.shadowRoot.activeElement).toBe(items()[0]);
        key(items()[0], 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(items()[1]);
        key(items()[1], 'End');
        expect(el.shadowRoot.activeElement).toBe($('[data-hide]')); // the last item: Hide column
        key($('[data-hide]'), 'ArrowDown'); // wraps within the menu, as the APG allows
        expect(el.shadowRoot.activeElement).toBe(items()[0]);
        key(items()[0], 'End');
        key($('[data-hide]'), 'Home');
        expect(el.shadowRoot.activeElement).toBe(items()[0]);
        key(items()[0], 'ArrowDown');
        key(items()[1], 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(items()[2]); // Wrap text
        key(items()[2], 'Enter');
        await flush();
        expect(cellText(id, 'Text_Field__c').classList).toContain('slds-line-clamp');

        key(menuButton('Text_Field__c'), 'ArrowUp');
        await flush();
        expect(el.shadowRoot.activeElement).toBe($('[data-hide]')); // Hide column, the last
        key($('[data-hide]'), 'ArrowUp');
        expect(el.shadowRoot.activeElement).toBe(items()[3]); // Clip text
        key(items()[3], ' ');
        await flush();
        expect(cellText(id, 'Text_Field__c').classList).toContain('slds-truncate');
    });

    it('Escape closes without changing anything, and does not leave actionable mode', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        menuButton('Text_Field__c').focus(); // a control has focus: actionable mode
        menuButton('Text_Field__c').click();
        await flush();
        const event = key(items()[0], 'Escape');
        await flush();
        expect(event.defaultPrevented).toBe(true);
        expect($('[role="menu"]')).toBeNull();
        expect(el.shadowRoot.activeElement).toBe(menuButton('Text_Field__c'));
        expect(menuButton('Text_Field__c').getAttribute('tabindex')).toBe('0'); // still actionable
        expect(cellText(id, 'Text_Field__c').classList).toContain('slds-truncate');
    });

    it('closes when focus moves elsewhere', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        menuButton('Text_Field__c').click();
        await flush();
        items()[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: $('th[data-field="Name"]') }));
        await flush();
        expect($('[role="menu"]')).toBeNull();
    });

    it('overrides the admin default for the session, and keeps the choice when the data changes', async () => {
        const cols = withWrap('Test_Case__c');
        await mount({ columns: cols, rows: seedRows.slice(0, 3) });
        menuButton('Test_Case__c').click();
        await flush();
        items()[3].click(); // Clip text
        await flush();
        expect(cellText(id, 'Test_Case__c').classList).toContain('slds-truncate');
        el.config = { columns: cols, rows: seedRows.slice(0, 4) }; // a new object from the parent
        await flush();
        expect(cellText(id, 'Test_Case__c').classList).toContain('slds-truncate');
    });

    it('has no axe violations with the menu open', async () => {
        await mount({ columns, rows: seedRows.slice(0, 3) });
        menuButton('Text_Field__c').click();
        await flush();
        await frame();
        await expect(el).toBeAccessible();
    });
});

describe('cards', () => {
    it('always wrap, keeping line breaks, whatever the column setting', async () => {
        const row = { Id: 'a00000000000000999', Name: 'Multi-line', Text_Field__c: 'first line\nsecond line' };
        await mount({ columns, rows: [row], layout: 'cards' });
        const dd = [...$$('li.rh-card dd')][1]; // the name is the card's title
        const text = dd.querySelector('.rh-card-text');
        expect(text.textContent).toBe('first line\nsecond line');
        expect(dd.querySelector('.slds-truncate')).toBeNull();
        expect($('[data-menu-button]')).toBeNull();
    });
});
