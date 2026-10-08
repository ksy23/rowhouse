/**
 * Reading a CSV file and planning an import from it: the CSV rules,
 * which file columns feed which grid columns, and what each row will do.
 */
import {
    parseCsv,
    detectDelimiter,
    mapHeaders,
    mappingChoices,
    mappedTo,
    planImport,
    payloadFor,
    MAX_IMPORT_ROWS,
    REQUIRED_MESSAGE,
    MAP_ID,
    MAP_SKIP
} from 'c/gridImport';
import { toCsv } from 'c/gridCsv';

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, required: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', editable: true, scale: 2 },
    { field: 'Due__c', label: 'Due', type: 'date', editable: true },
    { field: 'Done__c', label: 'Done', type: 'checkbox', editable: true },
    {
        field: 'Stage__c',
        label: 'Stage',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'beta_api', label: 'Beta' },
            { value: 'Gamma', label: 'Gamma' }
        ]
    },
    { field: 'Account__c', label: 'Account', type: 'reference', editable: true },
    { field: 'Doubled__c', label: 'Doubled', type: 'number', editable: false },
    {
        field: 'Region__c',
        label: 'Region',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'North', label: 'North' },
            { value: 'South', label: 'South' }
        ]
    },
    {
        field: 'City__c',
        label: 'City',
        type: 'picklist',
        editable: true,
        dependentOn: 'Region__c',
        options: [
            { value: 'Oslo', label: 'Oslo', validFor: ['North'] },
            { value: 'Rome', label: 'Rome', validFor: ['South'] }
        ]
    }
];
const ID1 = 'a00000000000001AAA';
const ID2 = 'a00000000000002AAA';
const LOADED = [
    { Id: ID1, Name: 'One', Region__c: 'North' },
    { Id: ID2, Name: 'Two', Region__c: 'South' }
];
const ACCOUNT = '001000000000009AAA';
const plan = (table, options = {}) =>
    planImport(table, {
        columns: COLUMNS,
        rows: LOADED,
        refNames: { [ACCOUNT]: 'Acme' },
        canCreate: true,
        locale: 'en-US',
        ...options
    });

describe('parseCsv', () => {
    it('reads quoted fields with separators, doubled quotes and line breaks, and any line ending', () => {
        const text = 'Name,Note\r\n"Smith, John","She said ""yes"""\n"two\nlines",plain\rlast,\n';
        expect(parseCsv(text)).toEqual([
            ['Name', 'Note'],
            ['Smith, John', 'She said "yes"'],
            ['two\nlines', 'plain'],
            ['last', '']
        ]);
    });

    it('drops a byte order mark and finds the separator Excel used', () => {
        expect(parseCsv(String.fromCharCode(0xfeff) + 'a;b\n1,5;2')).toEqual([
            ['a', 'b'],
            ['1,5', '2']
        ]);
        expect(detectDelimiter('a\tb\tc\n1,2')).toBe('\t');
        expect(detectDelimiter('"x;y",b,c')).toBe(',');
        expect(parseCsv('')).toEqual([]);
    });
});

describe('mapHeaders', () => {
    it('matches labels and API names in any case, finds the Id, and says why a column is ignored', () => {
        const m = mapHeaders(['Record ID', 'name', 'AMOUNT__C', 'Doubled', 'Color', 'Amount', 'Id', ''], COLUMNS);
        expect(m.idIndex).toBe(0);
        expect(m.fields.map(f => [f.index, f.column.field])).toEqual([
            [1, 'Name'],
            [2, 'Amount__c']
        ]);
        expect(m.ignored).toEqual([
            { index: 3, header: 'Doubled', reason: 'Doubled is read-only here.' },
            { index: 4, header: 'Color', reason: 'Not a column of this grid.' },
            { index: 5, header: 'Amount', reason: 'Amount is already in another column.' },
            { index: 6, header: 'Id', reason: 'The record Id is already in another column.' }
        ]);
    });
});

describe('mapHeaders with a column of a related record', () => {
    const withParent = COLUMNS.concat([
        { field: 'Account__r.Industry', label: 'Account: Industry', type: 'picklist', editable: true, isPath: true }
    ]);

    it('leaves it out and says why: an import writes the grid’s own records only', () => {
        const m = mapHeaders(['Name', 'Account: Industry'], withParent);
        expect(m.fields.map(f => f.column.field)).toEqual(['Name']);
        expect(m.ignored).toEqual([
            {
                index: 1,
                header: 'Account: Industry',
                reason: 'Account: Industry is a field of a related record. An import changes this grid’s own records only.'
            }
        ]);
    });

    it('does not offer it as a hand mapping', () => {
        expect(mappingChoices(withParent).map(c => c.value)).not.toContain('Account__r.Industry');
    });
});

describe('mapHeaders with lookups headed by what they point to', () => {
    it('finds a lookup by its old heading, "Account ID", as well as its new one', () => {
        expect(mapHeaders(['Account ID'], COLUMNS).fields.map(f => f.column.field)).toEqual(['Account__c']);
        expect(mapHeaders(['account id'], COLUMNS).fields.map(f => f.column.field)).toEqual(['Account__c']);
        expect(mapHeaders(['Account'], COLUMNS).fields.map(f => f.column.field)).toEqual(['Account__c']);
    });

    it('gives the old heading only to lookups, and never over a real column of that name', () => {
        expect(mapHeaders(['Amount ID'], COLUMNS).ignored).toEqual([
            { index: 0, header: 'Amount ID', reason: 'Not a column of this grid.' }
        ]);
        const both = [...COLUMNS, { field: 'Account_ID__c', label: 'Account ID', type: 'text', editable: true }];
        expect(mapHeaders(['Account ID'], both).fields.map(f => f.column.field)).toEqual(['Account_ID__c']);
    });
});

describe('planImport', () => {
    it('updates rows with an Id and creates rows without, reading each value by its type', () => {
        const p = plan([
            ['Id', 'Name', 'Amount', 'Due', 'Done', 'Stage', 'Account'],
            [ID1, 'One renamed', '$1,234.567', '12/31/2026', 'yes', 'Beta', 'Acme'],
            ['', 'New row', '(5)', '2026-01-02', '', 'gamma', ACCOUNT]
        ]);
        expect(p.error).toBeNull();
        expect(p.counts).toEqual({ update: 1, create: 1, match: 0, error: 0 });
        expect(p.items[0]).toEqual({
            line: 2,
            id: ID1,
            action: 'update',
            errors: [],
            values: {
                Name: 'One renamed',
                Amount__c: 1234.57,
                Due__c: '2026-12-31',
                Done__c: true,
                Stage__c: 'beta_api',
                Account__c: ACCOUNT
            }
        });
        expect(p.items[1].action).toBe('create');
        expect(p.items[1].values).toEqual({
            Name: 'New row',
            Amount__c: -5,
            Due__c: '2026-01-02',
            Done__c: false,
            Stage__c: 'Gamma',
            Account__c: ACCOUNT
        });
        expect(payloadFor(p.items)).toEqual([{ Id: ID1, ...p.items[0].values }, { ...p.items[1].values }]);
    });

    it('reads CSV numbers and dates in the user’s locale, and Excel’s typed cells in its own', () => {
        // A required column the file leaves out is left to the platform, which
        // fills some on a new record (Owner) and refuses the rest.
        const csv = plan(
            [
                ['Amount', 'Due'],
                ['1.234,5', '31.12.2026']
            ],
            { locale: 'de-DE', canCreate: true }
        );
        expect(csv.items[0].errors).toEqual([]);
        const withName = plan(
            [
                ['Name', 'Amount', 'Due'],
                ['A', '1.234,5', '31.12.2026']
            ],
            { locale: 'de-DE' }
        );
        expect(withName.items[0].values).toEqual({ Name: 'A', Amount__c: 1234.5, Due__c: '2026-12-31' });
        const excel = plan(
            [
                [
                    { t: 's', v: 'Name' },
                    { t: 's', v: 'Amount' },
                    { t: 's', v: 'Due' },
                    { t: 's', v: 'Done' }
                ],
                [
                    { t: 's', v: 'B' },
                    { t: 'n', v: '1234.5' },
                    { t: 'd', v: '2026-12-31' },
                    { t: 'b', v: 'true' }
                ]
            ],
            { locale: 'de-DE' }
        );
        expect(excel.items[0].values).toEqual({ Name: 'B', Amount__c: 1234.5, Due__c: '2026-12-31', Done__c: true });
    });

    it('holds back a row with anything wrong, and says what, by line', () => {
        const p = plan(
            [
                ['', ''],
                ['Id', 'Name', 'Amount', 'Stage'],
                [ID1, 'ok', '1', 'Beta'],
                ['not-an-id', 'x', '', ''],
                ['003000000000001AAA', 'x', '', ''],
                [ID1.slice(0, 15), 'twice', '', ''],
                [ID2, '', 'lots', 'Delta'],
                ['', '', '', ''],
                ['', 'no create', '', '']
            ],
            { canCreate: false }
        );
        expect(p.counts).toEqual({ update: 1, create: 0, match: 0, error: 5 });
        const errors = line => p.items.find(i => i.line === line).errors.map(e => e.message);
        expect(errors(4)).toEqual(['Not a record Id: not-an-id']);
        expect(errors(5)).toEqual(["003000000000001AAA is not a record of this grid's object."]);
        expect(errors(6)).toEqual(['This record is also on line 3.']);
        expect(errors(7)).toEqual([
            `Name: ${REQUIRED_MESSAGE}`,
            'Amount: Not a number: lots',
            'Stage: Not a value of this picklist: Delta'
        ]);
        expect(errors(9)).toEqual(['This row has no record Id, and you cannot create records here.']);
        expect(p.items.map(i => i.line)).toEqual([3, 4, 5, 6, 7, 9]); // the blank line 8 is skipped
        expect(payloadFor(p.items)).toHaveLength(1);
    });

    it('checks a dependent picklist against the controlling value in the file, else the loaded record', () => {
        // No Region column: each record keeps the Region it has.
        const kept = plan([
            ['Id', 'City'],
            [ID1, 'Oslo'], // ID1 is North: fine
            [ID2, 'Oslo'] // ID2 is South
        ]);
        expect(kept.items[0].errors).toEqual([]);
        expect(kept.items[1].errors.map(e => e.message)).toEqual(['City: Oslo is not offered when Region is South.']);
        // A Region column: its value counts, and an empty cell clears Region.
        const given = plan([
            ['Id', 'Region', 'City'],
            [ID2, 'North', 'Oslo'],
            [ID1, '', 'Oslo'],
            ['', 'South', 'Oslo']
        ]);
        expect(given.items[0].errors).toEqual([]);
        expect(given.items[1].errors.map(e => e.message)).toEqual(['City: Oslo is not offered when Region is blank.']);
        expect(given.items[2].errors.map(e => e.message)).toEqual(['City: Oslo is not offered when Region is South.']);
    });

    it('brings the grid’s own export back unchanged, formula-looking text included', () => {
        const rows = [
            {
                Id: ID1,
                Name: '=1+1',
                Amount__c: '-12.5',
                Due__c: '2026-02-03',
                Done__c: true,
                Stage__c: 'Gamma',
                Account__c: ACCOUNT
            }
        ];
        const csv = toCsv(rows, [{ field: 'Id', label: 'Id', type: 'id' }, ...COLUMNS.slice(0, 6)]);
        const p = plan(parseCsv(csv));
        expect(p.items[0].values).toEqual({
            Name: '=1+1',
            Amount__c: -12.5,
            Due__c: '2026-02-03',
            Done__c: true,
            Stage__c: 'Gamma',
            Account__c: ACCOUNT
        });
        expect(p.items[0].id).toBe(ID1);
    });

    it('refuses a file it cannot use, as a whole', () => {
        expect(plan([]).error).toBe('The file is empty.');
        expect(
            plan([
                ['Color', 'Doubled'],
                ['red', '2']
            ]).error
        ).toMatch(/None of the file’s columns/);
        const big = [['Name']];
        for (let i = 0; i <= MAX_IMPORT_ROWS; i++) big.push(['r' + i]);
        expect(plan(big).error).toBe(
            `The file has ${MAX_IMPORT_ROWS + 1} rows; one import takes at most ${MAX_IMPORT_ROWS}.`
        );
    });
});

describe('each problem, for the preview’s table', () => {
    it('names the column, the text in the file and the problem alone', () => {
        const p = plan([
            ['Id', 'Name', 'Amount', 'Region', 'City'],
            ['not-an-id', 'One', '5', '', ''],
            ['', '', 'lots', 'South', 'Oslo']
        ]);
        const first = p.items[0].errors;
        expect(first).toEqual([
            {
                field: null,
                column: 'Id',
                raw: 'not-an-id',
                problem: 'Not a record Id.',
                message: 'Not a record Id: not-an-id'
            }
        ]);
        const second = p.items[1].errors.map(e => [e.field, e.column, e.raw, e.problem]);
        expect(second).toEqual([
            ['Name', 'Name', '', REQUIRED_MESSAGE],
            ['Amount__c', 'Amount', 'lots', expect.any(String)],
            ['City__c', 'City', 'Oslo', 'Not offered when Region is South.']
        ]);
        // The sentence form is unchanged, for lists and the server's messages.
        expect(p.items[1].errors[0].message).toBe(`Name: ${REQUIRED_MESSAGE}`);
    });
});

describe('hand mappings and matching by an External Id', () => {
    const KEYED = COLUMNS.concat([{ field: 'Key__c', label: 'Key', type: 'text', editable: true, externalId: true }]);

    it('maps a file column the user chose, leaves one out, and keeps the rest automatic', () => {
        const m = mapHeaders(['Price', 'Name', 'Record'], COLUMNS, { 0: 'Amount__c', 1: MAP_SKIP, 2: MAP_ID });
        expect(m.idIndex).toBe(2);
        expect(m.fields.map(f => [f.index, f.column.field])).toEqual([[0, 'Amount__c']]);
        expect(m.ignored).toEqual([{ index: 1, header: 'Name', reason: 'You chose not to import it.' }]);
        expect(mappedTo(m, 0)).toBe('Amount__c');
        expect(mappedTo(m, 1)).toBe(MAP_SKIP);
        expect(mappedTo(m, 2)).toBe(MAP_ID);
    });

    it('gives a hand mapping the column before a header that would have matched it', () => {
        const m = mapHeaders(['Amount', 'Price'], COLUMNS, { 1: 'Amount__c' });
        expect(m.fields.map(f => [f.index, f.column.field])).toEqual([[1, 'Amount__c']]);
        expect(m.ignored).toEqual([{ index: 0, header: 'Amount', reason: 'Amount is already in another column.' }]);
    });

    it('offers to leave a column out, the record Id, or any editable column', () => {
        expect(
            mappingChoices(COLUMNS)
                .slice(0, 3)
                .map(c => c.value)
        ).toEqual([MAP_SKIP, MAP_ID, 'Name']);
        expect(mappingChoices(COLUMNS).map(c => c.value)).not.toContain('Doubled__c');
    });

    it('plans each keyed row as update-or-create, and refuses a key twice in the file', () => {
        const p = plan(
            [
                ['Key', 'Amount'],
                ['K-1', '5'],
                ['k-1', '6'],
                ['', '7']
            ],
            { columns: KEYED, matchField: 'Key__c' }
        );
        expect(p.matchField).toBe('Key__c');
        expect(p.items.map(i => i.action)).toEqual(['match', 'match', 'create']);
        expect(p.items[1].errors[0].message).toBe('k-1 is also on line 2.');
        expect(p.counts).toEqual({ update: 0, create: 1, match: 1, error: 1 });
        expect(payloadFor(p.items)).toEqual([
            { Key__c: 'K-1', Amount__c: 5 },
            { Key__c: null, Amount__c: 7 }
        ]); // a blank key is written blank on the new record
    });

    it('ignores the record Id while matching by a key', () => {
        const p = plan(
            [
                ['Id', 'Key'],
                [ID1, 'K-1']
            ],
            { columns: KEYED, matchField: 'Key__c' }
        );
        expect(p.items[0]).toMatchObject({ id: null, action: 'match', errors: [] });
    });

    it('matches by the record Id when the key column is not in the file, or is not an External Id', () => {
        expect(
            plan(
                [
                    ['Id', 'Name'],
                    [ID1, 'One']
                ],
                { columns: KEYED, matchField: 'Key__c' }
            ).matchField
        ).toBeNull();
        expect(
            plan(
                [
                    ['Id', 'Name'],
                    [ID1, 'One']
                ],
                { matchField: 'Name' }
            ).matchField
        ).toBeNull();
    });

    it('refuses a row with no key when the user cannot create records', () => {
        const p = plan(
            [
                ['Key', 'Amount'],
                ['', '7']
            ],
            { columns: KEYED, matchField: 'Key__c', canCreate: false }
        );
        expect(p.items[0].errors[0].message).toBe(
            'This row has nothing to match by, and you cannot create records here.'
        );
    });
});
