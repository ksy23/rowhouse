/**
 * Paste, fill and import read times and date/times as the editors do:
 * a Time has no zone; a date/time is the wall clock in the user's Salesforce
 * time zone unless it says its own.
 */
import { parseCell } from 'c/gridClipboard';

const TIME = { field: 'Pickup_Time__c', type: 'time' };
const WHEN = { field: 'Picked_Up__c', type: 'datetime' };

describe('times', () => {
    it('stores a pasted time as Salesforce writes one', () => {
        expect(parseCell('17:30', TIME)).toEqual({ value: '17:30:00.000Z' });
        expect(parseCell('5:30 PM', TIME)).toEqual({ value: '17:30:00.000Z' });
        expect(parseCell('5pm', TIME)).toEqual({ value: '17:00:00.000Z' });
        expect(parseCell('17:30:00.000Z', TIME)).toEqual({ value: '17:30:00.000Z' });
    });

    it('clears on an empty cell, and refuses what is not a time', () => {
        expect(parseCell('', TIME)).toEqual({ value: null });
        expect(parseCell('  ', TIME)).toEqual({ value: null });
        expect(parseCell('25:00', TIME)).toEqual({ error: 'Not a time: 25:00' });
    });

    it('reads an Excel time cell, a time on Excel’s day zero', () => {
        expect(parseCell('1899-12-31T17:30:00', TIME)).toEqual({ value: '17:30:00.000Z' });
        expect(parseCell('1899-12-30T08:05:09', TIME)).toEqual({ value: '08:05:09.000Z' });
        expect(parseCell('1904-01-01T17:30:00', TIME)).toEqual({ value: '17:30:00.000Z' });
        expect(parseCell('1899-12-31', TIME)).toEqual({ value: '00:00:00.000Z' });
        expect(parseCell('2026-10-01T17:30:00', TIME).error).toBeTruthy(); // a real day is not a time
    });
});

describe('date/times', () => {
    it('reads the grid’s own display, in the user’s time zone', () => {
        expect(parseCell('10/1/2026, 5:30 PM', WHEN, 'en-US', 'America/New_York')).toEqual({
            value: '2026-10-01T21:30:00.000Z'
        });
        expect(parseCell('10/1/2026 17:30', WHEN, 'en-US', 'Asia/Kolkata')).toEqual({
            value: '2026-10-01T12:00:00.000Z'
        });
        expect(parseCell('2026-10-01T17:30', WHEN, 'en-US', 'America/New_York')).toEqual({
            value: '2026-10-01T21:30:00.000Z'
        });
    });

    it('takes an instant with its own zone as it is', () => {
        expect(parseCell('2026-10-01T17:30:00Z', WHEN, 'en-US', 'Asia/Kolkata')).toEqual({
            value: '2026-10-01T17:30:00.000Z'
        });
        expect(parseCell('2026-10-01T17:30:00+02:00', WHEN, 'en-US', 'Asia/Kolkata')).toEqual({
            value: '2026-10-01T15:30:00.000Z'
        });
    });

    it('reads a date alone as that day’s midnight there', () => {
        expect(parseCell('2026-10-01', WHEN, 'en-US', 'America/New_York')).toEqual({
            value: '2026-10-01T04:00:00.000Z'
        });
    });

    it('clears on an empty cell, and refuses what is not a date and time', () => {
        expect(parseCell('', WHEN, 'en-US', 'UTC')).toEqual({ value: null });
        expect(parseCell('TBD', WHEN, 'en-US', 'UTC').error).toMatch(/^Not a date and time/);
        expect(parseCell('10/1/2026 25:00', WHEN, 'en-US', 'UTC').error).toMatch(/^Not a date and time/);
    });
});
