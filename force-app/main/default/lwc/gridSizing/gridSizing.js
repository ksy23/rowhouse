/**
 * gridSizing — how wide a column must be, and how many lines a wrapped row
 * needs. Plain functions: no DOM, no state (HR-25).
 *
 * WHY
 * A figure cut off with an ellipsis is a wrong figure: "$1,234,567...." could
 * be $1.2 million or $1.2 billion. So a number, a
 * date or a date/time is never squeezed below the width its type needs, and a
 * column of them widens to fit its widest loaded value, up to a cap; beyond
 * the grid's width the table scrolls sideways instead of squeezing. Text is
 * still clipped: its first words still say something.
 *
 * And a wrapped column made every row three lines tall, whatever it held.
 * Rows still share one height (the windowing needs it), but that height
 * is now the lines the loaded values need: one, two or three.
 *
 * MEASURING WITHOUT A PAGE
 * Widths are estimated from the characters, at the grid's 13px system font:
 * wide enough for a figure, and the same in the browser and in Jest. The
 * table checks the wrapped cells it has drawn and adds a line if a value
 * turned out longer than estimated.
 */

/** px: the least a column of each type may be, before any value is measured. */
export const MIN_WIDTH_BY_TYPE = Object.freeze({
    date: 110,
    datetime: 170,
    currency: 130,
    number: 100,
    double: 100,
    integer: 100,
    long: 100,
    percent: 100,
    checkbox: 80,
    boolean: 80
});
/** px: the widest a column is made to fit its values; wider is the user's choice. */
export const FIT_CAP = 300;
/** px: a text column fitted by a double-click on its resize handle. */
export const TEXT_FIT_CAP = 400;
/** px: a cell's padding, left and right (SLDS: 0.5rem each, measured). */
export const CELL_PADDING = 16;
/** px: the edit button and its margin, which an editable cell keeps room for. */
export const EDIT_BUTTON = 32;
/** px: a header's sort arrow and menu button, beside its label. */
export const HEADER_CONTROLS = 44;
/** The most lines a wrapped cell shows. */
export const MAX_LINES = 3;

const FIT_TYPES = new Set(['date', 'datetime', 'currency', 'number', 'double', 'integer', 'long', 'percent']);

/** px: the least width for a column of `type`, or 0 when the type has none. */
export function minWidthFor(type) {
    return MIN_WIDTH_BY_TYPE[type] || 0;
}

/** Does a column of this type widen to fit its values? Numbers and dates do. */
export function fitsToValues(type) {
    return FIT_TYPES.has(type);
}

// px per character at 13px, by kind: a figure is 7.4 wide in the system font.
const NARROW = /[\s.,:;'|!ilIjft()[\]/\\]/;
const WIDE = /[MWmw@%]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9$€£¥]/;

/** px: an estimate of `text` at the grid's 13px font. */
export function textWidth(text) {
    const s = text == null ? '' : String(text);
    let w = 0;
    for (const ch of s) {
        if (DIGIT.test(ch)) w += 7.4;
        else if (NARROW.test(ch)) w += 3.8;
        else if (WIDE.test(ch)) w += 10.5;
        else if (UPPER.test(ch)) w += 8.6;
        else if (ch.codePointAt(0) > 0x2e80) w += 13; // CJK and emoji take a full em
        else w += 6.8;
    }
    return w;
}

/**
 * px: the width a column needs to show every one of `texts` whole, with its
 * padding, and the edit button's room when it is editable; never below the
 * type's minimum, nor above `cap`.
 */
export function fitWidth(texts, { type, editable = false, cap = FIT_CAP, label = '' } = {}) {
    let widest = 0;
    (texts || []).forEach(t => {
        widest = Math.max(widest, textWidth(t));
    });
    const header = label ? textWidth(label) + HEADER_CONTROLS : 0;
    const need = Math.ceil(Math.max(widest + CELL_PADDING + (editable ? EDIT_BUTTON : 0), header));
    return Math.min(cap, Math.max(minWidthFor(type), need));
}

/**
 * The lines, 1 to `max`, that every one of `texts` needs in a column `width`
 * px wide: line breaks kept, each paragraph wrapped by its estimated width,
 * with a little slack because words wrap whole.
 */
export function linesNeeded(texts, width, { editable = false, max = MAX_LINES } = {}) {
    const room = Math.max(1, width - CELL_PADDING - (editable ? EDIT_BUTTON : 0));
    let most = 1;
    for (const t of texts || []) {
        if (t == null || t === '') continue;
        let lines = 0;
        String(t).split('\n').forEach(part => {
            // Short enough at the widest character: one line, without measuring.
            if (part.length * 13 <= room) lines += 1;
            else lines += Math.max(1, Math.ceil((textWidth(part) * 1.1) / room));
        });
        most = Math.max(most, lines);
        if (most >= max) return max;
    }
    return Math.min(max, most);
}
