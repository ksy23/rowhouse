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
    MAP_SKIP,
    hundredTimes
} from 'c/gridImport';
import { toCsv } from 'c/gridCsv';

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, required: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, scale: 2 },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', editable: true },
    { field: 'Delivered__c', label: 'Delivered', type: 'checkbox', editable: true },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'STD', label: 'Standard' },
            { value: 'Express', label: 'Express' }
        ]
    },
    { field: 'Account__c', label: 'Account', type: 'reference', editable: true },
    { field: 'Pallet_Positions__c', label: 'Pallet Positions', type: 'number', editable: false },
    {
        field: 'Mode__c',
        label: 'Mode',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'Truckload', label: 'Truckload' },
            { value: 'LTL', label: 'LTL' }
        ]
    },
    {
        field: 'Equipment__c',
        label: 'Equipment',
        type: 'picklist',
        editable: true,
        dependentOn: 'Mode__c',
        options: [
            { value: 'Reefer', label: 'Reefer', validFor: ['Truckload'] },
            { value: 'Crate', label: 'Crate', validFor: ['LTL'] }
        ]
    }
];
const ID1 = 'a00000000000001AAA';
const ID2 = 'a00000000000002AAA';
const LOADED = [
    { Id: ID1, Name: 'Kennebec Lumber, 12 bundles', Mode__c: 'Truckload' },
    { Id: ID2, Name: 'Saco River Outfitters, 3 crates', Mode__c: 'LTL' }
];
const ACCOUNT = '001000000000009AAA';
const plan = (table, options = {}) =>
    planImport(table, {
        columns: COLUMNS,
        rows: LOADED,
        refNames: { [ACCOUNT]: 'Casco Bay Marine' },
        canCreate: true,
        locale: 'en-US',
        ...options
    });

describe('parseCsv', () => {
    it('reads quoted fields with separators, doubled quotes and line breaks, and any line ending', () => {
        const text =
            'Consignee,Delivery Notes\r\n"Pelletier, Hannah","Driver said ""call ahead"""\n"Rear dock\nring bell",Liftgate\rCasco Bay Marine,\n';
        expect(parseCsv(text)).toEqual([
            ['Consignee', 'Delivery Notes'],
            ['Pelletier, Hannah', 'Driver said "call ahead"'],
            ['Rear dock\nring bell', 'Liftgate'],
            ['Casco Bay Marine', '']
        ]);
    });

    it('drops a byte order mark and finds the separator Excel used', () => {
        expect(parseCsv(String.fromCharCode(0xfeff) + 'Weight;Pieces\n1,5;2')).toEqual([
            ['Weight', 'Pieces'],
            ['1,5', '2']
        ]);
        expect(detectDelimiter('Name\tPieces\tWeight\n1,2')).toBe('\t');
        expect(detectDelimiter('"Fragile;Liftgate",Bangor,Express')).toBe(',');
        expect(parseCsv('')).toEqual([]);
    });
});

describe('mapHeaders', () => {
    it('matches labels and API names in any case, finds the Id, and says why a column is ignored', () => {
        const m = mapHeaders(
            [
                'Record ID',
                'name',
                'FREIGHT_CHARGE__C',
                'Pallet Positions',
                'Trailer Number',
                'Freight Charge',
                'Id',
                ''
            ],
            COLUMNS
        );
        expect(m.idIndex).toBe(0);
        expect(m.fields.map(f => [f.index, f.column.field])).toEqual([
            [1, 'Name'],
            [2, 'Freight_Charge__c']
        ]);
        expect(m.ignored).toEqual([
            { index: 3, header: 'Pallet Positions', reason: 'Pallet Positions is read-only here.' },
            { index: 4, header: 'Trailer Number', reason: 'Not a column of this grid.' },
            { index: 5, header: 'Freight Charge', reason: 'Freight Charge is already in another column.' },
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
        expect(mapHeaders(['Freight Charge ID'], COLUMNS).ignored).toEqual([
            { index: 0, header: 'Freight Charge ID', reason: 'Not a column of this grid.' }
        ]);
        const both = [...COLUMNS, { field: 'Account_ID__c', label: 'Account ID', type: 'text', editable: true }];
        expect(mapHeaders(['Account ID'], both).fields.map(f => f.column.field)).toEqual(['Account_ID__c']);
    });
});

describe('planImport', () => {
    it('updates rows with an Id and creates rows without, reading each value by its type', () => {
        const p = plan([
            ['Id', 'Name', 'Freight Charge', 'Ship Date', 'Delivered', 'Service Level', 'Account'],
            [ID1, 'Kennebec Lumber, 14 bundles', '$1,234.567', '12/31/2026', 'yes', 'Standard', 'Casco Bay Marine'],
            ['', 'Wachusett Paper, 6 pallets', '(5)', '2026-01-02', '', 'express', ACCOUNT]
        ]);
        expect(p.error).toBeNull();
        expect(p.counts).toEqual({ update: 1, create: 1, match: 0, error: 0 });
        expect(p.items[0]).toEqual({
            line: 2,
            id: ID1,
            action: 'update',
            errors: [],
            values: {
                Name: 'Kennebec Lumber, 14 bundles',
                Freight_Charge__c: 1234.57,
                Ship_Date__c: '2026-12-31',
                Delivered__c: true,
                Service_Level__c: 'STD',
                Account__c: ACCOUNT
            }
        });
        expect(p.items[1].action).toBe('create');
        expect(p.items[1].values).toEqual({
            Name: 'Wachusett Paper, 6 pallets',
            Freight_Charge__c: -5,
            Ship_Date__c: '2026-01-02',
            Delivered__c: false,
            Service_Level__c: 'Express',
            Account__c: ACCOUNT
        });
        expect(payloadFor(p.items)).toEqual([{ Id: ID1, ...p.items[0].values }, { ...p.items[1].values }]);
    });

    it('reads CSV numbers and dates in the user’s locale, and Excel’s typed cells in its own', () => {
        // A required column the file leaves out is left to the platform, which
        // fills some on a new record (Owner) and refuses the rest.
        const csv = plan(
            [
                ['Freight Charge', 'Ship Date'],
                ['1.234,5', '31.12.2026']
            ],
            { locale: 'de-DE', canCreate: true }
        );
        expect(csv.items[0].errors).toEqual([]);
        const withName = plan(
            [
                ['Name', 'Freight Charge', 'Ship Date'],
                ['Merrimack Valley Foods, 4 pallets', '1.234,5', '31.12.2026']
            ],
            { locale: 'de-DE' }
        );
        expect(withName.items[0].values).toEqual({
            Name: 'Merrimack Valley Foods, 4 pallets',
            Freight_Charge__c: 1234.5,
            Ship_Date__c: '2026-12-31'
        });
        const excel = plan(
            [
                [
                    { t: 's', v: 'Name' },
                    { t: 's', v: 'Freight Charge' },
                    { t: 's', v: 'Ship Date' },
                    { t: 's', v: 'Delivered' }
                ],
                [
                    { t: 's', v: 'Green Mountain Maple, 20 cases' },
                    { t: 'n', v: '1234.5' },
                    { t: 'd', v: '2026-12-31' },
                    { t: 'b', v: 'true' }
                ]
            ],
            { locale: 'de-DE' }
        );
        expect(excel.items[0].values).toEqual({
            Name: 'Green Mountain Maple, 20 cases',
            Freight_Charge__c: 1234.5,
            Ship_Date__c: '2026-12-31',
            Delivered__c: true
        });
    });

    it('reads a number Excel shows as a percent into a percent field as Salesforce keeps it: 12.5% is 12.5', () => {
        const columns = [
            ...COLUMNS,
            { field: 'Discount__c', label: 'Discount', type: 'percent', editable: true, scale: 1 },
            { field: 'Rate__c', label: 'Rate', type: 'number', editable: true, scale: 3 }
        ];
        const excel = plan(
            [
                [
                    { t: 's', v: 'Id' },
                    { t: 's', v: 'Discount' },
                    { t: 's', v: 'Rate' }
                ],
                [
                    { t: 's', v: ID1 },
                    { t: 'n', v: '0.125', pct: true },
                    { t: 'n', v: '0.125', pct: true }
                ],
                [
                    { t: 's', v: ID2 },
                    { t: 'n', v: '12.5' },
                    { t: 'n', v: '2' }
                ]
            ],
            { columns }
        );
        // A number field keeps the number Excel holds; a percent field what Excel shows.
        expect(excel.items[0].values).toEqual({ Discount__c: 12.5, Rate__c: 0.125 });
        expect(excel.items[1].values).toEqual({ Discount__c: 12.5, Rate__c: 2 });
    });

    it('moves a decimal point two places exactly', () => {
        expect(['0.125', '1', '-0.05', '.5', '0', '12.3456', '-0', 'abc'].map(hundredTimes)).toEqual([
            '12.5',
            '100',
            '-5',
            '50',
            '0',
            '1234.56',
            '0',
            'abc'
        ]);
    });

    it('holds back a row with anything wrong, and says what, by line', () => {
        const p = plan(
            [
                ['', ''],
                ['Id', 'Name', 'Freight Charge', 'Service Level'],
                [ID1, 'Kennebec Lumber, 12 bundles', '1', 'Standard'],
                ['PRO-1004', 'Bangor Brick & Tile, 2 pallets', '', ''],
                ['003000000000001AAA', 'Mill River Energy, 4 drums', '', ''],
                [ID1.slice(0, 15), 'Kennebec Lumber, 12 bundles', '', ''],
                [ID2, '', 'TBD', 'Overnight'],
                ['', '', '', ''],
                ['', 'Quabbin Supply, 1 pallet', '', '']
            ],
            { canCreate: false }
        );
        expect(p.counts).toEqual({ update: 1, create: 0, match: 0, error: 5 });
        const errors = line => p.items.find(i => i.line === line).errors.map(e => e.message);
        expect(errors(4)).toEqual(['Not a record Id: PRO-1004']);
        expect(errors(5)).toEqual(["003000000000001AAA is not a record of this grid's object."]);
        expect(errors(6)).toEqual(['This record is also on line 3.']);
        expect(errors(7)).toEqual([
            `Name: ${REQUIRED_MESSAGE}`,
            'Freight Charge: Not a number: TBD',
            'Service Level: Not a value of this picklist: Overnight'
        ]);
        expect(errors(9)).toEqual(['This row has no record Id, and you cannot create records here.']);
        expect(p.items.map(i => i.line)).toEqual([3, 4, 5, 6, 7, 9]); // the blank line 8 is skipped
        expect(payloadFor(p.items)).toHaveLength(1);
    });

    it('checks a dependent picklist against the controlling value in the file, else the loaded record', () => {
        // No Mode column: each record keeps the Mode it has.
        const kept = plan([
            ['Id', 'Equipment'],
            [ID1, 'Reefer'], // ID1 is Truckload: fine
            [ID2, 'Reefer'] // ID2 is LTL
        ]);
        expect(kept.items[0].errors).toEqual([]);
        expect(kept.items[1].errors.map(e => e.message)).toEqual([
            'Equipment: Reefer is not offered when Mode is LTL.'
        ]);
        // A Mode column: its value counts, and an empty cell clears Mode.
        const given = plan([
            ['Id', 'Mode', 'Equipment'],
            [ID2, 'Truckload', 'Reefer'],
            [ID1, '', 'Reefer'],
            ['', 'LTL', 'Reefer']
        ]);
        expect(given.items[0].errors).toEqual([]);
        expect(given.items[1].errors.map(e => e.message)).toEqual([
            'Equipment: Reefer is not offered when Mode is blank.'
        ]);
        expect(given.items[2].errors.map(e => e.message)).toEqual([
            'Equipment: Reefer is not offered when Mode is LTL.'
        ]);
    });

    it('brings the grid’s own export back unchanged, formula-looking text included', () => {
        const rows = [
            {
                Id: ID1,
                Name: '=SUM(B2:B9)',
                Freight_Charge__c: '-12.5',
                Ship_Date__c: '2026-02-03',
                Delivered__c: true,
                Service_Level__c: 'Express',
                Account__c: ACCOUNT
            }
        ];
        const csv = toCsv(rows, [{ field: 'Id', label: 'Id', type: 'id' }, ...COLUMNS.slice(0, 6)]);
        const p = plan(parseCsv(csv));
        expect(p.items[0].values).toEqual({
            Name: '=SUM(B2:B9)',
            Freight_Charge__c: -12.5,
            Ship_Date__c: '2026-02-03',
            Delivered__c: true,
            Service_Level__c: 'Express',
            Account__c: ACCOUNT
        });
        expect(p.items[0].id).toBe(ID1);
    });

    it('refuses a file it cannot use, as a whole', () => {
        expect(plan([]).error).toBe('The file is empty.');
        expect(
            plan([
                ['Trailer Number', 'Pallet Positions'],
                ['T-4471', '2']
            ]).error
        ).toMatch(/None of the file’s columns/);
        const big = [['Name']];
        for (let i = 0; i <= MAX_IMPORT_ROWS; i++) big.push(['Kennebec Lumber, bundle ' + i]);
        expect(plan(big).error).toBe(
            `The file has ${MAX_IMPORT_ROWS + 1} rows; one import takes at most ${MAX_IMPORT_ROWS}.`
        );
    });
});

describe('each problem, for the preview’s table', () => {
    it('names the column, the text in the file and the problem alone', () => {
        const p = plan([
            ['Id', 'Name', 'Freight Charge', 'Mode', 'Equipment'],
            ['PRO-1004', 'Kennebec Lumber, 12 bundles', '5', '', ''],
            ['', '', 'TBD', 'LTL', 'Reefer']
        ]);
        const first = p.items[0].errors;
        expect(first).toEqual([
            {
                field: null,
                column: 'Id',
                raw: 'PRO-1004',
                problem: 'Not a record Id.',
                message: 'Not a record Id: PRO-1004'
            }
        ]);
        const second = p.items[1].errors.map(e => [e.field, e.column, e.raw, e.problem]);
        expect(second).toEqual([
            ['Name', 'Name', '', REQUIRED_MESSAGE],
            ['Freight_Charge__c', 'Freight Charge', 'TBD', expect.any(String)],
            ['Equipment__c', 'Equipment', 'Reefer', 'Not offered when Mode is LTL.']
        ]);
        // The sentence form is unchanged, for lists and the server's messages.
        expect(p.items[1].errors[0].message).toBe(`Name: ${REQUIRED_MESSAGE}`);
    });
});

describe('hand mappings and matching by an External Id', () => {
    const KEYED = COLUMNS.concat([
        { field: 'Bill_Of_Lading__c', label: 'Bill of Lading', type: 'text', editable: true, externalId: true }
    ]);

    it('maps a file column the user chose, leaves one out, and keeps the rest automatic', () => {
        const m = mapHeaders(['Rate', 'Name', 'Record'], COLUMNS, { 0: 'Freight_Charge__c', 1: MAP_SKIP, 2: MAP_ID });
        expect(m.idIndex).toBe(2);
        expect(m.fields.map(f => [f.index, f.column.field])).toEqual([[0, 'Freight_Charge__c']]);
        expect(m.ignored).toEqual([{ index: 1, header: 'Name', reason: 'You chose not to import it.' }]);
        expect(mappedTo(m, 0)).toBe('Freight_Charge__c');
        expect(mappedTo(m, 1)).toBe(MAP_SKIP);
        expect(mappedTo(m, 2)).toBe(MAP_ID);
    });

    it('gives a hand mapping the column before a header that would have matched it', () => {
        const m = mapHeaders(['Freight Charge', 'Rate'], COLUMNS, { 1: 'Freight_Charge__c' });
        expect(m.fields.map(f => [f.index, f.column.field])).toEqual([[1, 'Freight_Charge__c']]);
        expect(m.ignored).toEqual([
            { index: 0, header: 'Freight Charge', reason: 'Freight Charge is already in another column.' }
        ]);
    });

    it('offers to leave a column out, the record Id, or any editable column', () => {
        expect(
            mappingChoices(COLUMNS)
                .slice(0, 3)
                .map(c => c.value)
        ).toEqual([MAP_SKIP, MAP_ID, 'Name']);
        expect(mappingChoices(COLUMNS).map(c => c.value)).not.toContain('Pallet_Positions__c');
    });

    it('plans each keyed row as update-or-create, and refuses a key twice in the file', () => {
        const p = plan(
            [
                ['Bill of Lading', 'Freight Charge'],
                ['BOL-2207', '5'],
                ['bol-2207', '6'],
                ['', '7']
            ],
            { columns: KEYED, matchField: 'Bill_Of_Lading__c' }
        );
        expect(p.matchField).toBe('Bill_Of_Lading__c');
        expect(p.items.map(i => i.action)).toEqual(['match', 'match', 'create']);
        expect(p.items[1].errors[0].message).toBe('bol-2207 is also on line 2.');
        expect(p.counts).toEqual({ update: 0, create: 1, match: 1, error: 1 });
        expect(payloadFor(p.items)).toEqual([
            { Bill_Of_Lading__c: 'BOL-2207', Freight_Charge__c: 5 },
            { Bill_Of_Lading__c: null, Freight_Charge__c: 7 }
        ]); // a blank key is written blank on the new record
    });

    it('ignores the record Id while matching by a key', () => {
        const p = plan(
            [
                ['Id', 'Bill of Lading'],
                [ID1, 'BOL-2207']
            ],
            { columns: KEYED, matchField: 'Bill_Of_Lading__c' }
        );
        expect(p.items[0]).toMatchObject({ id: null, action: 'match', errors: [] });
    });

    it('matches by the record Id when the key column is not in the file, or is not an External Id', () => {
        expect(
            plan(
                [
                    ['Id', 'Name'],
                    [ID1, 'Kennebec Lumber, 12 bundles']
                ],
                { columns: KEYED, matchField: 'Bill_Of_Lading__c' }
            ).matchField
        ).toBeNull();
        expect(
            plan(
                [
                    ['Id', 'Name'],
                    [ID1, 'Kennebec Lumber, 12 bundles']
                ],
                { matchField: 'Name' }
            ).matchField
        ).toBeNull();
    });

    it('refuses a row with no key when the user cannot create records', () => {
        const p = plan(
            [
                ['Bill of Lading', 'Freight Charge'],
                ['', '7']
            ],
            { columns: KEYED, matchField: 'Bill_Of_Lading__c', canCreate: false }
        );
        expect(p.items[0].errors[0].message).toBe(
            'This row has nothing to match by, and you cannot create records here.'
        );
    });
});
