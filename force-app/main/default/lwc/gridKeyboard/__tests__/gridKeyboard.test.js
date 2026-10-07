/**
 * gridKeyboard's verbs for the keys that start an edit: a spreadsheet's
 * F2, Enter and typing, on top of the SLDS grid model's action mode. The
 * table's side is in gridTable.editing.test.js.
 */
import { actionFor, isPrintable, MODE_NAVIGATION, MODE_ACTION } from 'c/gridKeyboard';

const editable = { editable: true };

describe('keys that start an edit', () => {
    it('F2 edits an editable data cell', () => {
        expect(actionFor('F2', MODE_NAVIGATION, editable)).toBe('edit');
    });

    it('Enter edits an editable data cell, unless its content is a link', () => {
        expect(actionFor('Enter', MODE_NAVIGATION, editable)).toBe('edit');
        // A record name, an email address: Enter reaches the link, as before.
        expect(actionFor('Enter', MODE_NAVIGATION, { editable: true, hasLink: true })).toBe('enterAction');
        // F2 still edits a linked cell.
        expect(actionFor('F2', MODE_NAVIGATION, { editable: true, hasLink: true })).toBe('edit');
    });

    it('Enter and F2 keep to action mode on a read-only cell and on a header', () => {
        expect(actionFor('Enter', MODE_NAVIGATION, {})).toBe('enterAction');
        expect(actionFor('F2', MODE_NAVIGATION, {})).toBe('enterAction');
        expect(actionFor('Enter', MODE_NAVIGATION, { isHeader: true, editable: true })).toBe('enterAction');
    });

    it('a printable character starts editing an editable cell', () => {
        expect(actionFor('a', MODE_NAVIGATION, editable)).toBe('typeToEdit');
        expect(actionFor('7', MODE_NAVIGATION, editable)).toBe('typeToEdit');
        expect(actionFor('é', MODE_NAVIGATION, editable)).toBe('typeToEdit');
        expect(actionFor('a', MODE_NAVIGATION, {})).toBeNull();
        expect(actionFor('a', MODE_NAVIGATION, { isHeader: true, editable: true })).toBeNull();
    });

    it('a shortcut is not typing: Ctrl, Cmd or Alt', () => {
        expect(actionFor('c', MODE_NAVIGATION, { ...editable, ctrlKey: true })).toBeNull();
        expect(actionFor('v', MODE_NAVIGATION, { ...editable, metaKey: true })).toBeNull();
        expect(actionFor('x', MODE_NAVIGATION, { ...editable, altKey: true })).toBeNull();
    });

    it('Space still selects, and arrows still move', () => {
        expect(actionFor(' ', MODE_NAVIGATION, editable)).toBe('toggleSelect');
        expect(actionFor('ArrowDown', MODE_NAVIGATION, editable)).toBe('move');
    });

    it('in action mode the keys belong to the control, Escape excepted', () => {
        expect(actionFor('a', MODE_ACTION, editable)).toBeNull();
        expect(actionFor('Enter', MODE_ACTION, editable)).toBeNull();
        expect(actionFor('Escape', MODE_ACTION, editable)).toBe('exitAction');
    });
});

describe('isPrintable', () => {
    it('is one character, typed without a modifier, and not Space', () => {
        expect(isPrintable('a')).toBe(true);
        expect(isPrintable('😀')).toBe(true); // one character, two UTF-16 units
        expect(isPrintable(' ')).toBe(false);
        expect(isPrintable('Enter')).toBe(false);
        expect(isPrintable('Shift')).toBe(false);
        expect(isPrintable('a', { metaKey: true })).toBe(false);
        expect(isPrintable(undefined)).toBe(false);
    });
});
