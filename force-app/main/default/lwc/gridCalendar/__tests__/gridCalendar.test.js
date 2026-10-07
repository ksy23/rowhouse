/** The date editor's calendar arithmetic: ISO dates, UTC, no local-time shifts (TC-027, TC-028). */
import {
    parseIso,
    isoOf,
    daysInMonth,
    addDays,
    addMonths,
    weekday,
    startOfWeek,
    endOfWeek,
    monthWeeks,
    weekdayNames,
    monthName,
    longDate,
    todayIn,
    yearRange,
    firstDayFromSalesforce,
    FIRST_YEAR,
    LAST_YEAR
} from 'c/gridCalendar';

describe('gridCalendar', () => {
    it('reads ISO dates and refuses anything that is not a real day', () => {
        expect(parseIso('2026-09-30')).toEqual({ year: 2026, month: 9, day: 30 });
        expect(parseIso('2026-02-30')).toBeNull();
        expect(parseIso('2026-9-30')).toBeNull();
        expect(parseIso('')).toBeNull();
        expect(parseIso(null)).toBeNull();
        expect(isoOf(2026, 1, 5)).toBe('2026-01-05');
    });

    it('knows month lengths, leap years included', () => {
        expect(daysInMonth(2026, 2)).toBe(28);
        expect(daysInMonth(2028, 2)).toBe(29);
        expect(daysInMonth(2100, 2)).toBe(28);
        expect(daysInMonth(2026, 12)).toBe(31);
    });

    it('adds days across months, years and daylight-saving changes', () => {
        expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
        // US and EU clocks change on these dates; a UTC day is always 24 hours.
        expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
        expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
        expect(addDays('2026-11-01', 7)).toBe('2026-11-08');
    });

    it('adds months, keeping the day or the month’s last day', () => {
        expect(addMonths('2026-09-30', 1)).toBe('2026-10-30');
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
        expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
        expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
        expect(addMonths('2026-09-30', -12)).toBe('2025-09-30');
        expect(addMonths('not a date', 1)).toBe('not a date');
    });

    it('finds the week’s first and last day from either start of the week', () => {
        expect(weekday('2026-09-30')).toBe(3); // a Wednesday
        expect(startOfWeek('2026-09-30', 0)).toBe('2026-09-27');
        expect(endOfWeek('2026-09-30', 0)).toBe('2026-10-03');
        expect(startOfWeek('2026-09-30', 1)).toBe('2026-09-28');
        expect(endOfWeek('2026-09-27', 1)).toBe('2026-09-27'); // a Sunday ends a Monday week
    });

    it('lays out a month as six weeks of seven days', () => {
        const weeks = monthWeeks(2026, 9, 0);
        expect(weeks).toHaveLength(6);
        weeks.forEach(w => expect(w).toHaveLength(7));
        expect(weeks[0][0]).toEqual({ iso: '2026-08-30', day: 30, inMonth: false });
        expect(weeks[0][2]).toEqual({ iso: '2026-09-01', day: 1, inMonth: true });
        expect(weeks[5][6].iso).toBe('2026-10-10');
        expect(monthWeeks(2026, 9, 1)[0][0].iso).toBe('2026-08-31');
        // February 2026 starts on a Sunday: its first week is its own.
        expect(monthWeeks(2026, 2, 0)[0][0].iso).toBe('2026-02-01');
    });

    it('names weekdays and months in the locale, from the first day of the week', () => {
        expect(weekdayNames('en-US', 0).map(d => d.short)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(weekdayNames('en-US', 1)[0]).toEqual({ short: 'Mon', long: 'Monday' });
        expect(weekdayNames('fr-FR', 1)[0].long).toBe('lundi');
        expect(monthName('en-US', 2026, 9)).toBe('September');
        expect(monthName('de-DE', 2026, 3)).toBe('März');
        expect(longDate('en-US', '2026-09-30')).toBe('Wednesday, September 30, 2026');
    });

    it('says what day it is in the user’s timezone, not the browser’s', () => {
        const instant = new Date('2026-10-01T05:00:00Z'); // 10pm on 30 Sep in California
        expect(todayIn('America/Los_Angeles', instant)).toBe('2026-09-30');
        expect(todayIn('Europe/Berlin', instant)).toBe('2026-10-01');
    });

    it('offers years from 1900 to 2100, widened to reach a date outside them', () => {
        const years = yearRange(2026);
        expect(years[0]).toBe(FIRST_YEAR);
        expect(years[years.length - 1]).toBe(LAST_YEAR);
        expect(yearRange(1850)[0]).toBe(1850);
        expect(yearRange(2150).slice(-1)[0]).toBe(2150);
    });

    it('turns Salesforce’s first day of the week (1 for Sunday) into JavaScript’s (0 for Sunday)', () => {
        expect(firstDayFromSalesforce(1)).toBe(0); // en_US in Lightning Experience
        expect(firstDayFromSalesforce(2)).toBe(1); // Monday
        expect(firstDayFromSalesforce(7)).toBe(6);
        expect(firstDayFromSalesforce(0)).toBe(0); // the Jest stand-in
        expect(firstDayFromSalesforce(undefined)).toBe(0);
        expect(firstDayFromSalesforce('2')).toBe(1);
    });
});
