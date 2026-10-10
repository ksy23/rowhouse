/*
 * Amounts in an org with more than one currency: each in its record's
 * currency, by its ISO code, as Salesforce shows them; totals in the
 * corporate currency; and no browser-side sort across currencies. In Jest
 * the user's currency is USD and the locale en-US.
 */
import { formatValue, formatNumber, currencyFor, totalColumn, isMixedCurrency, sortRows } from 'c/gridFormat';

const AMOUNT = { field: 'Amount', type: 'currency', scale: 2 };
const MIXED = { ...AMOUNT, currencyField: 'CurrencyIsoCode', totalCurrency: 'USD' };

describe('one currency', () => {
    it('shows the user’s currency by its symbol, as before', () => {
        expect(formatValue('78250.00', AMOUNT)).toBe('$78,250.00');
        expect(formatValue('78250.00', AMOUNT, { CurrencyIsoCode: 'EUR' })).toBe('$78,250.00');
        expect(currencyFor(AMOUNT)).toEqual({ code: 'USD', byCode: false });
        expect(totalColumn(AMOUNT)).toBe(AMOUNT);
        expect(isMixedCurrency(AMOUNT)).toBe(false);
    });
});

describe('more than one currency', () => {
    it('shows each amount in its record’s currency, by its code', () => {
        expect(formatValue('78250.00', MIXED, { CurrencyIsoCode: 'USD' })).toBe('USD 78,250.00');
        expect(formatValue('1000', MIXED, { CurrencyIsoCode: 'CAD' })).toBe('CAD 1,000.00');
        expect(formatValue('1000', MIXED, { CurrencyIsoCode: 'EUR' })).toBe('EUR 1,000.00');
        expect(formatValue('-1000', MIXED, { CurrencyIsoCode: 'GBP' })).toBe('-GBP 1,000.00');
    });

    it('reads a parent record’s currency for a parent record’s amount', () => {
        const revenue = {
            field: 'Account.AnnualRevenue',
            type: 'currency',
            scale: 0,
            currencyField: 'Account.CurrencyIsoCode'
        };
        expect(formatValue('5000000', revenue, { 'Account.CurrencyIsoCode': 'GBP', CurrencyIsoCode: 'USD' })).toBe(
            'GBP 5,000,000'
        );
    });

    it('shows a row that does not carry its currency (a new row) in the user’s currency, by its code', () => {
        expect(formatValue('5', MIXED, {})).toBe('USD 5.00');
        expect(formatValue('5', MIXED)).toBe('USD 5.00');
    });

    it('keeps digits a Number would lose, with the code before them', () => {
        expect(formatValue('123456789012345678.25', MIXED, { CurrencyIsoCode: 'JPY' })).toBe(
            'JPY 123,456,789,012,345,678.25'
        );
    });

    it('shows a code the browser does not know before the number, never throwing', () => {
        expect(formatNumber(12.5, { type: 'currency', scale: 2, currencyCode: 'ZZ1', byCode: true })).toBe('ZZ1 12.50');
    });

    it('shows a column whose values are all in one currency (a child total) by that code', () => {
        const childTotal = { field: '_ct_x', type: 'currency', scale: 2, currencyCode: 'USD', totalCurrency: 'USD' };
        expect(formatValue('42', childTotal, { CurrencyIsoCode: 'EUR' })).toBe('USD 42.00');
        expect(isMixedCurrency(childTotal)).toBe(false);
    });

    it('shows a total in the corporate currency, by its code, whatever the user’s', () => {
        const eur = { ...MIXED, totalCurrency: 'EUR' };
        expect(formatValue('105208.14', totalColumn(eur), { CurrencyIsoCode: 'CAD' })).toBe('EUR 105,208.14');
    });

    it('shows a total as the number alone when the corporate currency could not be read', () => {
        expect(formatValue('105208.14', totalColumn({ ...MIXED, totalCurrency: null }))).toBe('105,208.14');
    });

    it('leaves amounts in mixed currencies in the order they came in (the server’s, by converted amount)', () => {
        expect(isMixedCurrency(MIXED)).toBe(true);
        const rows = [
            { Id: 'a', Amount: '100', CurrencyIsoCode: 'GBP' },
            { Id: 'b', Amount: '120', CurrencyIsoCode: 'USD' },
            { Id: 'c', Amount: '50', CurrencyIsoCode: 'GBP' }
        ];
        const keys = [{ field: 'Amount', type: 'currency', direction: 'asc', mixed: true }];
        expect(sortRows(rows, keys).map(r => r.Id)).toEqual(['a', 'b', 'c']);
        // An earlier key still sorts; the mixed one keeps the order within it.
        const byCode = [{ field: 'CurrencyIsoCode', type: 'picklist', direction: 'asc' }, ...keys];
        expect(sortRows(rows, byCode).map(r => r.Id)).toEqual(['a', 'c', 'b']);
    });
});
