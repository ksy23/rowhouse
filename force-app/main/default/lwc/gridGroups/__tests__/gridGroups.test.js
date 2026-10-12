/**
 * Grouping in the browser: the keys that must match the server's, the
 * labels, the rows the table renders, and subtotals added up from the
 * server's deepest groups. Jest runs as en-US in America/Los_Angeles.
 */
import {
    normalizeGrouping,
    sameGrouping,
    levelParam,
    keyFor,
    serverKey,
    groupLabel,
    buildView,
    addDecimal,
    rollUp,
    subtotalFor,
    recordsText,
    BLANK_LABEL
} from 'c/gridGroups';

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', groupable: true },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        groupable: true,
        options: [
            { value: 'econ', label: 'Economy' },
            { value: 'Standard', label: 'Standard' }
        ]
    },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', groupable: true, subtotal: 'max' },
    { field: 'Picked_Up__c', label: 'Picked Up', type: 'datetime', groupable: true, subtotal: 'min' },
    { field: 'Delivered__c', label: 'Delivered', type: 'checkbox', groupable: true },
    { field: 'Shipper__c', label: 'Shipper', type: 'reference', groupable: true },
    {
        field: 'Freight_Charge__c',
        label: 'Freight Charge',
        type: 'currency',
        scale: 2,
        groupable: false,
        subtotal: 'sum'
    },
    { field: 'Pieces__c', label: 'Pieces', type: 'number', scale: 0, subtotal: 'average' },
    { field: 'Delivery_Notes__c', label: 'Delivery Notes', type: 'text', subtotal: 'count' }
];
const col = field => COLUMNS.find(c => c.field === field);
const ACC = '001000000000001AAA';

describe('the grouping', () => {
    it('keeps groupable columns once each, at most three, with a unit for dates only', () => {
        expect(
            normalizeGrouping(
                [
                    { field: 'Freight_Charge__c' },
                    { field: 'Ship_Date__c' },
                    { field: 'Service_Level__c', unit: 'day' },
                    { field: 'Ship_Date__c', unit: 'year' },
                    { field: 'Delivered__c' },
                    { field: 'Name' },
                    { field: 'Route__c' }
                ],
                COLUMNS
            )
        ).toEqual([
            { field: 'Ship_Date__c', unit: 'month' },
            { field: 'Service_Level__c', unit: null },
            { field: 'Delivered__c', unit: null }
        ]);
        expect(normalizeGrouping([{ field: 'Picked_Up__c', unit: 'quarter' }], COLUMNS)).toEqual([
            { field: 'Picked_Up__c', unit: 'quarter' }
        ]);
        expect(normalizeGrouping(null, COLUMNS)).toEqual([]);
        expect(levelParam({ field: 'Ship_Date__c', unit: 'quarter' })).toBe('Ship_Date__c:quarter');
        expect(levelParam({ field: 'Service_Level__c', unit: null })).toBe('Service_Level__c');
        expect(sameGrouping([{ field: 'Mode__c', unit: null }], [{ field: 'Mode__c' }])).toBe(true);
        expect(sameGrouping([{ field: 'Ship_Date__c', unit: 'day' }], [{ field: 'Ship_Date__c', unit: 'month' }])).toBe(
            false
        );
    });
});

describe('keys', () => {
    it('match the server: dates by unit, date/times in the user time zone, text without case', () => {
        expect(keyFor('2026-09-28', col('Ship_Date__c'), 'day')).toBe('2026-09-28');
        expect(keyFor('2026-09-28', col('Ship_Date__c'), 'month')).toBe('2026-09');
        expect(keyFor('2026-09-28', col('Ship_Date__c'), 'quarter')).toBe('2026-Q3');
        expect(keyFor('2026-01-01', col('Ship_Date__c'), 'quarter')).toBe('2026-Q1');
        expect(keyFor('2026-12-31', col('Ship_Date__c'), 'year')).toBe('2026');
        // 05:00 GMT on 1 January is still 31 December in Los Angeles.
        expect(keyFor('2026-01-01T05:00:00.000Z', col('Picked_Up__c'), 'day')).toBe('2025-12-31');
        expect(keyFor('2026-01-01T05:00:00.000Z', col('Picked_Up__c'), 'month')).toBe('2025-12');
        expect(keyFor('2026-01-01T12:00:00.000Z', col('Picked_Up__c'), 'month', 'UTC')).toBe('2026-01');
        expect(keyFor(true, col('Delivered__c'))).toBe('true');
        expect(keyFor(null, col('Delivered__c'))).toBe('false');
        expect(keyFor(ACC, col('Shipper__c'))).toBe(ACC);
        expect(keyFor('  Reefer load, Machias ', col('Name'))).toBe('reefer load, machias');
        expect(keyFor('REEFER LOAD, MACHIAS', col('Name'))).toBe('reefer load, machias');
        expect(keyFor(null, col('Name'))).toBe('');
        expect(keyFor('', col('Ship_Date__c'), 'month')).toBe('');
    });

    it('from the server take the same form', () => {
        expect(serverKey('Penobscot Paper, Full Truck', col('Name'))).toBe(
            keyFor('penobscot paper, full truck ', col('Name'))
        );
        expect(serverKey(null, col('Service_Level__c'))).toBe('');
        expect(serverKey('false', col('Delivered__c'))).toBe('false');
        expect(serverKey('2026-Q3', col('Ship_Date__c'))).toBe('2026-Q3');
        expect(serverKey(ACC, col('Shipper__c'))).toBe(ACC); // an Id keeps its case: it is part of the Id
    });
});

describe('labels', () => {
    it('name each group as a person reads it', () => {
        expect(groupLabel('2026-09', col('Ship_Date__c'), 'month')).toBe('September 2026');
        expect(groupLabel('2026-Q3', col('Ship_Date__c'), 'quarter')).toBe('Q3 2026');
        expect(groupLabel('2026', col('Ship_Date__c'), 'year')).toBe('2026');
        expect(groupLabel('2026-09-28', col('Ship_Date__c'), 'day')).toBe('9/28/2026');
        expect(groupLabel('', col('Ship_Date__c'), 'month')).toBe(BLANK_LABEL);
        expect(groupLabel('true', col('Delivered__c'))).toBe('Checked');
        expect(groupLabel('false', col('Delivered__c'))).toBe('Not checked');
        expect(groupLabel('econ', col('Service_Level__c'), null, { sample: 'econ' })).toBe('Economy');
        expect(groupLabel('white glove', col('Service_Level__c'), null, {})).toBe('white glove');
        expect(groupLabel(ACC, col('Shipper__c'), null, { names: { [ACC]: 'Casco Bay Marine' } })).toBe(
            'Casco Bay Marine'
        );
        expect(groupLabel(ACC, col('Shipper__c'), null, { serverLabel: 'Casco Bay Marine Inc.' })).toBe(
            'Casco Bay Marine Inc.'
        );
        expect(groupLabel('reefer load, machias', col('Name'), null, { sample: 'Reefer load, Machias ' })).toBe(
            'Reefer load, Machias'
        );
        expect(recordsText(1)).toBe('1 record');
        expect(recordsText(1234)).toBe('1,234 records');
    });
});

describe('row numbers', () => {
    const rows = [
        { Id: 'r1', Service_Level__c: 'Standard' },
        { Id: 'r2', Service_Level__c: 'econ' },
        { Id: 'r3', Service_Level__c: 'Standard' },
        { Id: 'r4', Service_Level__c: null }
    ];
    const byStage = [{ field: 'Service_Level__c', unit: null }];

    it('numbers ungrouped rows by their place, only when asked', () => {
        expect(buildView(rows, [], { columns: COLUMNS }).numbers).toBeNull();
        const { numbers } = buildView(rows, [], { columns: COLUMNS, numbered: true });
        expect([...numbers.entries()]).toEqual([
            ['r1', 1],
            ['r2', 2],
            ['r3', 3],
            ['r4', 4]
        ]);
    });

    it('numbers straight through the groups, in the order shown', () => {
        expect(buildView(rows, byStage, { columns: COLUMNS }).numbers).toBeNull();
        const { items, numbers } = buildView(rows, byStage, { columns: COLUMNS, numbered: true });
        const shown = items.filter(i => !i.__group).map(i => i.Id);
        expect(shown).toEqual(['r2', 'r1', 'r3', 'r4']);
        expect(shown.map(id => numbers.get(id))).toEqual([1, 2, 3, 4]);
    });

    it('keeps the numbers of a collapsed group, and of the rows after it', () => {
        const open = buildView(rows, byStage, { columns: COLUMNS, numbered: true });
        const alpha = open.items.find(i => i.__group && i.__group.label === 'Economy').Id;
        const { items, numbers } = buildView(rows, byStage, {
            columns: COLUMNS,
            numbered: true,
            collapsed: { [alpha]: true }
        });
        expect(items.filter(i => !i.__group).map(i => i.Id)).toEqual(['r1', 'r3', 'r4']);
        expect(numbers).toEqual(open.numbers);
        expect(numbers.get('r1')).toBe(2);
    });
});

describe('the view', () => {
    const rows = [
        { Id: 'r1', Service_Level__c: 'Standard', Ship_Date__c: '2026-01-05' },
        { Id: 'r2', Service_Level__c: 'econ', Ship_Date__c: '2026-02-01' },
        { Id: 'r3', Service_Level__c: 'Standard', Ship_Date__c: '2026-07-09' },
        { Id: 'r4', Service_Level__c: 'ECON', Ship_Date__c: null },
        { Id: 'r5', Service_Level__c: null, Ship_Date__c: '2026-03-03' }
    ];
    const levels = [
        { field: 'Service_Level__c', unit: null },
        { field: 'Ship_Date__c', unit: 'quarter' }
    ];
    const shape = items =>
        items.map(i => (i.__group ? `${'  '.repeat(i.__group.level - 1)}[${i.__group.label}]` : i.Id));

    it('gathers rows under their groups, never splitting one, and puts the groups in order, blank last', () => {
        const { items, headers } = buildView(rows, levels, { columns: COLUMNS });
        expect(shape(items)).toEqual([
            '[Economy]',
            '  [Q1 2026]',
            'r2',
            `  [${BLANK_LABEL}]`,
            'r4',
            '[Standard]',
            '  [Q1 2026]',
            'r1',
            '  [Q3 2026]',
            'r3',
            `[${BLANK_LABEL}]`,
            '  [Q1 2026]',
            'r5'
        ]);
        const beta = items[5].__group;
        expect(beta).toMatchObject({
            level: 1,
            key: 'standard',
            field: 'Service_Level__c',
            columnLabel: 'Service Level',
            loaded: 2,
            count: null,
            expanded: true,
            parentId: null
        });
        expect(items[5].Id).toBe(beta.id);
        expect(headers.get(items[6].Id).parentId).toBe(beta.id);
        expect(items[5].Id).toMatch(/^__g1_/);
        // The same group gets the same id every time.
        expect(buildView(rows.slice().reverse(), levels, { columns: COLUMNS }).headers.has(beta.id)).toBe(true);
    });

    it('hides a collapsed group, and takes counts and subtotals from the server by path', () => {
        const first = buildView(rows, levels, { columns: COLUMNS });
        const betaId = first.items.find(i => i.__group && i.__group.label === 'Standard').Id;
        const totals = rollUp(
            [
                { k: ['Standard', '2026-Q1'], n: 4, v: { Freight_Charge__c: { s: '10.5' } } },
                { k: ['Standard', '2026-Q3'], n: 1, v: { Freight_Charge__c: { s: '1' } } }
            ],
            levels,
            COLUMNS
        );
        const { items, headers } = buildView(rows, levels, { columns: COLUMNS, collapsed: { [betaId]: true }, totals });
        expect(shape(items)).toEqual([
            '[Economy]',
            '  [Q1 2026]',
            'r2',
            `  [${BLANK_LABEL}]`,
            'r4',
            '[Standard]',
            `[${BLANK_LABEL}]`,
            '  [Q1 2026]',
            'r5'
        ]);
        const beta = headers.get(betaId);
        expect(beta.expanded).toBe(false);
        expect(beta.count).toBe(5);
        expect(beta.values.Freight_Charge__c.s).toBe('11.5');
        expect(beta.loaded).toBe(2);
        // A collapsed group's sub-groups are not built at all.
        expect([...headers.values()].filter(h => h.parentId === betaId)).toEqual([]);
        expect(headers.size).toBe(6);
    });

    it('is the rows themselves when there is no grouping', () => {
        expect(buildView(rows, [], { columns: COLUMNS }).items).toBe(rows);
    });

    it('keeps the user order within a group, whatever it is (a date by year is not sorted by its day)', () => {
        const byYear = [{ field: 'Ship_Date__c', unit: 'year' }];
        const named = [
            { Id: 'a', Ship_Date__c: '2026-12-31' },
            { Id: 'b', Ship_Date__c: '2026-01-01' },
            { Id: 'c', Ship_Date__c: '2025-06-01' },
            { Id: 'd', Ship_Date__c: '2026-06-15' }
        ];
        expect(shape(buildView(named, byYear, { columns: COLUMNS }).items)).toEqual([
            '[2025]',
            'c',
            '[2026]',
            'a',
            'b',
            'd'
        ]);
    });

    it('orders the groups in the direction the user sorted that column, blank still last', () => {
        const byStage = [{ field: 'Service_Level__c', unit: null }];
        const { items } = buildView(rows, byStage, {
            columns: COLUMNS,
            sortKeys: [{ field: 'Service_Level__c', direction: 'desc' }]
        });
        expect(shape(items)).toEqual(['[Standard]', 'r1', 'r3', '[Economy]', 'r2', 'r4', `[${BLANK_LABEL}]`, 'r5']);
    });

    it('orders picklist groups as the field lists its values, as a Salesforce report does', () => {
        const stage = {
            field: 'StageName',
            label: 'Stage',
            type: 'picklist',
            groupable: true,
            options: [
                { value: 'Prospecting', label: 'Prospecting' },
                { value: 'Qualification', label: 'Qualification' },
                { value: 'Negotiation/Review', label: 'Negotiation/Review' },
                { value: 'Closed Won', label: 'Closed Won' }
            ]
        };
        const byStage = [{ field: 'StageName', unit: null }];
        const deals = [
            { Id: 'w', StageName: 'Closed Won' },
            { Id: 'n', StageName: null },
            { Id: 'r', StageName: 'Negotiation/Review' },
            { Id: 'o', StageName: 'Perception Analysis' }, // stored, no longer in the list
            { Id: 'p', StageName: 'Prospecting' },
            { Id: 'a', StageName: 'Archived' }, // stored, no longer in the list
            { Id: 'q', StageName: 'qualification' }
        ];
        expect(shape(buildView(deals, byStage, { columns: [stage] }).items)).toEqual([
            '[Prospecting]',
            'p',
            '[Qualification]',
            'q',
            '[Negotiation/Review]',
            'r',
            '[Closed Won]',
            'w',
            '[Archived]',
            'a',
            '[Perception Analysis]',
            'o',
            `[${BLANK_LABEL}]`,
            'n'
        ]);
        // Sorted descending, the order reverses; blank stays last.
        expect(
            shape(
                buildView(deals, byStage, { columns: [stage], sortKeys: [{ field: 'StageName', direction: 'desc' }] })
                    .items
            )
        ).toEqual([
            '[Perception Analysis]',
            'o',
            '[Archived]',
            'a',
            '[Closed Won]',
            'w',
            '[Negotiation/Review]',
            'r',
            '[Qualification]',
            'q',
            '[Prospecting]',
            'p',
            `[${BLANK_LABEL}]`,
            'n'
        ]);
        // As an inner level too.
        const byDoneThenStage = [
            { field: 'Delivered__c', unit: null },
            { field: 'StageName', unit: null }
        ];
        const mixed = [
            { Id: 'x1', Delivered__c: false, StageName: 'Closed Won' },
            { Id: 'x2', Delivered__c: false, StageName: 'Prospecting' }
        ];
        expect(shape(buildView(mixed, byDoneThenStage, { columns: [stage, col('Delivered__c')] }).items)).toEqual([
            '[Not checked]',
            '  [Prospecting]',
            'x2',
            '  [Closed Won]',
            'x1'
        ]);
    });

    it('orders number groups by size, not as text', () => {
        const level = { field: 'Weight__c', label: 'Weight', type: 'number', scale: 0, groupable: true };
        const buildings = [
            { Id: 'b10', Weight__c: 10 },
            { Id: 'b9', Weight__c: 9 },
            { Id: 'b100', Weight__c: 100 }
        ];
        expect(shape(buildView(buildings, [{ field: 'Weight__c', unit: null }], { columns: [level] }).items)).toEqual([
            '[9]',
            'b9',
            '[10]',
            'b10',
            '[100]',
            'b100'
        ]);
    });

    it('orders lookup groups by the record name, and checkboxes unchecked first', () => {
        const ACC2 = '001000000000002AAA';
        const byAccount = [{ field: 'Shipper__c', unit: null }];
        const accounts = [
            { Id: 'x', Shipper__c: ACC },
            { Id: 'y', Shipper__c: ACC2 },
            { Id: 'z', Shipper__c: null }
        ];
        const names = { [ACC]: 'Casco Bay Marine', [ACC2]: 'Bangor Brick & Tile' };
        expect(shape(buildView(accounts, byAccount, { columns: COLUMNS, names }).items)).toEqual([
            '[Bangor Brick & Tile]',
            'y',
            '[Casco Bay Marine]',
            'x',
            `[${BLANK_LABEL}]`,
            'z'
        ]);
        const done = [
            { Id: 'p', Delivered__c: true },
            { Id: 'q', Delivered__c: false }
        ];
        expect(shape(buildView(done, [{ field: 'Delivered__c', unit: null }], { columns: COLUMNS }).items)).toEqual([
            '[Not checked]',
            'q',
            '[Checked]',
            'p'
        ]);
    });
});

describe('subtotals', () => {
    it('add decimals exactly, whatever their size', () => {
        expect(addDecimal('0.1', '0.2')).toBe('0.3');
        expect(addDecimal('999999999999999999', '1')).toBe('1000000000000000000');
        expect(addDecimal('-1.5', '1')).toBe('-0.5');
        expect(addDecimal('-0.25', '0.05')).toBe('-0.20');
        expect(addDecimal(null, '7')).toBe('7');
        expect(addDecimal(null, null)).toBe(null);
    });

    it('add decimals of mixed signs and places, with no negative zero', () => {
        expect(addDecimal('-1', '1')).toBe('0');
        expect(addDecimal('-0.50', '0.5')).toBe('0.00');
        expect(addDecimal('-0.00', '0')).toBe('0.00');
        expect(addDecimal('1', '-1.005')).toBe('-0.005');
        expect(addDecimal('-12.3', '-0.07')).toBe('-12.37');
        expect(addDecimal('+5', '0.25')).toBe('5.25');
        expect(addDecimal('100', '-99.99')).toBe('0.01');
        expect(addDecimal('0001.10', '2')).toBe('3.10');
        expect(addDecimal('-123456789012345678901234567890.12', '123456789012345678901234567890.13')).toBe('0.01');
    });

    it('add decimals the same as exact integer arithmetic (checked against BigInt, which Locker lacks)', () => {
        // A fixed pseudo-random sequence, so a failure can be reproduced.
        let seed = 12345;
        const next = n => {
            seed = (seed * 48271) % 2147483647;
            return seed % n;
        };
        const decimal = () => {
            const whole = String(next(10 ** next(9)));
            const places = next(4);
            const frac = places ? '.' + String(next(10 ** places)).padStart(places, '0') : '';
            return (next(2) ? '-' : '') + whole + frac;
        };
        const exact = (a, b) => {
            const scale = Math.max(...[a, b].map(s => (s.includes('.') ? s.split('.')[1].length : 0)));
            const big = s => {
                const [w, f = ''] = s.replace('-', '').split('.');
                const n = BigInt(w + f.padEnd(scale, '0'));
                return s.startsWith('-') ? -n : n;
            };
            const sum = big(a) + big(b);
            let text = (sum < 0 ? -sum : sum).toString().padStart(scale + 1, '0');
            if (scale) text = text.slice(0, -scale) + '.' + text.slice(-scale);
            return (sum < 0 ? '-' : '') + text;
        };
        for (let i = 0; i < 2000; i++) {
            const a = decimal();
            const b = decimal();
            expect(addDecimal(a, b)).toBe(exact(a, b));
        }
    });

    it('do not use BigInt, which Lightning Locker does not provide', () => {
        const saved = global.BigInt;
        try {
            delete global.BigInt;
            expect(addDecimal('999999999999999999.99', '0.01')).toBe('1000000000000000000.00');
            expect(addDecimal('-2', '1.5')).toBe('-0.5');
        } finally {
            global.BigInt = saved;
        }
    });

    it('roll the deepest groups up into every level and the Total, slices merging', () => {
        const levels = [
            { field: 'Service_Level__c', unit: null },
            { field: 'Shipper__c', unit: null }
        ];
        const slices = [
            [
                {
                    k: ['Standard', ACC],
                    l: [null, 'Casco Bay Marine'],
                    n: 2,
                    v: {
                        Freight_Charge__c: { s: '5.25' },
                        Ship_Date__c: { mx: '2026-03-01' },
                        Picked_Up__c: { mn: '2026-01-02T10:00:00.000Z' },
                        Pieces__c: { s: '3', c: 2 },
                        Delivery_Notes__c: { c: 1 }
                    }
                }
            ],
            [
                {
                    k: ['STANDARD', ACC],
                    l: [null, 'Casco Bay Marine'],
                    n: 1,
                    v: {
                        Freight_Charge__c: { s: '4.75' },
                        Ship_Date__c: { mx: '2026-12-31' },
                        Picked_Up__c: { mn: '2025-06-01T00:00:00.000Z' },
                        Pieces__c: { s: '4', c: 1 },
                        Delivery_Notes__c: { c: 1 }
                    }
                },
                // As Lightning delivers it: a blank key is '', and null values are simply missing.
                {
                    k: ['', ''],
                    l: ['', ''],
                    n: 3,
                    v: {
                        Freight_Charge__c: {},
                        Ship_Date__c: {},
                        Picked_Up__c: {},
                        Pieces__c: { c: 0 },
                        Delivery_Notes__c: { c: 0 }
                    }
                }
            ]
        ];
        const { byPath, total } = rollUp(slices.flat(), levels, COLUMNS);
        const beta = byPath.get('standard');
        expect(beta.count).toBe(3);
        expect(beta.values.Freight_Charge__c.s).toBe('10.00');
        expect(beta.values.Ship_Date__c.mx).toBe('2026-12-31');
        expect(beta.values.Picked_Up__c.mn).toBe('2025-06-01T00:00:00.000Z');
        const acme = byPath.get('standard' + String.fromCharCode(31) + ACC);
        expect(acme.label).toBe('Casco Bay Marine');
        expect(acme.count).toBe(3);
        expect(byPath.get('').count).toBe(3);
        expect(total.count).toBe(6);
        expect(total.values.Freight_Charge__c.s).toBe('10.00');
        expect(total.values.Pieces__c).toMatchObject({ s: '7', c: 3 });
        // As the column shows them.
        expect(subtotalFor(total, col('Freight_Charge__c'))).toEqual({ kind: 'sum', value: '10.00', text: '$10.00' });
        expect(subtotalFor(total, col('Pieces__c')).text).toBe('2.33'); // an average keeps two places
        expect(subtotalFor(total, col('Ship_Date__c')).text).toBe('12/31/2026');
        expect(subtotalFor(total, col('Delivery_Notes__c'))).toEqual({ kind: 'count', value: 2, text: '2' });
        expect(subtotalFor(byPath.get(''), col('Pieces__c')).text).toBe(''); // no values, no average
        expect(subtotalFor(total, col('Name'))).toBeNull(); // no subtotal on this column
    });

    it('never files a group without one key per level under another group; it counts in the Total only', () => {
        // Lightning drops null list elements: [null, "2026-Q1"] would arrive as ["2026-Q1"].
        const levels = [
            { field: 'Service_Level__c', unit: null },
            { field: 'Ship_Date__c', unit: 'quarter' }
        ];
        const { byPath, total } = rollUp(
            [
                { k: ['2026-Q1'], n: 4, v: { Freight_Charge__c: { s: '4' } } },
                { k: ['Standard', '2026-Q1'], n: 1, v: { Freight_Charge__c: { s: '1' } } }
            ],
            levels,
            COLUMNS
        );
        expect(byPath.has('2026-q1')).toBe(false);
        expect([...byPath.keys()]).toEqual(['standard', 'standard' + String.fromCharCode(31) + '2026-Q1']);
        expect(total.count).toBe(5);
        expect(total.values.Freight_Charge__c.s).toBe('5');
    });
});
