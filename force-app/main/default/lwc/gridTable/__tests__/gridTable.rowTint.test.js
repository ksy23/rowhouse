/**
 * A whole-row rule's fill: a light tint across the row, and a bar at its left
 * edge. The tint has to stay under every color Lightning and the grid paint
 * on a row (hover, selected, unsaved, an open row, a cell's fill), so each of
 * them still shows on a tinted row.
 */

/* global require, __dirname -- Jest runs in Node, where the test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule whose selector is exactly `selector`, spaces collapsed. */
function block(selector) {
    const at = css.indexOf(selector + ' {');
    if (at < 0) {
        throw new Error('No rule for ' + selector);
    }
    const start = css.indexOf('{', at) + 1;
    return css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ').trim();
}

const COLORS = ['green', 'amber', 'red', 'purple', 'grey'];

describe("a whole-row rule's tint", () => {
    it.each(COLORS)('gives %s a tint as well as a bar', color => {
        const d = block('.rh-fmt_bar-' + color);
        expect(d).toMatch(/--rh-bar-color:/);
        expect(d).toMatch(/--rh-tint-color:/);
    });

    const TINT =
        '.rh-grid :where(tr.rh-row_bar:not(:hover):not(.rh-row_selected):not(.rh-row_open)) > td:where(:not(.rh-cell_draft))';

    it('paints every cell of a row at rest', () => {
        expect(block(TINT)).toBe('background-color: var(--rh-tint-color);');
    });

    it("stands aside for the hover, selected and open-row colors, and an unsaved cell's yellow", () => {
        // Measured in Lightning: the component's scoped rule outranks SLDS's
        // row colors even inside :where(), so each state is named.
        [':not(:hover)', ':not(.rh-row_selected)', ':not(.rh-row_open)', ':not(.rh-cell_draft)'].forEach(state =>
            expect(TINT).toContain(state)
        );
    });

    it("leaves Lightning's unsaved yellow and hover grey to Lightning", () => {
        // Measured in Lightning Experience: an unsaved cell is yellow 95, a
        // hovered row neutral 95. A tint in either would hide it.
        const amber = block('.rh-fmt_bar-amber');
        expect(amber).not.toMatch(/palette-yellow-95/);
        expect(amber).toMatch(/palette-orange-95/);
        const grey = block('.rh-fmt_bar-grey');
        expect(grey).toMatch(/color-mix\(/);
        expect(grey).toMatch(/palette-neutral-95, rgb\(243, 243, 243\)\) 50%/);
    });

    it('stays lighter than a cell fill, so a cell rule still shows on a tinted row', () => {
        ['green', 'red', 'purple'].forEach(color => {
            expect(block('.rh-fmt_bar-' + color)).toMatch(new RegExp('palette-' + color + '-95'));
        });
    });

    it('reaches a frozen cell, which is white only on a row at rest with no tint', () => {
        expect(css).toContain(
            '.rh-grid :where(tr:not(:hover):not(.rh-row_selected):not(.rh-row_open):not(.rh-row_bar)) > td.rh-frozen {'
        );
    });

    it('tints a record card as its row is tinted', () => {
        expect(block('.rh-cards .rh-card_bar')).toContain('background-color: var(--rh-tint-color);');
    });
});
