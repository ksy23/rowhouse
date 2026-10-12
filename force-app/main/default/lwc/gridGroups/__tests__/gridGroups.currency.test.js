/*
 * Subtotals in an org with more than one currency. The server's aggregates
 * are in the corporate currency (USD here), each record converted at the
 * org's rates, which the browser does not have. So a subtotal says its
 * currency, and an unsaved edit in another currency is not added in: the
 * figure stays as saved until the save.
 */
import { rollUp, withDrafts, subtotalFor, subtotalText } from 'c/gridGroups';

const STAGE = {
    field: 'StageName',
    label: 'Stage',
    type: 'picklist',
    options: [
        { value: 'Open', label: 'Open' },
        { value: 'Won', label: 'Won' }
    ]
};
const MIXED = {
    field: 'Amount',
    label: 'Amount',
    type: 'currency',
    scale: 2,
    currencyField: 'CurrencyIsoCode',
    totalCurrency: 'USD'
};
const SUM = { ...MIXED, subtotal: 'sum' };
const LOW = { ...MIXED, field: 'Discount__c', label: 'Discount', subtotal: 'min' };
const COUNT = { ...MIXED, field: 'Deposit__c', label: 'Deposit', subtotal: 'count' };
const COLUMNS = [STAGE, SUM, LOW, COUNT];
const LEVELS = [{ field: 'StageName', unit: null }];
const ROWS = [
    { Id: 'r1', StageName: 'Open', Amount: '100', Discount__c: '5', Deposit__c: '1', CurrencyIsoCode: 'USD' },
    { Id: 'r2', StageName: 'Open', Amount: '1000', Discount__c: '9', Deposit__c: '1', CurrencyIsoCode: 'CAD' },
    { Id: 'r3', StageName: 'Won', Amount: '500', Discount__c: '1', Deposit__c: null, CurrencyIsoCode: 'EUR' }
];
// The server's figures: CAD 1,000 converted at 0.5092 is USD 1,963.86.
const SERVER = [
    { k: ['Open'], n: 2, v: { Amount: { s: '2063.86' }, Discount__c: { mn: '5' }, Deposit__c: { c: 2 } } },
    { k: ['Won'], n: 1, v: { Amount: { s: '500.00' }, Discount__c: { mn: '1' }, Deposit__c: { c: 0 } } }
];
const totals = () => rollUp(SERVER, LEVELS, COLUMNS);

describe('subtotals in more than one currency', () => {
    it('are shown in the corporate currency, by its code', () => {
        const t = totals();
        expect(subtotalFor(t.total, SUM).text).toBe('USD 2,563.86');
        expect(subtotalText('2063.86', 'average', SUM)).toBe('USD 2,063.86');
        expect(subtotalText('3', 'count', SUM)).toBe('3');
    });

    it('add in an unsaved edit to an amount in the corporate currency', () => {
        const shown = withDrafts(totals(), ROWS, { r1: { Amount: '150' } }, LEVELS, COLUMNS);
        expect(subtotalFor(shown.byPath.get('open'), SUM).value).toBe('2113.86');
        expect(shown.byPath.get('open').unknown).toEqual({});
        expect(shown.byPath.get('open').edited).toEqual({ Amount: true });
    });

    it('leave a figure as saved, and say so, for an edit in another currency', () => {
        const shown = withDrafts(totals(), ROWS, { r2: { Amount: '2000' } }, LEVELS, COLUMNS);
        expect(subtotalFor(shown.byPath.get('open'), SUM).value).toBe('2063.86');
        expect(shown.byPath.get('open').unknown).toEqual({ Amount: true });
        expect(shown.total.unknown).toEqual({ Amount: true });
        expect(shown.byPath.get('won').unknown).toBeUndefined();
    });

    it('never work a lowest value out from rows in different currencies', () => {
        const shown = withDrafts(totals(), ROWS, { r1: { Discount__c: '20' } }, LEVELS, COLUMNS, { complete: true });
        expect(subtotalFor(shown.byPath.get('open'), LOW).value).toBe('5');
        expect(shown.byPath.get('open').unknown).toEqual({ Discount__c: true });
    });

    it('still count an edit in any currency', () => {
        const shown = withDrafts(totals(), ROWS, { r3: { Deposit__c: '4' } }, LEVELS, COLUMNS);
        expect(subtotalFor(shown.byPath.get('won'), COUNT).value).toBe(1);
        expect(shown.byPath.get('won').unknown).toEqual({});
    });

    it('treat an edit as in another currency when the corporate currency is not known', () => {
        const blind = COLUMNS.map(c => (c.totalCurrency ? { ...c, totalCurrency: null } : c));
        const shown = withDrafts(rollUp(SERVER, LEVELS, blind), ROWS, { r1: { Amount: '150' } }, LEVELS, blind);
        expect(shown.byPath.get('open').unknown).toEqual({ Amount: true });
        expect(subtotalFor(shown.total, blind[1]).text).toBe('2,563.86');
    });
});
