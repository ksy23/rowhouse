/**
 * Row colors and frozen columns. A frozen cell
 * had a white background that beat SLDS's hover and selected colors, so a
 * hovered or selected row looked broken where it was frozen; an open row's
 * panel did not read as its row's; the frozen edge's line wiped the focus
 * ring off the last frozen column. Jest has no layout or hover: the classes
 * the stylesheet relies on are checked in the markup, and the rules as written.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

/* global require, __dirname -- Jest runs in Node, where the test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
// Comments out, and the layout flattened (a long value such as color-mix(...)
// may be broken over several lines by the formatter), so the patterns below
// test what the CSS says rather than how it is laid out.
const css = fs
    .readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
/** The declarations of the rule whose selector list is exactly `selector`. */
const ruleFor = selector => {
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        if (m[1].trim().replace(/\s+/g, ' ') === selector) return m[2];
    }
    return null;
};

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, frozen: true },
    { field: 'Stage__c', label: 'Stage', type: 'text', editable: true, sortable: true }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'One', Stage__c: 'Open' },
    { Id: id(2), Name: 'Two', Stage__c: 'Won' }
];

describe("frozen cells take the row's colors", () => {
    it('paints a frozen cell white only while its row is at rest and has no tint', () => {
        const rule = ruleFor(
            '.rh-grid :where(tr:not(:hover):not(.rh-row_selected):not(.rh-row_open):not(.rh-row_bar)) > td.rh-frozen'
        );
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/background-color:\s*var\(--slds-g-color-neutral-base-100/);
        // Nowhere else is a frozen cell given a background of its own.
        const others = css.match(/[^{}]*\.rh-frozen[^{}]*\{[^}]*background/g) || [];
        expect(others.map(s => s.trim().split('{')[0].trim())).toEqual([
            '.rh-grid :where(tr:not(:hover):not(.rh-row_selected):not(.rh-row_open):not(.rh-row_bar)) > td.rh-frozen'
        ]);
    });

    it('shades an open row, weakly enough for formats and selection to show through', () => {
        const rule = ruleFor('.rh-grid :where(tr.rh-row_open) > td');
        expect(rule).toMatch(/background-color:\s*var\(--slds-g-color-palette-blue-95/);
    });

    it('shades an open row and its panel the same very light blue: blue 95 mixed half with white', () => {
        // Light blue, not grey, and lighter than blue 95.
        const mix =
            /background-color:\s*color-mix\(in srgb, var\(--slds-g-color-palette-blue-95[^;]* 50%, var\(--slds-g-color-neutral-base-100/;
        [
            '.rh-grid :where(tr.rh-row_open) > td',
            '.rh-grid td.rh-detail-cell, .rh-grid tr.rh-detail-row:hover > td.rh-detail-cell',
            '.rh-card-detail'
        ].forEach(selector => {
            const rule = ruleFor(selector);
            expect(rule).not.toBeNull();
            expect(rule).toMatch(mix);
            // Blue 95 first, for a browser without color-mix().
            expect(rule.indexOf('var(--slds-g-color-palette-blue-95')).toBeLessThan(rule.indexOf('color-mix'));
        });
    });

    it('darkens the selected range on an open row, which is already nearly its color', () => {
        expect(ruleFor('.rh-grid tr.rh-row_open > td.rh-in-range')).toMatch(/var\(--slds-g-color-palette-blue-90/);
    });

    it('draws a line under the header row, in the color of the row lines', () => {
        expect(ruleFor('.rh-grid .rh-thead th')).toMatch(
            /border-bottom:\s*var\(--slds-g-sizing-border-1[^;]*solid var\(--slds-g-color-neutral-base-80/
        );
    });

    it("draws a focused header cell's ring over its content, where SLDS's white control cannot cover it", () => {
        // Found in Lightning Experience: a focused column header showed
        // no ring, and Select all a clipped piece of one.
        const rule = ruleFor('.rh-grid th.rh-cell_focus::after');
        expect(rule).toMatch(/position:\s*absolute/);
        expect(rule).toMatch(/box-shadow:\s*inherit/);
        expect(rule).toMatch(/pointer-events:\s*none/);
    });

    it('lets the Select all wrapper fill its cell, the checkbox kept at the right', () => {
        const rule = ruleFor('.rh-grid .rh-select-all-action');
        expect(rule).toMatch(/display:\s*flex/);
        expect(rule).toMatch(/justify-content:\s*flex-end/);
    });

    it('keeps the focus ring on the last frozen column, beside the edge line', () => {
        const rule = ruleFor('.rh-grid .rh-frozen_last.rh-cell_focus');
        expect(rule).not.toBeNull();
        const shadow = rule.replace(/\s+/g, ' ');
        expect(shadow).toMatch(/box-shadow: inset 0 0 0 2px [^;]*, inset -1px 0 0 /); // the 2px ring, then the edge
    });

    it('names no SLDS class (HR-15)', () => {
        expect(css).not.toMatch(/\.slds-[\w-]+[^{}]*\{/);
    });
});

describe('the row classes those rules rely on', () => {
    let el;
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });
    const tr = rowId => el.shadowRoot.querySelector(`tr[data-row-id="${rowId}"]`);

    it("marks a selected row rh-row_selected, beside SLDS's own class", async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows: ROWS, selection: 'multi', selectedIds: [id(1)] };
        document.body.appendChild(el);
        await flush();
        el.shadowRoot.querySelector(`td[data-row-id="${id(1)}"][data-field="__select"] input`).click();
        await flush();
        const selected = [id(1), id(2)].filter(r => tr(r).classList.contains('slds-is-selected'));
        expect(selected).toHaveLength(1);
        expect(tr(selected[0]).classList).toContain('rh-row_selected');
        const other = selected[0] === id(1) ? id(2) : id(1);
        expect(tr(other).classList).not.toContain('rh-row_selected');
    });

    it("marks a focused cell rh-cell_focus, beside SLDS's slds-has-focus", async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows: ROWS };
        document.body.appendChild(el);
        await flush();
        const td = el.shadowRoot.querySelector(`td[data-row-id="${id(1)}"][data-field="Name"]`);
        td.focus();
        await flush();
        const focused = el.shadowRoot.querySelector('td.slds-has-focus');
        expect(focused).not.toBeNull();
        expect(focused.classList).toContain('rh-cell_focus');
    });
});
