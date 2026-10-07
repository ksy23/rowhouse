import { readChoice, shownColumns, hiddenFields, canHide, hideColumn, moveColumn, chooseColumns, sameChoice } from 'c/gridColumns';

// The admin's columns, in the admin's order; Name is Always Shown.
const COLS = [
    { field: 'Name', alwaysShown: true },
    { field: 'Stage' },
    { field: 'Amount' },
    { field: 'CloseDate' }
];
const fields = list => list.map(c => c.field);

describe('reading a kept choice back', () => {
    it('is null for the admin\'s columns, and for nothing kept', () => {
        expect(readChoice(null, COLS)).toBeNull();
        expect(readChoice('nonsense', COLS)).toBeNull();
        expect(readChoice({ order: ['Name', 'Stage', 'Amount', 'CloseDate'], hidden: [] }, COLS)).toBeNull();
    });

    it('drops keys the grid no longer has, and places columns added since after their neighbour', () => {
        const read = readChoice({ order: ['Amount', 'Gone', 'Name', 'Stage'], hidden: ['Gone'] }, COLS);
        // CloseDate is new to this user: it follows Amount, the column before it in the admin's order.
        expect(read).toEqual({ order: ['Amount', 'CloseDate', 'Name', 'Stage'], hidden: [] });
    });

    it('puts a new first column first', () => {
        const cols = [{ field: 'Owner' }].concat(COLS);
        expect(readChoice({ order: ['Stage', 'Name', 'Amount', 'CloseDate'] }, cols).order[0]).toBe('Owner');
    });

    it('never hides an Always Shown column, nor every column', () => {
        expect(readChoice({ order: fields(COLS), hidden: ['Name', 'Stage'] }, COLS)).toEqual({
            order: fields(COLS),
            hidden: ['Stage']
        });
        const all = [{ field: 'A' }, { field: 'B' }];
        expect(readChoice({ order: ['B', 'A'], hidden: ['A', 'B'] }, all)).toEqual({ order: ['B', 'A'], hidden: [] });
    });

    it('ignores what is not a key, and duplicates', () => {
        expect(readChoice({ order: ['CloseDate', 7, '', 'CloseDate', null, 'Name', 'Stage', 'Amount'], hidden: [{}] }, COLS)).toEqual({
            order: ['CloseDate', 'Name', 'Stage', 'Amount'],
            hidden: []
        });
    });
});

describe('the columns drawn', () => {
    it('are the admin\'s without a choice', () => {
        expect(shownColumns(COLS, null)).toBe(COLS);
        expect(hiddenFields(COLS, null)).toEqual([]);
    });

    it('follow the user\'s order, without the hidden ones', () => {
        const choice = { order: ['Amount', 'Name', 'Stage', 'CloseDate'], hidden: ['Stage'] };
        expect(fields(shownColumns(COLS, choice))).toEqual(['Amount', 'Name', 'CloseDate']);
        expect(hiddenFields(COLS, choice)).toEqual(['Stage']);
        expect(shownColumns(COLS, choice)[0]).toBe(COLS[2]);
    });
});

describe('hiding a column', () => {
    it('hides it, and goes back to null when nothing is left to differ', () => {
        const hidden = hideColumn(COLS, null, 'Stage');
        expect(hidden).toEqual({ order: fields(COLS), hidden: ['Stage'] });
        expect(chooseColumns(COLS, hidden, fields(COLS))).toBeNull();
    });

    it('refuses an Always Shown column, a hidden one and the last one showing', () => {
        expect(canHide(COLS, null, 'Name')).toBe(false);
        expect(hideColumn(COLS, null, 'Name')).toBeNull();
        const choice = { order: fields(COLS), hidden: ['Stage'] };
        expect(canHide(COLS, choice, 'Stage')).toBe(false);
        const two = [{ field: 'A' }, { field: 'B' }];
        const one = hideColumn(two, null, 'A');
        expect(canHide(two, one, 'B')).toBe(false);
        expect(hideColumn(two, one, 'B')).toEqual(one);
        expect(canHide(COLS, null, 'Nope')).toBe(false);
    });
});

describe('moving a column', () => {
    it('puts it before or after another', () => {
        expect(moveColumn(COLS, null, 'CloseDate', 'Stage', false).order).toEqual(['Name', 'CloseDate', 'Stage', 'Amount']);
        expect(moveColumn(COLS, null, 'Name', 'Amount', true).order).toEqual(['Stage', 'Amount', 'Name', 'CloseDate']);
    });

    it('keeps what is hidden hidden, and changes nothing moved onto itself or an unknown column', () => {
        const choice = hideColumn(COLS, null, 'Amount');
        expect(moveColumn(COLS, choice, 'CloseDate', 'Name', false)).toEqual({
            order: ['CloseDate', 'Name', 'Stage', 'Amount'],
            hidden: ['Amount']
        });
        expect(moveColumn(COLS, choice, 'Stage', 'Stage', true)).toEqual(choice);
        expect(moveColumn(COLS, null, 'Stage', 'Gone', true)).toBeNull();
        // Moved back where it was: the admin's columns again.
        expect(moveColumn(COLS, moveColumn(COLS, null, 'Stage', 'Amount', true), 'Stage', 'Amount', false)).toBeNull();
    });
});

describe('the Choose columns dialog', () => {
    it('shows the chosen columns in its order and hides the rest after them', () => {
        expect(chooseColumns(COLS, null, ['Amount', 'Name'])).toEqual({
            order: ['Amount', 'Name', 'Stage', 'CloseDate'],
            hidden: ['Stage', 'CloseDate']
        });
    });

    it('keeps an Always Shown column the list left out, and ignores an empty list', () => {
        expect(fields(shownColumns(COLS, chooseColumns(COLS, null, ['Stage'])))).toEqual(['Stage', 'Name']);
        const choice = hideColumn(COLS, null, 'Stage');
        expect(chooseColumns(COLS, choice, [])).toEqual(choice);
        const plain = [{ field: 'A' }, { field: 'B' }];
        expect(chooseColumns(plain, null, ['Gone'])).toBeNull();
    });
});

describe('comparing choices', () => {
    it('tells the same choice from a different one', () => {
        expect(sameChoice(null, undefined)).toBe(true);
        expect(sameChoice(null, { order: ['A'], hidden: [] })).toBe(false);
        expect(sameChoice({ order: ['A', 'B'], hidden: ['B'] }, { order: ['A', 'B'], hidden: ['B'] })).toBe(true);
        expect(sameChoice({ order: ['A', 'B'], hidden: [] }, { order: ['B', 'A'], hidden: [] })).toBe(false);
    });
});
