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
    { field: 'Stage__c', label: 'Stage', type: 'picklist', groupable: true, options: [{ value: 'alpha_api', label: 'Alpha' }, { value: 'Beta', label: 'Beta' }] },
    { field: 'Due__c', label: 'Due', type: 'date', groupable: true, subtotal: 'max' },
    { field: 'When__c', label: 'When', type: 'datetime', groupable: true, subtotal: 'min' },
    { field: 'Done__c', label: 'Done', type: 'checkbox', groupable: true },
    { field: 'Account__c', label: 'Account', type: 'reference', groupable: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, groupable: false, subtotal: 'sum' },
    { field: 'Qty__c', label: 'Qty', type: 'number', scale: 0, subtotal: 'average' },
    { field: 'Note__c', label: 'Note', type: 'text', subtotal: 'count' }
];
const col = field => COLUMNS.find(c => c.field === field);
const ACC = '001000000000001AAA';

describe('the grouping', () => {
    it('keeps groupable columns once each, at most three, with a unit for dates only', () => {
        expect(normalizeGrouping([
            { field: 'Amount__c' }, { field: 'Due__c' }, { field: 'Stage__c', unit: 'day' }, { field: 'Due__c', unit: 'year' },
            { field: 'Done__c' }, { field: 'Name' }, { field: 'Nope__c' }
        ], COLUMNS)).toEqual([{ field: 'Due__c', unit: 'month' }, { field: 'Stage__c', unit: null }, { field: 'Done__c', unit: null }]);
        expect(normalizeGrouping([{ field: 'When__c', unit: 'quarter' }], COLUMNS)).toEqual([{ field: 'When__c', unit: 'quarter' }]);
        expect(normalizeGrouping(null, COLUMNS)).toEqual([]);
        expect(levelParam({ field: 'Due__c', unit: 'quarter' })).toBe('Due__c:quarter');
        expect(levelParam({ field: 'Stage__c', unit: null })).toBe('Stage__c');
        expect(sameGrouping([{ field: 'A', unit: null }], [{ field: 'A' }])).toBe(true);
        expect(sameGrouping([{ field: 'A', unit: 'day' }], [{ field: 'A', unit: 'month' }])).toBe(false);
    });
});

describe('keys', () => {
    it('match the server: dates by unit, date/times in the user time zone, text without case', () => {
        expect(keyFor('2026-09-28', col('Due__c'), 'day')).toBe('2026-09-28');
        expect(keyFor('2026-09-28', col('Due__c'), 'month')).toBe('2026-09');
        expect(keyFor('2026-09-28', col('Due__c'), 'quarter')).toBe('2026-Q3');
        expect(keyFor('2026-01-01', col('Due__c'), 'quarter')).toBe('2026-Q1');
        expect(keyFor('2026-12-31', col('Due__c'), 'year')).toBe('2026');
        // 05:00 GMT on 1 January is still 31 December in Los Angeles.
        expect(keyFor('2026-01-01T05:00:00.000Z', col('When__c'), 'day')).toBe('2025-12-31');
        expect(keyFor('2026-01-01T05:00:00.000Z', col('When__c'), 'month')).toBe('2025-12');
        expect(keyFor('2026-01-01T12:00:00.000Z', col('When__c'), 'month', 'UTC')).toBe('2026-01');
        expect(keyFor(true, col('Done__c'))).toBe('true');
        expect(keyFor(null, col('Done__c'))).toBe('false');
        expect(keyFor(ACC, col('Account__c'))).toBe(ACC);
        expect(keyFor('  Acme ', col('Name'))).toBe('acme');
        expect(keyFor('ACME', col('Name'))).toBe('acme');
        expect(keyFor(null, col('Name'))).toBe('');
        expect(keyFor('', col('Due__c'), 'month')).toBe('');
    });

    it('from the server take the same form', () => {
        expect(serverKey('CaseProbe', col('Name'))).toBe(keyFor('caseprobe ', col('Name')));
        expect(serverKey(null, col('Stage__c'))).toBe('');
        expect(serverKey('false', col('Done__c'))).toBe('false');
        expect(serverKey('2026-Q3', col('Due__c'))).toBe('2026-Q3');
        expect(serverKey(ACC, col('Account__c'))).toBe(ACC); // an Id keeps its case: it is part of the Id
    });
});

describe('labels', () => {
    it('name each group as a person reads it', () => {
        expect(groupLabel('2026-09', col('Due__c'), 'month')).toBe('September 2026');
        expect(groupLabel('2026-Q3', col('Due__c'), 'quarter')).toBe('Q3 2026');
        expect(groupLabel('2026', col('Due__c'), 'year')).toBe('2026');
        expect(groupLabel('2026-09-28', col('Due__c'), 'day')).toBe('9/28/2026');
        expect(groupLabel('', col('Due__c'), 'month')).toBe(BLANK_LABEL);
        expect(groupLabel('true', col('Done__c'))).toBe('Checked');
        expect(groupLabel('false', col('Done__c'))).toBe('Not checked');
        expect(groupLabel('alpha_api', col('Stage__c'), null, { sample: 'alpha_api' })).toBe('Alpha');
        expect(groupLabel('gone', col('Stage__c'), null, {})).toBe('gone');
        expect(groupLabel(ACC, col('Account__c'), null, { names: { [ACC]: 'Acme' } })).toBe('Acme');
        expect(groupLabel(ACC, col('Account__c'), null, { serverLabel: 'Acme Corp' })).toBe('Acme Corp');
        expect(groupLabel('acme', col('Name'), null, { sample: 'Acme ' })).toBe('Acme');
        expect(recordsText(1)).toBe('1 record');
        expect(recordsText(1234)).toBe('1,234 records');
    });
});

describe('the view', () => {
    const rows = [
        { Id: 'r1', Stage__c: 'Beta', Due__c: '2026-01-05' },
        { Id: 'r2', Stage__c: 'alpha_api', Due__c: '2026-02-01' },
        { Id: 'r3', Stage__c: 'Beta', Due__c: '2026-07-09' },
        { Id: 'r4', Stage__c: 'ALPHA_API', Due__c: null },
        { Id: 'r5', Stage__c: null, Due__c: '2026-03-03' }
    ];
    const levels = [{ field: 'Stage__c', unit: null }, { field: 'Due__c', unit: 'quarter' }];
    const shape = items => items.map(i => (i.__group ? `${'  '.repeat(i.__group.level - 1)}[${i.__group.label}]` : i.Id));

    it('gathers rows under their groups, never splitting one, and puts the groups in order, blank last', () => {
        const { items, headers } = buildView(rows, levels, { columns: COLUMNS });
        expect(shape(items)).toEqual([
            '[Alpha]', '  [Q1 2026]', 'r2', `  [${BLANK_LABEL}]`, 'r4',
            '[Beta]', '  [Q1 2026]', 'r1', '  [Q3 2026]', 'r3',
            `[${BLANK_LABEL}]`, '  [Q1 2026]', 'r5'
        ]);
        const beta = items[5].__group;
        expect(beta).toMatchObject({ level: 1, key: 'beta', field: 'Stage__c', columnLabel: 'Stage', loaded: 2, count: null, expanded: true, parentId: null });
        expect(items[5].Id).toBe(beta.id);
        expect(headers.get(items[6].Id).parentId).toBe(beta.id);
        expect(items[5].Id).toMatch(/^__g1_/);
        // The same group gets the same id every time.
        expect(buildView(rows.slice().reverse(), levels, { columns: COLUMNS }).headers.has(beta.id)).toBe(true);
    });

    it('hides a collapsed group, and takes counts and subtotals from the server by path', () => {
        const first = buildView(rows, levels, { columns: COLUMNS });
        const betaId = first.items.find(i => i.__group && i.__group.label === 'Beta').Id;
        const totals = rollUp([
            { k: ['Beta', '2026-Q1'], n: 4, v: { Amount__c: { s: '10.5' } } },
            { k: ['Beta', '2026-Q3'], n: 1, v: { Amount__c: { s: '1' } } }
        ], levels, COLUMNS);
        const { items, headers } = buildView(rows, levels, { columns: COLUMNS, collapsed: { [betaId]: true }, totals });
        expect(shape(items)).toEqual([
            '[Alpha]', '  [Q1 2026]', 'r2', `  [${BLANK_LABEL}]`, 'r4', '[Beta]', `[${BLANK_LABEL}]`, '  [Q1 2026]', 'r5'
        ]);
        const beta = headers.get(betaId);
        expect(beta.expanded).toBe(false);
        expect(beta.count).toBe(5);
        expect(beta.values.Amount__c.s).toBe('11.5');
        expect(beta.loaded).toBe(2);
        // A collapsed group's sub-groups are not built at all.
        expect([...headers.values()].filter(h => h.parentId === betaId)).toEqual([]);
        expect(headers.size).toBe(6);
    });

    it('is the rows themselves when there is no grouping', () => {
        expect(buildView(rows, [], { columns: COLUMNS }).items).toBe(rows);
    });

    it('keeps the user order within a group, whatever it is (a date by year is not sorted by its day)', () => {
        const byYear = [{ field: 'Due__c', unit: 'year' }];
        const named = [
            { Id: 'a', Due__c: '2026-12-31' }, { Id: 'b', Due__c: '2026-01-01' }, { Id: 'c', Due__c: '2025-06-01' }, { Id: 'd', Due__c: '2026-06-15' }
        ];
        expect(shape(buildView(named, byYear, { columns: COLUMNS }).items)).toEqual(['[2025]', 'c', '[2026]', 'a', 'b', 'd']);
    });

    it('orders the groups in the direction the user sorted that column, blank still last', () => {
        const byStage = [{ field: 'Stage__c', unit: null }];
        const { items } = buildView(rows, byStage, { columns: COLUMNS, sortKeys: [{ field: 'Stage__c', direction: 'desc' }] });
        expect(shape(items)).toEqual(['[Beta]', 'r1', 'r3', '[Alpha]', 'r2', 'r4', `[${BLANK_LABEL}]`, 'r5']);
    });

    it('orders picklist groups as the field lists its values, as a Salesforce report does', () => {
        const stage = {
            field: 'StageName', label: 'Stage', type: 'picklist', groupable: true,
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
            { Id: 'o', StageName: 'Old Stage' }, // stored, no longer in the list
            { Id: 'p', StageName: 'Prospecting' },
            { Id: 'a', StageName: 'Archived' }, // stored, no longer in the list
            { Id: 'q', StageName: 'qualification' }
        ];
        expect(shape(buildView(deals, byStage, { columns: [stage] }).items)).toEqual([
            '[Prospecting]', 'p', '[Qualification]', 'q', '[Negotiation/Review]', 'r', '[Closed Won]', 'w',
            '[Archived]', 'a', '[Old Stage]', 'o', `[${BLANK_LABEL}]`, 'n'
        ]);
        // Sorted descending, the order reverses; blank stays last.
        expect(shape(buildView(deals, byStage, { columns: [stage], sortKeys: [{ field: 'StageName', direction: 'desc' }] }).items)).toEqual([
            '[Old Stage]', 'o', '[Archived]', 'a', '[Closed Won]', 'w', '[Negotiation/Review]', 'r',
            '[Qualification]', 'q', '[Prospecting]', 'p', `[${BLANK_LABEL}]`, 'n'
        ]);
        // As an inner level too.
        const byDoneThenStage = [{ field: 'Done__c', unit: null }, { field: 'StageName', unit: null }];
        const mixed = [
            { Id: 'x1', Done__c: false, StageName: 'Closed Won' },
            { Id: 'x2', Done__c: false, StageName: 'Prospecting' }
        ];
        expect(shape(buildView(mixed, byDoneThenStage, { columns: [stage, col('Done__c')] }).items)).toEqual([
            '[Not checked]', '  [Prospecting]', 'x2', '  [Closed Won]', 'x1'
        ]);
    });

    it('orders number groups by size, not as text', () => {
        const level = { field: 'Floors__c', label: 'Floors', type: 'number', scale: 0, groupable: true };
        const buildings = [{ Id: 'b10', Floors__c: 10 }, { Id: 'b9', Floors__c: 9 }, { Id: 'b100', Floors__c: 100 }];
        expect(shape(buildView(buildings, [{ field: 'Floors__c', unit: null }], { columns: [level] }).items)).toEqual([
            '[9]', 'b9', '[10]', 'b10', '[100]', 'b100'
        ]);
    });

    it('orders lookup groups by the record name, and checkboxes unchecked first', () => {
        const ACC2 = '001000000000002AAA';
        const byAccount = [{ field: 'Account__c', unit: null }];
        const accounts = [{ Id: 'x', Account__c: ACC }, { Id: 'y', Account__c: ACC2 }, { Id: 'z', Account__c: null }];
        const names = { [ACC]: 'Zeta', [ACC2]: 'Acme' };
        expect(shape(buildView(accounts, byAccount, { columns: COLUMNS, names }).items)).toEqual(['[Acme]', 'y', '[Zeta]', 'x', `[${BLANK_LABEL}]`, 'z']);
        const done = [{ Id: 'p', Done__c: true }, { Id: 'q', Done__c: false }];
        expect(shape(buildView(done, [{ field: 'Done__c', unit: null }], { columns: COLUMNS }).items)).toEqual(['[Not checked]', 'q', '[Checked]', 'p']);
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

    it('roll the deepest groups up into every level and the Total, slices merging', () => {
        const levels = [{ field: 'Stage__c', unit: null }, { field: 'Account__c', unit: null }];
        const slices = [
            [{ k: ['Beta', ACC], l: [null, 'Acme'], n: 2, v: { Amount__c: { s: '5.25' }, Due__c: { mx: '2026-03-01' }, When__c: { mn: '2026-01-02T10:00:00.000Z' }, Qty__c: { s: '3', c: 2 }, Note__c: { c: 1 } } }],
            [
                { k: ['BETA', ACC], l: [null, 'Acme'], n: 1, v: { Amount__c: { s: '4.75' }, Due__c: { mx: '2026-12-31' }, When__c: { mn: '2025-06-01T00:00:00.000Z' }, Qty__c: { s: '4', c: 1 }, Note__c: { c: 1 } } },
                // As Lightning delivers it: a blank key is '', and null values are simply missing.
                { k: ['', ''], l: ['', ''], n: 3, v: { Amount__c: {}, Due__c: {}, When__c: {}, Qty__c: { c: 0 }, Note__c: { c: 0 } } }
            ]
        ];
        const { byPath, total } = rollUp(slices.flat(), levels, COLUMNS);
        const beta = byPath.get('beta');
        expect(beta.count).toBe(3);
        expect(beta.values.Amount__c.s).toBe('10.00');
        expect(beta.values.Due__c.mx).toBe('2026-12-31');
        expect(beta.values.When__c.mn).toBe('2025-06-01T00:00:00.000Z');
        const acme = byPath.get('beta' + String.fromCharCode(31) + ACC);
        expect(acme.label).toBe('Acme');
        expect(acme.count).toBe(3);
        expect(byPath.get('').count).toBe(3);
        expect(total.count).toBe(6);
        expect(total.values.Amount__c.s).toBe('10.00');
        expect(total.values.Qty__c).toMatchObject({ s: '7', c: 3 });
        // As the column shows them.
        expect(subtotalFor(total, col('Amount__c'))).toEqual({ kind: 'sum', value: '10.00', text: '$10.00' });
        expect(subtotalFor(total, col('Qty__c')).text).toBe('2.33'); // an average keeps two places
        expect(subtotalFor(total, col('Due__c')).text).toBe('12/31/2026');
        expect(subtotalFor(total, col('Note__c'))).toEqual({ kind: 'count', value: 2, text: '2' });
        expect(subtotalFor(byPath.get(''), col('Qty__c')).text).toBe(''); // no values, no average
        expect(subtotalFor(total, col('Name'))).toBeNull(); // no subtotal on this column
    });

    it('never files a group without one key per level under another group; it counts in the Total only', () => {
        // Lightning drops null list elements: [null, "2026-Q1"] would arrive as ["2026-Q1"].
        const levels = [{ field: 'Stage__c', unit: null }, { field: 'Due__c', unit: 'quarter' }];
        const { byPath, total } = rollUp([
            { k: ['2026-Q1'], n: 4, v: { Amount__c: { s: '4' } } },
            { k: ['Beta', '2026-Q1'], n: 1, v: { Amount__c: { s: '1' } } }
        ], levels, COLUMNS);
        expect(byPath.has('2026-q1')).toBe(false);
        expect([...byPath.keys()]).toEqual(['beta', 'beta' + String.fromCharCode(31) + '2026-Q1']);
        expect(total.count).toBe(5);
        expect(total.values.Amount__c.s).toBe('5');
    });
});
