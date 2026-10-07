/**
 * Clipboard rules (docs/spreadsheet.md): what copy writes,
 * what paste reads, and where pasted values land.
 */
import { copyText, toTsv, parseTsv, parseCell, unneutralise, pastePlan, separators } from 'c/gridClipboard';

const col = (type, extra = {}) => ({ field: 'F', type, ...extra });
const STAGES = [
    { value: 'Alpha', label: 'Alpha' },
    { value: 'closed_won', label: 'Closed Won' }
];

describe('copy', () => {
    it('writes numbers plain, rounded as displayed, with a percent sign for percent', () => {
        expect(copyText(1234.567, col('currency', { scale: 2 }), 'en-US')).toBe('1234.57');
        expect(copyText(-5, col('number', { scale: 0 }), 'en-US')).toBe('-5');
        expect(copyText(50, col('percent', { scale: 2 }), 'en-US')).toBe('50%');
        expect(copyText('123456789012345678', col('number', { scale: 0 }), 'en-US')).toBe('123456789012345678');
    });

    it("uses the user's decimal separator, so a spreadsheet in that locale reads a number", () => {
        expect(copyText(1234.5, col('number', { scale: 2 }), 'de-DE')).toBe('1234,5');
    });

    it('writes dates as ISO, checkboxes as TRUE/FALSE, picklists as their labels', () => {
        expect(copyText('2026-09-29', col('date'), 'en-US')).toBe('2026-09-29');
        expect(copyText(true, col('checkbox'))).toBe('TRUE');
        expect(copyText(null, col('checkbox'))).toBe('FALSE');
        expect(copyText('closed_won', col('picklist', { options: STAGES }))).toBe('Closed Won');
        expect(copyText(null, col('text'))).toBe('');
    });

    it('neutralises a formula prefix in text, as CSV export does (TC-019/020)', () => {
        expect(copyText('=HYPERLINK("http://x")', col('text'))).toBe('\'=HYPERLINK("http://x")');
        expect(copyText('@SUM(A1)', col('text'))).toBe("'@SUM(A1)");
        expect(copyText('plain', col('text'))).toBe('plain');
    });

    it('quotes a value with a tab, a line break or a quote, as Excel does', () => {
        expect(toTsv([['a', 'b\tc'], ['line one\nline two', 'say "hi"']]))
            .toBe('a\t"b\tc"\n"line one\nline two"\t"say ""hi"""');
    });
});

describe('parseTsv', () => {
    it('reads rows and columns, ignoring the line break Excel adds at the end', () => {
        expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
        expect(parseTsv('one')).toEqual([['one']]);
        expect(parseTsv('a\t')).toEqual([['a', '']]);
    });

    it('reads a quoted multi-line cell and doubled quotes', () => {
        expect(parseTsv('"line one\nline two"\t"say ""hi"""\nx\ty')).toEqual([
            ['line one\nline two', 'say "hi"'],
            ['x', 'y']
        ]);
    });

    it('round-trips whatever toTsv writes', () => {
        const matrix = [['=1+1', 'tab\there'], ['', '"quoted"'], ['multi\r\nline', 'é 🎉']];
        expect(parseTsv(toTsv(matrix))).toEqual(matrix);
    });

    it('treats empty text as one empty cell', () => {
        expect(parseTsv('')).toEqual([['']]);
    });
});

describe('parseCell', () => {
    it('reads numbers the way spreadsheets write them', () => {
        const n = col('currency', { scale: 2 });
        expect(parseCell('1,234.567', n, 'en-US')).toEqual({ value: 1234.57 });
        expect(parseCell('$1,234.50', n, 'en-US')).toEqual({ value: 1234.5 });
        expect(parseCell('(1,234.00)', n, 'en-US')).toEqual({ value: -1234 });
        expect(parseCell('-$5', n, 'en-US')).toEqual({ value: -5 });
        expect(parseCell('1.234,5 €', n, 'de-DE')).toEqual({ value: 1234.5 });
        expect(parseCell('', n, 'en-US')).toEqual({ value: null });
        expect(parseCell('12abc', n, 'en-US')).toEqual({ error: 'Not a number: 12abc' });
    });

    it('keeps an 18-digit number exact (TC-024) and reads a percent sign', () => {
        expect(parseCell('999999999999999999', col('number', { scale: 0 }), 'en-US')).toEqual({ value: '999999999999999999' });
        expect(parseCell('50%', col('percent', { scale: 2 }), 'en-US')).toEqual({ value: 50 });
    });

    it('reads ISO dates and dates in the locale order, and refuses impossible ones', () => {
        expect(parseCell('2026-09-29', col('date'), 'en-US')).toEqual({ value: '2026-09-29' });
        expect(parseCell('9/29/2026', col('date'), 'en-US')).toEqual({ value: '2026-09-29' });
        expect(parseCell('29/09/2026', col('date'), 'en-GB')).toEqual({ value: '2026-09-29' });
        expect(parseCell('2/30/2026', col('date'), 'en-US')).toEqual({ error: 'Not a date: 2/30/2026' });
    });

    it('refuses a year a Date field cannot hold, such as one typed halfway', () => {
        expect(parseCell('1/5/202', col('date'), 'en-US')).toEqual({ error: 'Not a date: 1/5/202' });
        expect(parseCell('1/5/26', col('date'), 'en-US')).toEqual({ value: '2026-01-05' }); // two digits: this century
        expect(parseCell('1699-12-31', col('date'))).toEqual({ error: 'Not a date: 1699-12-31' });
        expect(parseCell('1700-01-01', col('date'))).toEqual({ value: '1700-01-01' });
        expect(parseCell('4000-12-31', col('date'))).toEqual({ value: '4000-12-31' });
        expect(parseCell('4001-01-01', col('date'))).toEqual({ error: 'Not a date: 4001-01-01' });
    });

    it('reads checkboxes from TRUE/FALSE, yes/no, 1/0 and x', () => {
        const c = col('checkbox');
        expect(parseCell('TRUE', c)).toEqual({ value: true });
        expect(parseCell('x', c)).toEqual({ value: true });
        expect(parseCell('No', c)).toEqual({ value: false });
        expect(parseCell('', c)).toEqual({ value: false });
        expect(parseCell('maybe', c)).toEqual({ error: 'Not a checkbox value: maybe' });
    });

    it('maps a picklist label or value, and refuses anything else', () => {
        const p = col('picklist', { options: STAGES });
        expect(parseCell('Closed Won', p)).toEqual({ value: 'closed_won' });
        expect(parseCell('closed won', p)).toEqual({ value: 'closed_won' });
        expect(parseCell('alpha', p)).toEqual({ value: 'Alpha' });
        expect(parseCell('Obsolete', p)).toEqual({ error: 'Not a value of this picklist: Obsolete' });
    });

    it('takes text exactly as pasted (TC-005) and undoes copy\'s neutralising apostrophe', () => {
        expect(parseCell('  padded  ', col('text'))).toEqual({ value: '  padded  ' });
        expect(parseCell("'=1+1", col('text'))).toEqual({ value: '=1+1' });
        expect(parseCell("'plain", col('text'))).toEqual({ value: "'plain" });
        expect(unneutralise("'@x")).toBe('@x');
    });

    it('round-trips a copy for every editable type', () => {
        const cases = [
            [1234.57, col('currency', { scale: 2 })],
            [-5, col('number', { scale: 0 })],
            [50, col('percent', { scale: 2 })],
            ['2026-09-29', col('date')],
            [true, col('checkbox')],
            ['closed_won', col('picklist', { options: STAGES })],
            ['=HYPERLINK("x")', col('text')]
        ];
        cases.forEach(([value, c]) => {
            expect(parseCell(copyText(value, c, 'en-US'), c, 'en-US')).toEqual({ value });
        });
    });
});

describe('pastePlan', () => {
    const bounds = { rowCount: 10, colCount: 4 };

    it('fills a range with one value', () => {
        const plan = pastePlan([['x']], { top: 2, left: 1, bottom: 4, right: 2 }, bounds);
        expect(plan.cells).toHaveLength(6);
        expect(plan.cells.every(c => c.text === 'x')).toBe(true);
    });

    it('repeats a block into a range that is a whole multiple of it', () => {
        const plan = pastePlan([['a', 'b']], { top: 1, left: 1, bottom: 2, right: 4 }, bounds);
        expect(plan.cells.map(c => c.text)).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b']);
    });

    it('pastes a block once from the top-left when the range is not a multiple', () => {
        const plan = pastePlan([['a', 'b'], ['c', 'd']], { top: 3, left: 2, bottom: 3, right: 2 }, bounds);
        expect(plan.cells).toEqual([
            { row: 3, col: 2, text: 'a' }, { row: 3, col: 3, text: 'b' },
            { row: 4, col: 2, text: 'c' }, { row: 4, col: 3, text: 'd' }
        ]);
    });

    it('counts the cells that fall off the grid instead of pasting them', () => {
        const plan = pastePlan([['a', 'b', 'c']], { top: 10, left: 3, bottom: 10, right: 3 }, bounds);
        expect(plan.cells).toHaveLength(2);
        expect(plan.dropped).toBe(1);
    });
});

describe('separators', () => {
    it('reads the decimal and grouping characters from the locale', () => {
        expect(separators('en-US')).toEqual({ decimal: '.', group: ',' });
        expect(separators('de-DE')).toEqual({ decimal: ',', group: '.' });
    });
});

describe('number separators outside en-US', () => {
    it('reads French grouping (a no-break space) and a typographic minus', () => {
        const n = { field: 'F', type: 'number', scale: 2 };
        const nbsp = String.fromCharCode(0x202f);
        expect(parseCell(`1${nbsp}234,5`, n, 'fr-FR')).toEqual({ value: 1234.5 });
        expect(parseCell(String.fromCharCode(0x2212) + '5', n, 'en-US')).toEqual({ value: -5 });
    });
});
