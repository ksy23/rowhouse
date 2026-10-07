/**
 * gridCalendar — the date arithmetic behind the date editor's calendar
 * (c/cellDate). Pure functions, no DOM.
 *
 * A Date field has no time and no timezone (TC-027, TC-028), so a date is the
 * ISO string "YYYY-MM-DD" here from end to end. Arithmetic uses UTC Date
 * objects, which have no daylight-saving jumps, and never the browser's
 * local time, which is what shifts a date by a day.
 *
 * Weekdays are numbered here as JavaScript does, 0 for Sunday. Salesforce
 * counts them from 1 for Sunday, as Java does: Lightning Experience's
 * $Locale.firstDayOfWeek is 1 for en_US, and 2 where
 * weeks start on Monday. firstDayFromSalesforce converts. The Jest stand-in
 * for @salesforce/i18n/firstDayOfWeek is 0, which is taken as Sunday too.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A known Sunday, for weekday names: 27 Sep 2026. */
const A_SUNDAY = Date.UTC(2026, 8, 27);
/** The years the calendar's year list offers, at least. */
export const FIRST_YEAR = 1900;
export const LAST_YEAR = 2100;

const pad = n => String(n).padStart(2, '0');

/** Salesforce's first day of the week (1 for Sunday to 7) as JavaScript's (0 for Sunday). */
export function firstDayFromSalesforce(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 7 ? n - 1 : 0;
}

// Intl formatters are slow to make and the calendar asks for dozens per
// redraw, so each is made once per locale and kind.
const formatters = new Map();
function formatter(locale, kind, options) {
    const key = `${locale}|${kind}`;
    let f = formatters.get(key);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
        } catch {
            f = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
        }
        formatters.set(key, f);
    }
    return f;
}

/** { year, month (1-12), day } for an ISO date, or null for anything else. */
export function parseIso(iso) {
    const m = ISO_RE.exec(String(iso || ''));
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return { year, month, day };
}

export function isoOf(year, month, day) {
    return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function fromUtc(ms) {
    const d = new Date(ms);
    return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function toUtc(iso) {
    const p = parseIso(iso);
    return p ? Date.UTC(p.year, p.month - 1, p.day) : NaN;
}

export function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The date `n` days on (or back, for a negative n). */
export function addDays(iso, n) {
    return fromUtc(toUtc(iso) + n * 86400000);
}

/**
 * The same day `n` months on, or the month's last day when it is shorter:
 * 31 January plus one month is 28 (or 29) February, as a calendar's Page Down
 * does.
 */
export function addMonths(iso, n) {
    const p = parseIso(iso);
    if (!p) return iso;
    const index = p.year * 12 + (p.month - 1) + n;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return isoOf(year, month, Math.min(p.day, daysInMonth(year, month)));
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(iso) {
    return new Date(toUtc(iso)).getUTCDay();
}

/** The first day of the week `iso` is in, the week starting on `firstDay`. */
export function startOfWeek(iso, firstDay = 0) {
    return addDays(iso, -((weekday(iso) - firstDay + 7) % 7));
}

export function endOfWeek(iso, firstDay = 0) {
    return addDays(startOfWeek(iso, firstDay), 6);
}

/**
 * The six weeks a month's calendar shows, each seven days:
 * [[{ iso, day, inMonth }]]. Always six, so the calendar never changes
 * height from one month to the next.
 */
export function monthWeeks(year, month, firstDay = 0) {
    let day = startOfWeek(isoOf(year, month, 1), firstDay);
    const weeks = [];
    for (let w = 0; w < 6; w++) {
        const week = [];
        for (let i = 0; i < 7; i++) {
            const p = parseIso(day);
            week.push({ iso: day, day: p.day, inMonth: p.month === month && p.year === year });
            day = addDays(day, 1);
        }
        weeks.push(week);
    }
    return weeks;
}

/** The weekdays in order from `firstDay`: [{ short, long }], in the locale's words. */
export function weekdayNames(locale, firstDay = 0) {
    const short = formatter(locale, 'weekday-short', { weekday: 'short' });
    const long = formatter(locale, 'weekday-long', { weekday: 'long' });
    const out = [];
    for (let i = 0; i < 7; i++) {
        const at = new Date(A_SUNDAY + ((firstDay + i) % 7) * 86400000);
        out.push({ short: short.format(at), long: long.format(at) });
    }
    return out;
}

/** The month's name in the locale's words: "September". */
export function monthName(locale, year, month) {
    return formatter(locale, 'month', { month: 'long' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** A date read aloud: "Wednesday, September 30, 2026". */
export function longDate(locale, iso) {
    return formatter(locale, 'long', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(
        new Date(toUtc(iso))
    );
}

/** Today in a timezone (the user's Salesforce one), as an ISO date. */
export function todayIn(timeZone, now = new Date()) {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        }).formatToParts(now);
    } catch {
        parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(
            now
        );
    }
    const get = type => Number((parts.find(p => p.type === type) || {}).value);
    return isoOf(get('year'), get('month'), get('day'));
}

/** The years the year list offers: FIRST_YEAR to LAST_YEAR, widened to include `year`. */
export function yearRange(year) {
    const from = Math.min(FIRST_YEAR, year);
    const to = Math.max(LAST_YEAR, year);
    const out = [];
    for (let y = from; y <= to; y++) out.push(y);
    return out;
}

// ================================================================ times
//
// A Time field has no time zone: "17:30:00.000Z" is half past five whoever
// looks, the Z notwithstanding (Salesforce writes it so). A Date/Time is an
// instant, shown and edited in the user's SALESFORCE time zone, which need not
// be the computer's: the conversions below take the zone as an argument and
// never use the browser's own.

const TIME_RE = /^\s*(\d{1,2})(?:[:.](\d{2}))?(?:[:.](\d{2})(?:\.\d{1,3})?)?\s*([aApP])?\.?\s*(?:[mM]\.?)?\s*Z?\s*$/;

/**
 * A time typed or pasted, as { hour, minute, second }, or null: "17:30",
 * "17:30:15", "5:30 PM", "5:30pm", "5pm", "17:30:00.000Z". Without AM or PM a
 * number of hours is read on the 24-hour clock.
 */
export function parseTimeText(text) {
    const m = TIME_RE.exec(String(text == null ? '' : text));
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    const second = m[3] === undefined ? 0 : Number(m[3]);
    const half = m[4] ? m[4].toLowerCase() : null;
    if (half) {
        if (hour < 1 || hour > 12) return null;
        if (half === 'a' && hour === 12) hour = 0;
        if (half === 'p' && hour < 12) hour += 12;
    }
    if (hour > 23 || minute > 59 || second > 59) return null;
    return { hour, minute, second };
}

/** A time of day as Salesforce writes a Time: "17:30:00.000Z". */
export function timeValue({ hour, minute, second = 0 }) {
    return `${pad(hour)}:${pad(minute)}:${pad(second)}.000Z`;
}

/** A time of day in the locale's words: "5:30 PM", "17:30". */
export function formatTimeOfDay(locale, { hour, minute }) {
    return formatter(locale, 'time', { hour: 'numeric', minute: '2-digit' }).format(
        new Date(Date.UTC(1970, 0, 1, hour, minute))
    );
}

/** The times a time list offers, every `step` minutes from midnight: [{ value: "HH:MM", hour, minute, label }]. */
export function timeOptions(locale, step = 30) {
    const out = [];
    for (let t = 0; t < 24 * 60; t += step) {
        const hour = Math.floor(t / 60);
        const minute = t % 60;
        out.push({
            value: `${pad(hour)}:${pad(minute)}`,
            hour,
            minute,
            label: formatTimeOfDay(locale, { hour, minute })
        });
    }
    return out;
}

const zoneFormats = new Map();
function zoneFormat(timeZone) {
    let f = zoneFormats.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        zoneFormats.set(timeZone, f);
    }
    return f;
}

/** The wall clock in a time zone at an instant (ms): { date: ISO date, hour, minute, second }. */
export function wallClock(ms, timeZone) {
    const parts = {};
    zoneFormat(timeZone)
        .formatToParts(new Date(ms))
        .forEach(p => {
            parts[p.type] = p.value;
        });
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second)
    };
}

/**
 * An instant (ISO, in UTC) as the wall clock shows it in a time zone, or
 * null when it is not an instant.
 */
export function instantToZoned(iso, timeZone) {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : wallClock(ms, timeZone);
}

/**
 * The instant at which the wall clock in a time zone shows this date and
 * time, as ISO in UTC ("2026-10-01T00:30:00.000Z"), or null for a date that
 * is not one. In the hour a clock skips (spring forward) the time is taken
 * an hour on; in the hour it repeats, the first of the two.
 */
export function zonedToInstant(dateIso, { hour, minute, second = 0 }, timeZone) {
    const p = parseIso(dateIso);
    if (!p) return null;
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, second);
    const offsetAt = ms => {
        const w = wallClock(ms, timeZone);
        const q = parseIso(w.date);
        return Date.UTC(q.year, q.month - 1, q.day, w.hour, w.minute, w.second) - ms;
    };
    // The offsets a day either side: the same on most days; on a day the
    // clocks change, the one before and the one after.
    const day = 24 * 60 * 60 * 1000;
    const candidates = [asUtc - offsetAt(asUtc - day), asUtc - offsetAt(asUtc + day)];
    const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    const shows = ms => {
        const w = wallClock(ms, timeZone);
        return w.date === date && w.hour === hour && w.minute === minute && w.second === second;
    };
    const real = candidates.filter(shows);
    // A time the clock shows twice: the first. A time it skips: the old
    // offset, which is the same time an hour on.
    const at = real.length ? Math.min(...real) : Math.max(...candidates);
    return new Date(at).toISOString();
}
