/**
 * Richer display rules in the table and in cards: an icon before a
 * value, a data bar behind a number, and formula rules, which the server tests
 * for the saved record and names in each row's `_rules`. What each rule
 * matches is tested in c/gridFormatRules; here, what the table draws.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, editable: true },
    { field: 'Score__c', label: 'Score', type: 'number', editable: true },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true,
        options: [{ value: 'Open', label: 'Open' }, { value: 'Won', label: 'Won' }] }
];
const id = n => 'a01' + String(n).padStart(15, '0');
const ROWS = [
    { Id: id(1), Name: 'One', Amount__c: -20, Score__c: 10, Stage__c: 'Open', _rules: ['At_Risk'] },
    { Id: id(2), Name: 'Two', Amount__c: 1500, Score__c: 50, Stage__c: 'Won', _rules: [] },
    { Id: id(3), Name: 'Three', Amount__c: 300, Score__c: 100, Stage__c: 'Open', _rules: ['Hot', 'Flagged'] },
    { Id: id(4), Name: 'Four', Amount__c: null, Score__c: null, Stage__c: null }
];
const rule = (name, extra) => ({ name, label: name.replace(/_/g, ' '), applyTo: 'cell', ...extra });
const OVERDUE = rule('Overdue', { field: 'Amount__c', type: 'currency', operator: 'less_than', value: '0', style: 'icon_warning' });
const BIG = rule('Big_deal', { field: 'Amount__c', type: 'currency', operator: 'greater_or_equal', value: '1000', style: 'icon_up' });
const SCORE_BAR = rule('Score_bar', { field: 'Score__c', type: 'number', operator: 'is_not_blank', style: 'data_bar' });

let el;
const mount = async (formatRules, extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, formatRules, ...extra };
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const cell = (n, field) => $(`td[data-row-id="${id(n)}"][data-field="${field}"]`);
const icon = (n, field) => cell(n, field).querySelector('lightning-icon.rh-format-icon');
const said = (n, field) => [...cell(n, field).querySelectorAll('.slds-assistive-text')].map(s => s.textContent).filter(t => t.startsWith(', '));
const bar = (n, field) => cell(n, field).style.getPropertyValue('--rh-databar');
const tr = n => $(`tr[data-row-id="${id(n)}"]`);

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('icons', () => {
    it.each([
        ['icon_warning', 'utility:warning', 'warning'],
        ['icon_error', 'utility:error', 'error'],
        ['icon_success', 'utility:success', 'success'],
        ['icon_info', 'utility:info', null],
        ['icon_up', 'utility:arrowup', null],
        ['icon_down', 'utility:arrowdown', null]
    ])('%s shows %s before the value, titled with the rule\'s label', async (style, name, variant) => {
        await mount([rule('Check_me', { field: 'Stage__c', type: 'picklist', operator: 'equals', value: 'Won', style })]);
        const shown = icon(2, 'Stage__c');
        expect(shown).not.toBeNull();
        expect(shown.iconName).toBe(name);
        expect(shown.variant || null).toBe(variant); // info and the arrows take the icon's own color
        expect(shown.title).toBe('Check me');
        expect(shown.size).toBe('xx-small');
        // Before the value, inside it, so it stays beside a right-aligned number.
        const value = cell(2, 'Stage__c').querySelector('.rh-cell-content').firstElementChild;
        expect(value.firstElementChild).toBe(shown);
        expect(value.textContent.trim()).toBe('Won');
        // Only where the rule matches.
        expect(icon(1, 'Stage__c')).toBeNull();
        expect($$('lightning-icon.rh-format-icon')).toHaveLength(1);
    });

    it('takes the first matching icon rule for a cell', async () => {
        const alsoNegative = rule('Negative', { field: 'Amount__c', type: 'currency', operator: 'less_than', value: '100', style: 'icon_down' });
        await mount([OVERDUE, alsoNegative, BIG]);
        expect(icon(1, 'Amount__c').iconName).toBe('utility:warning'); // both match; the first wins
        expect(icon(2, 'Amount__c').iconName).toBe('utility:arrowup');
        expect(icon(3, 'Amount__c')).toBeNull();
        expect(icon(4, 'Amount__c')).toBeNull(); // a blank meets neither
    });

    it('says what the icon means to a screen reader, and in the value\'s tooltip', async () => {
        await mount([OVERDUE]);
        // The icon itself is hidden from screen readers; its meaning is said with the value.
        expect(icon(1, 'Amount__c').getAttribute('aria-hidden')).toBe('true');
        expect(said(1, 'Amount__c')).toEqual([', Overdue']);
        expect(cell(1, 'Amount__c').querySelector('span[title]').getAttribute('title')).toBe('-$20.00 · Overdue');
        expect(said(2, 'Amount__c')).toEqual([]);
    });

    it('says an icon\'s meaning once, beside a fill\'s from another rule', async () => {
        const red = rule('Loss', { field: 'Amount__c', type: 'currency', operator: 'less_than', value: '0', style: 'fill_red' });
        await mount([red, OVERDUE]);
        expect(cell(1, 'Amount__c').classList).toContain('rh-fmt_fill-red');
        expect(icon(1, 'Amount__c').iconName).toBe('utility:warning');
        expect(said(1, 'Amount__c')).toEqual([', Loss, Overdue']);
    });

    it('puts a row rule\'s icon on the row\'s first value, after the utility columns', async () => {
        const flag = rule('Won_row', { field: 'Stage__c', type: 'picklist', operator: 'equals', value: 'Won', style: 'icon_success', applyTo: 'row' });
        await mount([flag], { selection: 'multi' });
        expect(icon(2, 'Name').iconName).toBe('utility:success');
        expect(icon(2, 'Stage__c')).toBeNull();
        expect(cell(2, '__select').querySelector('.rh-format-icon')).toBeNull();
        expect(said(2, 'Name')).toEqual([', Won row']);
    });

    it('shows no icon on a cell with an unsaved edit or an error', async () => {
        await mount([OVERDUE], {
            drafts: { [id(1)]: { Amount__c: '-50' } },
            errors: { [id(2)]: { row: null, fields: { Amount__c: 'Too large.' } } }
        });
        expect(cell(1, 'Amount__c').classList).toContain('slds-is-edited');
        expect(icon(1, 'Amount__c')).toBeNull();
        // An unsaved edit that meets the rule elsewhere shows it at once.
        el.config = { ...el.config, drafts: { [id(3)]: { Score__c: 5 } }, rows: ROWS.map(r => (r.Id === id(3) ? { ...r, Amount__c: -1 } : r)) };
        await flush();
        expect(icon(3, 'Amount__c').iconName).toBe('utility:warning');
    });

    it('follows an unsaved edit in the cell\'s row: a row rule tested on another cell', async () => {
        const flag = rule('Won_row', { field: 'Stage__c', type: 'picklist', operator: 'equals', value: 'Won', style: 'icon_success', applyTo: 'row' });
        await mount([flag], { drafts: { [id(1)]: { Stage__c: 'Won' } } });
        expect(icon(1, 'Name').iconName).toBe('utility:success');
    });

    it('shows the icon in a card, named for a screen reader', async () => {
        await mount([OVERDUE], { layout: 'cards' });
        const card = $(`li[data-row-id="${id(1)}"]`);
        const shown = card.querySelector('lightning-icon.rh-format-icon');
        expect(shown.iconName).toBe('utility:warning');
        expect(shown.alternativeText).toBe('Overdue');
        expect(shown.title).toBe('Overdue');
        expect(shown.getAttribute('aria-hidden')).toBeNull();
        expect($$('lightning-icon.rh-format-icon')).toHaveLength(1);
    });
});

describe('data bars', () => {
    it('draws a bar behind each value, its length the value\'s place from zero to the highest loaded value', async () => {
        await mount([SCORE_BAR]);
        expect(cell(1, 'Score__c').classList).toContain('rh-fmt_databar');
        expect(bar(1, 'Score__c')).toBe('10%');
        expect(bar(2, 'Score__c')).toBe('50%');
        expect(bar(3, 'Score__c')).toBe('100%');
        // A blank has no bar.
        expect(cell(4, 'Score__c').classList).not.toContain('rh-fmt_databar');
        expect(bar(4, 'Score__c')).toBe('');
        // Only in the rule's column.
        expect(cell(1, 'Amount__c').classList).not.toContain('rh-fmt_databar');
    });

    it('measures from the lowest value when some are below zero', async () => {
        const amountBar = rule('Amount_bar', { field: 'Amount__c', type: 'currency', operator: 'is_not_blank', style: 'data_bar' });
        await mount([amountBar]);
        // -20 to 1,500: a range of 1,520.
        expect(bar(1, 'Amount__c')).toBe('0%');
        expect(bar(2, 'Amount__c')).toBe('100%');
        expect(bar(3, 'Amount__c')).toBe(Math.round((320 / 1520) * 100) + '%');
    });

    it('scales to every loaded value, not only those the rule matches', async () => {
        const high = rule('High_score', { field: 'Score__c', type: 'number', operator: 'greater_than', value: '20', style: 'data_bar' });
        await mount([high]);
        expect(cell(1, 'Score__c').classList).not.toContain('rh-fmt_databar'); // 10 does not match
        expect(bar(2, 'Score__c')).toBe('50%');
        expect(bar(3, 'Score__c')).toBe('100%');
    });

    it('draws no bar when every loaded value is zero or blank: there is nothing to measure', async () => {
        const rows = ROWS.map(r => ({ ...r, Score__c: r.Score__c === null ? null : 0 }));
        await mount([SCORE_BAR], { rows });
        expect($$('td.rh-fmt_databar')).toHaveLength(0);
    });

    it('draws full bars when every loaded value is the same: each is all the way from zero', async () => {
        const rows = ROWS.map(r => ({ ...r, Score__c: 7 }));
        await mount([SCORE_BAR], { rows });
        expect([1, 2, 3, 4].map(n => bar(n, 'Score__c'))).toEqual(['100%', '100%', '100%', '100%']);
    });

    it('rescales with an unsaved edit, and the edited cell shows as unsaved, without a bar', async () => {
        await mount([SCORE_BAR], { drafts: { [id(4)]: { Score__c: 200 } } });
        expect(cell(4, 'Score__c').classList).toContain('slds-is-edited');
        expect(cell(4, 'Score__c').classList).not.toContain('rh-fmt_databar');
        expect(bar(2, 'Score__c')).toBe('25%'); // 50 of 200
        expect(bar(3, 'Score__c')).toBe('50%');
    });

    it('sits with a fill and an icon in one cell: each kind of rule is separate', async () => {
        const green = rule('Good', { field: 'Score__c', type: 'number', operator: 'greater_or_equal', value: '100', style: 'fill_green' });
        const star = rule('Top', { field: 'Score__c', type: 'number', operator: 'greater_or_equal', value: '100', style: 'icon_success' });
        await mount([SCORE_BAR, green, star]);
        const top = cell(3, 'Score__c');
        expect(top.classList).toContain('rh-fmt_fill-green');
        expect(top.classList).toContain('rh-fmt_databar');
        expect(bar(3, 'Score__c')).toBe('100%');
        expect(icon(3, 'Score__c').iconName).toBe('utility:success');
    });

    it('keeps a frozen cell\'s offset: the bar is added to its style', async () => {
        // Frozen columns sit at offsets taken from the pinned widths; JSDOM has
        // no layout, so every header cell reports 150px.
        const spy = jest.spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 150, height: 33, top: 0, left: 0, right: 150, bottom: 33, x: 0, y: 0 });
        try {
            await mount([SCORE_BAR], { frozenColumns: 3 });
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
            await flush();
            const score = cell(1, 'Score__c');
            expect(score.classList).toContain('rh-frozen');
            expect(score.classList).toContain('rh-fmt_databar');
            expect(score.style.left).toBe('300px'); // after Name and Amount
            expect(score.style.getPropertyValue('--rh-databar')).toBe('10%');
        } finally {
            spy.mockRestore();
        }
    });

    it('draws the bar in a card, behind the value', async () => {
        await mount([SCORE_BAR], { layout: 'cards' });
        // Under the title (Name), a card shows Amount, Score and Stage.
        const value = [...$(`li[data-row-id="${id(2)}"]`).querySelectorAll('.rh-card-value')][1];
        expect(value.classList).toContain('rh-fmt_databar');
        expect(value.style.getPropertyValue('--rh-databar')).toBe('50%');
        const blank = [...$(`li[data-row-id="${id(4)}"]`).querySelectorAll('.rh-card-value')][1];
        expect(blank.classList).not.toContain('rh-fmt_databar');
    });
});

describe('formula rules', () => {
    const AT_RISK = rule('At_Risk', { isFormula: true, style: 'fill_red', applyTo: 'row' });
    const HOT = rule('Hot', { isFormula: true, field: 'Stage__c', style: 'bold' });
    const FLAGGED = rule('Flagged', { isFormula: true, style: 'icon_error', applyTo: 'row' });

    it('formats the rows whose _rules name the rule, and no others', async () => {
        await mount([AT_RISK]);
        expect(tr(1).classList).toContain('rh-row_bar');
        expect(tr(1).classList).toContain('rh-fmt_bar-red');
        [2, 3, 4].forEach(n => expect(tr(n).classList).not.toContain('rh-row_bar'));
        expect(said(1, 'Name')).toEqual([', At Risk']);
    });

    it('formats one cell for a cell rule, and puts a row rule\'s icon on the first value', async () => {
        await mount([HOT, FLAGGED]);
        expect(cell(3, 'Stage__c').classList).toContain('rh-fmt_bold');
        expect(cell(3, 'Name').classList).not.toContain('rh-fmt_bold');
        expect(icon(3, 'Name').iconName).toBe('utility:error');
        expect(icon(3, 'Name').variant).toBe('error');
        expect(cell(1, 'Stage__c').classList).not.toContain('rh-fmt_bold');
        expect(icon(1, 'Name')).toBeNull();
    });

    it('does not change with an unsaved edit: the server tests the saved record', async () => {
        await mount([AT_RISK], { drafts: { [id(1)]: { Amount__c: '5000' }, [id(2)]: { Amount__c: '-5000' } } });
        expect(tr(1).classList).toContain('rh-fmt_bar-red');
        expect(tr(2).classList).not.toContain('rh-fmt_bar-red');
    });

    it('follows the rows the server sends back after a save', async () => {
        await mount([AT_RISK]);
        el.config = { ...el.config, rows: ROWS.map(r => ({ ...r, _rules: r.Id === id(2) ? ['At_Risk'] : [] })) };
        await flush();
        expect(tr(1).classList).not.toContain('rh-fmt_bar-red');
        expect(tr(2).classList).toContain('rh-fmt_bar-red');
    });

    it('formats a card the same way, with a row rule\'s icon on the card\'s first value', async () => {
        await mount([AT_RISK, HOT, FLAGGED], { layout: 'cards' });
        const card = $(`li[data-row-id="${id(1)}"]`);
        expect(card.classList).toContain('rh-fmt_bar-red');
        expect($(`li[data-row-id="${id(2)}"]`).classList).not.toContain('rh-card_bar');
        // The first column is the card's title, not a field: the icon goes on
        // the first value under it, Amount, where it can be seen.
        const values = [...$(`li[data-row-id="${id(3)}"]`).querySelectorAll('.rh-card-value')];
        const shown = values[0].querySelector('lightning-icon.rh-format-icon');
        expect(shown.iconName).toBe('utility:error');
        expect(shown.alternativeText).toBe('Flagged');
        expect($$('li.rh-card lightning-icon.rh-format-icon')).toHaveLength(1);
        expect(values[2].classList).toContain('rh-fmt_bold'); // Stage, the cell rule
    });

    it('in a card showing every field, keeps the row\'s icon on the first value under the title', async () => {
        await mount([FLAGGED], { layout: 'cards' });
        $(`.rh-card-more[data-row-id="${id(3)}"]`).click();
        await flush();
        // The title is editable, so it is a field again among all of them.
        const card = $(`li[data-row-id="${id(3)}"]`);
        expect([...card.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['Name', 'Amount', 'Score', 'Stage']);
        const values = [...card.querySelectorAll('.rh-card-value')];
        expect(values[0].querySelector('.rh-format-icon')).toBeNull();
        expect(values[1].querySelector('.rh-format-icon').iconName).toBe('utility:error');
    });
});
