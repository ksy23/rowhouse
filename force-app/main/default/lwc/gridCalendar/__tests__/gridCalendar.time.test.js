/**
 * Times of day and the wall clock in a time zone: what the time and
 * date/time editors, paste and import read and write.
 */
import { parseTimeText, timeValue, formatTimeOfDay, timeOptions, wallClock, instantToZoned, zonedToInstant } from 'c/gridCalendar';

describe('a time of day', () => {
    it('reads 24-hour and 12-hour times, with or without minutes and seconds', () => {
        expect(parseTimeText('17:30')).toEqual({ hour: 17, minute: 30, second: 0 });
        expect(parseTimeText('5:30 PM')).toEqual({ hour: 17, minute: 30, second: 0 });
        expect(parseTimeText('5pm')).toEqual({ hour: 17, minute: 0, second: 0 });
        expect(parseTimeText('12 am')).toEqual({ hour: 0, minute: 0, second: 0 });
        expect(parseTimeText('12:15 p.m.')).toEqual({ hour: 12, minute: 15, second: 0 });
        expect(parseTimeText('08.05')).toEqual({ hour: 8, minute: 5, second: 0 });
        // As Salesforce sends a Time, and as lightning-input gives one.
        expect(parseTimeText('17:30:15.000Z')).toEqual({ hour: 17, minute: 30, second: 15 });
        expect(parseTimeText('13:30:00.000')).toEqual({ hour: 13, minute: 30, second: 0 });
    });

    it('refuses what is not a time', () => {
        ['24:00', '13 pm', '0 am', '7:60', '', 'noon', '5:3'].forEach(t => expect(parseTimeText(t)).toBeNull());
    });

    it('writes a time as Salesforce stores one, and shows it in the locale', () => {
        expect(timeValue({ hour: 7, minute: 5 })).toBe('07:05:00.000Z');
        expect(timeValue({ hour: 23, minute: 59, second: 9 })).toBe('23:59:09.000Z');
        expect(formatTimeOfDay('en-US', { hour: 17, minute: 30 })).toMatch(/^5:30\sPM$/);
        expect(formatTimeOfDay('en-GB', { hour: 17, minute: 30 })).toBe('17:30');
    });

    it('offers a time every half hour by default', () => {
        const options = timeOptions('en-US');
        expect(options).toHaveLength(48);
        expect(options[0]).toMatchObject({ value: '00:00', hour: 0, minute: 0 });
        expect(options[35]).toMatchObject({ value: '17:30', hour: 17, minute: 30 });
        expect(timeOptions('en-US', 15)).toHaveLength(96);
    });
});

describe('the wall clock in a time zone', () => {
    it('reads an instant as the clock there shows it', () => {
        expect(wallClock(Date.parse('2026-10-01T00:30:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-10-01', hour: 6, minute: 0, second: 0 });
        expect(instantToZoned('2026-02-01T04:30:00.000Z', 'America/New_York')).toEqual({ date: '2026-01-31', hour: 23, minute: 30, second: 0 });
        expect(instantToZoned('not a date', 'UTC')).toBeNull();
    });

    it('finds the instant a wall clock shows, on ordinary days', () => {
        expect(zonedToInstant('2026-10-01', { hour: 6, minute: 0 }, 'Asia/Kolkata')).toBe('2026-10-01T00:30:00.000Z');
        expect(zonedToInstant('2026-07-04', { hour: 9, minute: 15 }, 'America/New_York')).toBe('2026-07-04T13:15:00.000Z');
        expect(zonedToInstant('2026-01-15', { hour: 9, minute: 15 }, 'America/New_York')).toBe('2026-01-15T14:15:00.000Z');
        // Chatham's offset has 45 minutes in it.
        expect(zonedToInstant('2026-10-01', { hour: 0, minute: 15 }, 'Pacific/Chatham')).toBe('2026-09-30T10:30:00.000Z');
        expect(zonedToInstant('2026-02-30', { hour: 1, minute: 0 }, 'UTC')).toBeNull();
    });

    it('takes a time the clock skips (spring forward) as the same time an hour on, east or west', () => {
        // 2:30 AM never happens in New York on 8 March 2026: it is 3:30 AM EDT.
        expect(zonedToInstant('2026-03-08', { hour: 2, minute: 30 }, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
        // Nor in Berlin on 29 March 2026: 3:30 AM CEST.
        expect(zonedToInstant('2026-03-29', { hour: 2, minute: 30 }, 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z');
    });

    it('takes a time the clock shows twice (fall back) as the first of the two, east or west', () => {
        expect(zonedToInstant('2026-11-01', { hour: 1, minute: 30 }, 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
        expect(zonedToInstant('2026-10-25', { hour: 2, minute: 30 }, 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z');
    });
});
