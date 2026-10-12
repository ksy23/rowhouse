import {
    readChoice,
    shownColumns,
    hiddenFields,
    canHide,
    hideColumn,
    moveColumn,
    chooseColumns,
    sameChoice,
    searchHint
} from 'c/gridColumns';

// The admin's columns, in the admin's order; Name is Always Shown.
const COLS = [
    { field: 'Name', alwaysShown: true },
    { field: 'StageName' },
    { field: 'Amount' },
    { field: 'CloseDate' }
];
const fields = list => list.map(c => c.field);

describe('reading a kept choice back', () => {
    it("is null for the admin's columns, and for nothing kept", () => {
        expect(readChoice(null, COLS)).toBeNull();
        expect(readChoice('nonsense', COLS)).toBeNull();
        expect(readChoice({ order: ['Name', 'StageName', 'Amount', 'CloseDate'], hidden: [] }, COLS)).toBeNull();
    });

    it('drops keys the grid no longer has, and places columns added since after their neighbour', () => {
        const read = readChoice(
            { order: ['Amount', 'Probability', 'Name', 'StageName'], hidden: ['Probability'] },
            COLS
        );
        // CloseDate is new to this user: it follows Amount, the column before it in the admin's order.
        expect(read).toEqual({ order: ['Amount', 'CloseDate', 'Name', 'StageName'], hidden: [] });
    });

    it('puts a new first column first', () => {
        const cols = [{ field: 'OwnerId' }].concat(COLS);
        expect(readChoice({ order: ['StageName', 'Name', 'Amount', 'CloseDate'] }, cols).order[0]).toBe('OwnerId');
    });

    it('never hides an Always Shown column, nor every column', () => {
        expect(readChoice({ order: fields(COLS), hidden: ['Name', 'StageName'] }, COLS)).toEqual({
            order: fields(COLS),
            hidden: ['StageName']
        });
        const all = [{ field: 'Email' }, { field: 'Phone' }];
        expect(readChoice({ order: ['Phone', 'Email'], hidden: ['Email', 'Phone'] }, all)).toEqual({
            order: ['Phone', 'Email'],
            hidden: []
        });
    });

    it('ignores what is not a key, and duplicates', () => {
        expect(
            readChoice(
                { order: ['CloseDate', 7, '', 'CloseDate', null, 'Name', 'StageName', 'Amount'], hidden: [{}] },
                COLS
            )
        ).toEqual({
            order: ['CloseDate', 'Name', 'StageName', 'Amount'],
            hidden: []
        });
    });
});

describe('the columns drawn', () => {
    it("are the admin's without a choice", () => {
        expect(shownColumns(COLS, null)).toBe(COLS);
        expect(hiddenFields(COLS, null)).toEqual([]);
    });

    it("follow the user's order, without the hidden ones", () => {
        const choice = { order: ['Amount', 'Name', 'StageName', 'CloseDate'], hidden: ['StageName'] };
        expect(fields(shownColumns(COLS, choice))).toEqual(['Amount', 'Name', 'CloseDate']);
        expect(hiddenFields(COLS, choice)).toEqual(['StageName']);
        expect(shownColumns(COLS, choice)[0]).toBe(COLS[2]);
    });
});

describe('hiding a column', () => {
    it('hides it, and goes back to null when nothing is left to differ', () => {
        const hidden = hideColumn(COLS, null, 'StageName');
        expect(hidden).toEqual({ order: fields(COLS), hidden: ['StageName'] });
        expect(chooseColumns(COLS, hidden, fields(COLS))).toBeNull();
    });

    it('refuses an Always Shown column, a hidden one and the last one showing', () => {
        expect(canHide(COLS, null, 'Name')).toBe(false);
        expect(hideColumn(COLS, null, 'Name')).toBeNull();
        const choice = { order: fields(COLS), hidden: ['StageName'] };
        expect(canHide(COLS, choice, 'StageName')).toBe(false);
        const two = [{ field: 'Email' }, { field: 'Phone' }];
        const one = hideColumn(two, null, 'Email');
        expect(canHide(two, one, 'Phone')).toBe(false);
        expect(hideColumn(two, one, 'Phone')).toEqual(one);
        expect(canHide(COLS, null, 'NextStep')).toBe(false);
    });
});

describe('moving a column', () => {
    it('puts it before or after another', () => {
        expect(moveColumn(COLS, null, 'CloseDate', 'StageName', false).order).toEqual([
            'Name',
            'CloseDate',
            'StageName',
            'Amount'
        ]);
        expect(moveColumn(COLS, null, 'Name', 'Amount', true).order).toEqual([
            'StageName',
            'Amount',
            'Name',
            'CloseDate'
        ]);
    });

    it('keeps what is hidden hidden, and changes nothing moved onto itself or an unknown column', () => {
        const choice = hideColumn(COLS, null, 'Amount');
        expect(moveColumn(COLS, choice, 'CloseDate', 'Name', false)).toEqual({
            order: ['CloseDate', 'Name', 'StageName', 'Amount'],
            hidden: ['Amount']
        });
        expect(moveColumn(COLS, choice, 'StageName', 'StageName', true)).toEqual(choice);
        expect(moveColumn(COLS, null, 'StageName', 'Probability', true)).toBeNull();
        // Moved back where it was: the admin's columns again.
        expect(
            moveColumn(COLS, moveColumn(COLS, null, 'StageName', 'Amount', true), 'StageName', 'Amount', false)
        ).toBeNull();
    });
});

describe('the Choose columns dialog', () => {
    it('shows the chosen columns in its order and hides the rest after them', () => {
        expect(chooseColumns(COLS, null, ['Amount', 'Name'])).toEqual({
            order: ['Amount', 'Name', 'StageName', 'CloseDate'],
            hidden: ['StageName', 'CloseDate']
        });
    });

    it('keeps an Always Shown column the list left out, and ignores an empty list', () => {
        expect(fields(shownColumns(COLS, chooseColumns(COLS, null, ['StageName'])))).toEqual(['StageName', 'Name']);
        const choice = hideColumn(COLS, null, 'StageName');
        expect(chooseColumns(COLS, choice, [])).toEqual(choice);
        const plain = [{ field: 'Email' }, { field: 'Phone' }];
        expect(chooseColumns(plain, null, ['Probability'])).toBeNull();
    });
});

describe('comparing choices', () => {
    it('tells the same choice from a different one', () => {
        expect(sameChoice(null, undefined)).toBe(true);
        expect(sameChoice(null, { order: ['Email'], hidden: [] })).toBe(false);
        expect(
            sameChoice(
                { order: ['Email', 'Phone'], hidden: ['Phone'] },
                { order: ['Email', 'Phone'], hidden: ['Phone'] }
            )
        ).toBe(true);
        expect(sameChoice({ order: ['Email', 'Phone'], hidden: [] }, { order: ['Phone', 'Email'], hidden: [] })).toBe(
            false
        );
    });
});

describe('searchHint', () => {
    const col = (label, searchable) => ({ field: label.replace(/ /g, '_'), label, searchable });

    it('says nothing when search looks in every column', () => {
        expect(searchHint([col('Name', true), col('Consignee', true)])).toBe('');
        expect(searchHint([])).toBe('');
    });

    it("names one column as Salesforce's list view does", () => {
        expect(searchHint([col('Name', true), col('Ship Date', false)])).toBe(
            "Ship Date isn't searchable. Use filters or sort on this field instead."
        );
    });

    it('names up to four, then the first three and how many more', () => {
        expect(searchHint([col('Pieces', false), col('Ship Date', false), col('Name', true)])).toBe(
            "Pieces and Ship Date aren't searchable. Use filters or sort on these fields instead."
        );
        const many = ['Pieces', 'Ship Date', 'Freight Charge', 'Delivered', 'Pallet Positions'].map(l => col(l, false));
        expect(searchHint(many)).toBe(
            "Pieces, Ship Date, Freight Charge and 2 other columns aren't searchable. Use filters or sort on these fields instead."
        );
    });
});
