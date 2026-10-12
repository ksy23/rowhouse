/**
 * A picklist column sorts in the field's own order, as SOQL's ORDER BY does,
 * and a Time shows in the user's locale.
 */
import { picklistRanks, compareValues, sortRows, formatTime, formatValue } from 'c/gridFormat';

const OPTIONS = [
    { value: 'Prospecting', label: 'Prospecting' },
    { value: 'Qualification', label: 'Qualification' },
    { value: 'Closed Won', label: 'Closed Won' }
];

describe('picklist order', () => {
    it('ranks each value by its place in the list, ignoring case', () => {
        const ranks = picklistRanks(OPTIONS);
        expect(ranks.get('prospecting')).toBe(0);
        expect(ranks.get('closed won')).toBe(2);
        expect(picklistRanks(null).size).toBe(0);
    });

    it('sorts by the field’s order, not the alphabet', () => {
        const ranks = picklistRanks(OPTIONS);
        const rows = [
            { Id: '1', Stage: 'Closed Won' },
            { Id: '2', Stage: 'Prospecting' },
            { Id: '3', Stage: null },
            { Id: '4', Stage: 'Qualification' },
            { Id: '5', Stage: 'Archived' } // no longer in the list
        ];
        const asc = sortRows(rows, [{ field: 'Stage', type: 'picklist', direction: 'asc', ranks }]).map(r => r.Stage);
        expect(asc).toEqual(['Prospecting', 'Qualification', 'Closed Won', 'Archived', null]);
        const desc = sortRows(rows, [{ field: 'Stage', type: 'picklist', direction: 'desc', ranks }]).map(r => r.Stage);
        // Reversed, with blank still last.
        expect(desc).toEqual(['Archived', 'Closed Won', 'Qualification', 'Prospecting', null]);
    });

    it('sorts values no longer in the list by their text', () => {
        const ranks = picklistRanks(OPTIONS);
        expect(compareValues('Negotiation/Review', 'Closed Lost', 'picklist', 'asc', ranks)).toBe(1);
        expect(compareValues('Closed Lost', 'Prospecting', 'picklist', 'asc', ranks)).toBe(1);
    });

    it('sorts alphabetically when there are no ranks', () => {
        expect(compareValues('Closed Won', 'Prospecting', 'picklist', 'asc')).toBe(-1);
    });
});

describe('times', () => {
    it('shows a Time in the locale, not as stored', () => {
        expect(formatTime('17:30:00.000Z')).toMatch(/^5:30\sPM$/);
        expect(formatTime('07:05:00.000Z')).toMatch(/^7:05\sAM$/);
        expect(formatValue('17:30:00.000Z', { type: 'time' })).toMatch(/^5:30\sPM$/);
    });

    it('shows nothing for blank, and an odd value as it is', () => {
        expect(formatTime(null)).toBe('');
        expect(formatTime('')).toBe('');
        expect(formatTime('later')).toBe('later');
    });
});
