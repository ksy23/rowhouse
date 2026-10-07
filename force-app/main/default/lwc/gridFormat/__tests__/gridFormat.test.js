/**
 * gridFormat — display, comparison and link safety, by test-case number.
 */
import { formatValue, formatNumber, formatDate, formatCount, safeHref, compareValues, sortRows, toSafeNumeric, codePointLength, roundDecimal, alignmentFor } from 'c/gridFormat';

describe('numbers', () => {
    it('TC-003 zero is "0", and "0.00" at scale 2 — never blank', () => {
        expect(formatNumber(0)).toBe('0');
        expect(formatNumber(0, { scale: 2 })).toBe('0.00');
        expect(formatNumber(0, { type: 'percent', scale: 2 })).toBe('0.00%');
    });
    it('TC-022 negative currency is formatted by the locale', () => {
        expect(formatNumber(-1234.56, { type: 'currency', scale: 2 })).toMatch(/-\$1,234\.56|\(\$1,234\.56\)/);
    });
    it('TC-024 an 18-digit value stays exact', () => {
        expect(toSafeNumeric('999999999999999999')).toBe('999999999999999999');
        expect(formatNumber('999999999999999999')).toBe('999,999,999,999,999,999');
        expect(toSafeNumeric('1234.5')).toBe(1234.5);
    });
    it('TC-025 percent is displayed as stored, not multiplied', () => {
        expect(formatNumber(50, { type: 'percent' })).toBe('50%');
    });
    it('TC-026 grouping on display', () => {
        expect(formatNumber(1234567.89, { scale: 2 })).toBe('1,234,567.89');
    });
    it('keeps its formatters apart by scale and currency, though it makes each only once', () => {
        // Formatters are cached: a cache keyed too loosely
        // would give one scale's or currency's layout to another.
        expect(formatNumber(1.5, { scale: 2 })).toBe('1.50');
        expect(formatNumber(1.5, { scale: 0 })).toBe('2');
        expect(formatNumber(1.5, { scale: 2 })).toBe('1.50');
        expect(formatNumber(1.23456789)).toBe('1.234568');
        expect(formatNumber(5, { type: 'currency', scale: 2, currencyCode: 'USD' })).toMatch(/\$5\.00/);
        expect(formatNumber(5, { type: 'currency', scale: 2, currencyCode: 'EUR' })).toMatch(/€5\.00/);
        expect(formatNumber(5, { type: 'currency', scale: 0, currencyCode: 'EUR' })).toMatch(/€5(?!\.)/);
        expect(formatNumber(5, { type: 'currency', scale: 2, currencyCode: 'USD' })).toMatch(/\$5\.00/);
    });
    it('formats a count grouped for the locale', () => {
        expect(formatCount(0)).toBe('0');
        expect(formatCount(1234)).toBe('1,234');
        expect(formatCount(50000)).toBe('50,000');
    });
});

describe('dates', () => {
    it('TC-027 / TC-028 a Date never shifts a day', () => {
        expect(formatDate('2026-01-01')).toBe('1/1/2026');
        expect(formatDate('2026-12-31')).toBe('12/31/2026');
    });
    it('TC-032 / TC-033 / TC-034 leap day and the platform range', () => {
        expect(formatDate('2028-02-29')).toBe('2/29/2028');
        expect(formatDate('1700-01-01')).toBe('1/1/1700');
        expect(formatDate('4000-12-31')).toBe('12/31/4000');
    });
});

describe('links (TC-045 / TC-046)', () => {
    it('keeps the full URL, query string and fragment', () => {
        const url = 'https://example.com/a/very/long/path?query=1&other=2#fragment-name';
        expect(safeHref(url)).toBe(url);
    });
    /* eslint-disable no-script-url -- these strings ARE the attack being tested */
    it('never makes javascript: clickable, however it is disguised', () => {
        expect(safeHref('javascript:alert(document.domain)')).toBeNull();
        expect(safeHref(' JaVaScRiPt:alert(1)')).toBeNull();
        expect(safeHref('java\tscript:alert(1)')).toBeNull();
        expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
        expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    });
    /* eslint-enable no-script-url */
    it('allows mailto and tel, and treats a bare host as https', () => {
        expect(safeHref('mailto:a@b.example')).toBe('mailto:a@b.example');
        expect(safeHref('rowhouse.example/x')).toBe('https://rowhouse.example/x');
    });
});

describe('display', () => {
    it('TC-036 an inactive picklist value is shown as stored', () => {
        expect(formatValue('Obsolete', { type: 'picklist', options: [{ value: 'Alpha', label: 'Alpha' }] })).toBe('Obsolete');
    });
    it('TC-040 multi-select renders as a list without a trailing separator (TC-041)', () => {
        expect(formatValue('Red;Green;Blue', { type: 'multipicklist' })).toBe('Red, Green, Blue');
        expect(formatValue('Green', { type: 'multipicklist' })).toBe('Green');
    });
    it('TC-042 checkbox text is explicit', () => {
        expect(formatValue(true, { type: 'checkbox' })).toBe('Checked');
        expect(formatValue(false, { type: 'checkbox' })).toBe('Not checked');
    });
    it('TC-012 code points, not UTF-16 units', () => {
        expect(codePointLength('🧱a')).toBe(2);
    });
});

describe('comparison', () => {
    it('nulls last in both directions', () => {
        expect(compareValues(null, 1, 'number', 'asc')).toBe(1);
        expect(compareValues(null, 1, 'number', 'desc')).toBe(1);
    });
    it('compares 18-digit strings exactly', () => {
        expect(compareValues('999999999999999998', '999999999999999999', 'number')).toBe(-1);
        expect(compareValues('-5', '3', 'number')).toBe(-1);
        expect(compareValues('10.50', '10.5', 'number')).toBe(0);
    });
    it('sorts deterministically with an Id tiebreak', () => {
        const rows = [{ Id: 'b', v: 1 }, { Id: 'a', v: 1 }];
        expect(sortRows(rows, [{ field: 'v', type: 'number', direction: 'asc' }]).map(r => r.Id)).toEqual(['a', 'b']);
        expect(rows.map(r => r.Id)).toEqual(['b', 'a']); // input untouched
    });
});

describe('TC-023: rounding to the field scale', () => {
    it('rounds the decimal digits half up, never the binary float', () => {
        // As floats, 1.005 and 2.675 sit just below the half and would round down.
        expect(roundDecimal(1.005, 2)).toBe('1.01');
        expect(roundDecimal('2.675', 2)).toBe('2.68');
        expect(roundDecimal('1234.567', 2)).toBe('1234.57');
        expect(roundDecimal('1234.564', 2)).toBe('1234.56');
    });
    it('rounds half away from zero for negatives, as Salesforce documents', () => {
        expect(roundDecimal('-1.45', 1)).toBe('-1.5');
        expect(roundDecimal(-1.005, 2)).toBe('-1.01');
        expect(roundDecimal('-0.004', 2)).toBe('0.00'); // no negative zero
    });
    it('carries through nines and into a new digit', () => {
        expect(roundDecimal('9.995', 2)).toBe('10.00');
        expect(roundDecimal('999.5', 0)).toBe('1000');
    });
    it('leaves a value that already fits, and anything that is not a plain decimal, unchanged', () => {
        expect(roundDecimal(1.5, 2)).toBe(1.5);
        expect(roundDecimal('12.30', 2)).toBe('12.30');
        expect(roundDecimal('abc', 2)).toBe('abc');
        expect(roundDecimal(null, 2)).toBeNull();
        expect(roundDecimal('1.2345', undefined)).toBe('1.2345');
    });
    it('keeps an 18-digit value exact while rounding its fraction', () => {
        expect(roundDecimal('123456789012345678.5', 0)).toBe('123456789012345679');
    });
    it('shows TC-023 as 1,234.57, the value that will be saved, not 1,234.56', () => {
        expect(formatNumber('1234.567', { type: 'number', scale: 2 })).toBe('1,234.57');
        expect(formatNumber(1.005, { type: 'number', scale: 2 })).toBe('1.01');
        expect(formatNumber('0.005', { type: 'currency', scale: 2 })).toMatch(/\$0\.01/);
    });
});

describe('alignmentFor', () => {
    it.each([
        ['number', 'right'], ['currency', 'right'], ['percent', 'right'], ['double', 'right'], ['integer', 'right'],
        ['checkbox', 'center'], ['boolean', 'center'],
        ['date', 'left'], ['datetime', 'left'], ['picklist', 'left'], ['multipicklist', 'left'], ['text', 'left'], [undefined, 'left']
    ])('%s aligns %s', (type, expected) => {
        expect(alignmentFor(type)).toBe(expected);
    });
});
