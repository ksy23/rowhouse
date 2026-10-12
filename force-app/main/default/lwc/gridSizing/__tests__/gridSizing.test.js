/**
 * Column widths and wrapped row heights: a figure is never cut off, and
 * a wrapped row takes only the lines its values need.
 */
import {
    minWidthFor,
    fitsToValues,
    textWidth,
    fitWidth,
    linesNeeded,
    FIT_CAP,
    CELL_PADDING,
    EDIT_BUTTON,
    MAX_LINES
} from 'c/gridSizing';

describe('minimum widths by type', () => {
    it('gives numbers, dates and checkboxes a floor, and text none', () => {
        expect(minWidthFor('date')).toBe(110);
        expect(minWidthFor('datetime')).toBe(170);
        expect(minWidthFor('currency')).toBe(130);
        expect(minWidthFor('percent')).toBe(100);
        expect(minWidthFor('checkbox')).toBe(80);
        expect(minWidthFor('text')).toBe(0);
        expect(minWidthFor(undefined)).toBe(0);
    });

    it('fits numbers and dates to their values, not text', () => {
        ['number', 'currency', 'percent', 'date', 'datetime'].forEach(t => expect(fitsToValues(t)).toBe(true));
        ['text', 'picklist', 'checkbox', 'reference'].forEach(t => expect(fitsToValues(t)).toBe(false));
    });
});

describe('estimated text width', () => {
    it('gives a figure its full width, and grows with the text', () => {
        expect(textWidth('')).toBe(0);
        expect(textWidth(null)).toBe(0);
        expect(textWidth('1')).toBeCloseTo(7.4);
        expect(textWidth('$1,234,567.00')).toBeGreaterThan(textWidth('$1,234.00'));
        expect(textWidth('WWW')).toBeGreaterThan(textWidth('iii'));
    });
});

describe('fitting a column to its values', () => {
    it('widens to the widest value, with padding and the edit button', () => {
        const w = fitWidth(['$5.00', '$1,234,567.00'], { type: 'currency', editable: true });
        expect(w).toBe(Math.ceil(textWidth('$1,234,567.00') + CELL_PADDING + EDIT_BUTTON));
        expect(w).toBeGreaterThan(130);
    });

    it("never goes below the type's minimum, nor above the cap", () => {
        expect(fitWidth(['1'], { type: 'number' })).toBe(100);
        expect(fitWidth(['9'.repeat(80)], { type: 'number' })).toBe(FIT_CAP);
        expect(fitWidth([], { type: 'date' })).toBe(110);
    });

    it('keeps room for the header label and its controls', () => {
        expect(fitWidth(['1'], { type: 'number', label: 'Pallet Positions' })).toBeGreaterThan(100);
    });
});

describe('lines a wrapped row needs', () => {
    it('is one line when every value fits', () => {
        expect(linesNeeded(['Dock 4', '', null], 200)).toBe(1);
        expect(linesNeeded([], 200)).toBe(1);
    });

    it('grows with long values and line breaks, up to three', () => {
        expect(linesNeeded(['Deliver to the rear dock, call ahead first'], 200)).toBe(2);
        expect(linesNeeded(['Liftgate\nCall ahead'], 200)).toBe(2);
        expect(linesNeeded(['Deliver to the rear loading dock. '.repeat(30)], 200)).toBe(MAX_LINES);
    });

    it('leaves room for the edit button in an editable column', () => {
        const text = 'Kennebec Lumber, Augusta'; // about 160px
        expect(linesNeeded([text], 200)).toBe(1);
        expect(linesNeeded([text], 200, { editable: true })).toBe(2);
    });
});
