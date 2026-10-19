/**
 * gridPendingLayout — a layout change the server has not confirmed yet, held
 * in this browser until it has. Plain functions (HR-25).
 *
 * WHY
 * A grid keeps each user's layout LAYOUT_DELAY_MS after the last change
 * (gridView). A change made just before the page reloads or closes could be
 * lost: the request to keep it is started as the page goes, and a browser
 * may drop a request a leaving page started. So the change is also held here
 * at once, and the next time the grid opens in this browser it is kept then.
 *
 * WHICH ONE WINS
 * A held change carries the layout the server was known to hold when it was
 * made (`base`). When the grid opens:
 *   - the server holds the held layout already: the request did arrive;
 *     the hold is let go;
 *   - the server still holds `base`: nothing has kept a layout since, so the
 *     held change is the user's latest and is used, and kept;
 *   - the server holds something else: a layout kept since, on another
 *     device or in another tab, is newer; the hold is let go.
 *
 * WHAT IS HELD
 * Only the layout: widths, Wrap or Clip, sort, grouping, chosen columns,
 * the chart. Never record data. Keyed by user and grid (and child table
 * tab), so two users of one browser never see each other's.
 *
 * A browser that keeps nothing (storage turned off, a private window) holds
 * nothing, and the grid works as it did before.
 */

const PREFIX = 'rowhouse.layout.';

function store() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/** Where a user's held layout of a grid (in a child table tab, or on its own) lives. */
export function pendingKey(userId, configName, parentLink) {
    return PREFIX + [userId || '', configName || '', parentLink || ''].join('.');
}

/** Hold a layout change: { json, base }, base the layout the server was known to hold. */
export function holdLayout(key, json, base) {
    if (!key || typeof json !== 'string') return false;
    try {
        const s = store();
        if (!s) return false;
        s.setItem(key, JSON.stringify({ json, base: typeof base === 'string' ? base : null }));
        return true;
    } catch {
        return false;
    }
}

/** The held change, { json, base }, or null. */
export function heldLayout(key) {
    try {
        const s = store();
        const text = s && key ? s.getItem(key) : null;
        if (!text) return null;
        const held = JSON.parse(text);
        if (!held || typeof held.json !== 'string') return null;
        return { json: held.json, base: typeof held.base === 'string' ? held.base : null };
    } catch {
        return null;
    }
}

/**
 * Let a held change go: only `json` when given, so a newer change held
 * since the request left is kept; everything held for the key without it.
 */
export function releaseLayout(key, json) {
    try {
        const s = store();
        if (!s || !key) return;
        if (json !== undefined) {
            const held = heldLayout(key);
            if (!held || held.json !== json) return;
        }
        s.removeItem(key);
    } catch {
        // Nothing held, or nothing can be: either way nothing to do.
    }
}

/**
 * The server has kept `json`. A held change that is `json` is let go; a
 * newer one held since stays, now known to sit on top of `json`, so it
 * still wins when the grid next opens.
 */
export function confirmLayout(key, json) {
    const held = heldLayout(key);
    if (!held) return;
    if (held.json === json) releaseLayout(key);
    else holdLayout(key, held.json, json);
}

/**
 * What to do with a held change when the grid opens with the server's
 * layout (`serverJson`, null for none): 'use' it, or 'release' it, or
 * nothing ('none') when nothing is held.
 */
export function decide(held, serverJson) {
    if (!held) return 'none';
    const server = typeof serverJson === 'string' && serverJson ? serverJson : null;
    if (held.json === server) return 'release';
    return held.base === server ? 'use' : 'release';
}
