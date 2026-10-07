/**
 * gridNest — the arithmetic of child tables under rows. No DOM, no
 * state: gridTable calls these with what it has.
 *
 * An open row is followed in the view by a DETAIL item, a row of its own that
 * holds the row's tabs of related records. Record rows and group rows are all
 * one height (rowHeight, measured); a detail row's height is its content's,
 * up to a maximum fixed by the level of its table (detailHeight), and is known
 * before the row is drawn (panelHeightFor). So a row's top is still
 * arithmetic, not a measurement of the rows around it: its index times the row
 * height, plus the extra height of every detail row above it. That keeps the
 * windowing exact with the tables open, as it was without them.
 *
 * HEIGHTS, NESTED
 * A child grid scrolls inside its parent's panel: its box is the panel less
 * PANEL_CHROME (childTableHeight). A level-2 table's own panels must then fit
 * in that box with its header and a row to spare, or a level-3 grid is cut
 * off below the fold; with one fixed height, a 420px panel inside a 240px box
 * was. Hence two heights: 540px
 * under a top-level row, whose child grid gets 388px; 320px under a level-2
 * row, whose grid gets 168px, a header and four rows.
 */

/** px: an open row's panel, under a row of a top-level table. */
export const DETAIL_HEIGHT = 540;
/** px: an open row's panel, under a row of a level-2 table. */
export const NESTED_DETAIL_HEIGHT = 320;
/**
 * px: what a panel takes before its child grid's rows: its padding, the tabs,
 * and the child grid's own header with its toolbar (measured in Lightning
 * Experience: 419px of panel, 240px of scroller, 28px spare).
 */
export const PANEL_CHROME = 152;

/** px: the height of an open row's panel in a table at `level` (1, 2 or 3). */
export function detailHeight(level) {
    return Number(level) >= 2 ? NESTED_DETAIL_HEIGHT : DETAIL_HEIGHT;
}

/**
 * px: a child grid's scrolling box, for a grid at `level` (2 or 3): the
 * Height the admin gave its tab, or else its parent's panel, less the
 * chrome.
 */
export function childTableHeight(level, height) {
    const own = Number(height);
    if (Number.isFinite(own) && own > 0) return own;
    return detailHeight(Number(level) - 1) - PANEL_CHROME;
}

/**
 * px: the most an open row's panel may be, in a table at `level` whose tabs
 * are `tabs`: the level's height (detailHeight), or, when the admin gave a tab
 * a Height, the tallest tab's grid and the panel's chrome round it. The
 * panel is still sized to what it holds, up to this (panelHeightFor).
 */
export function panelMax(level, tabs) {
    const heights = (Array.isArray(tabs) ? tabs : []).map(t => Number(t && t.height)).filter(h => Number.isFinite(h) && h > 0);
    return heights.length ? Math.max(...heights) + PANEL_CHROME : detailHeight(level);
}

const DETAIL_PREFIX = 'rh-detail:';

/** The id of the detail row under record `rowId`. Record-derived, so a stable key (HR-19). */
export function detailId(rowId) {
    return DETAIL_PREFIX + rowId;
}

/**
 * The view with a detail item after each open record: { items, detailRows },
 * detailRows being the detail items' positions, in order. Group rows and
 * records not open are left as they are. A detail item is
 * { [keyField]: detailId(id), __detail: { rowId, row } }.
 */
export function withDetails(view, expanded, keyField = 'Id') {
    const open = expanded || {};
    if (!Object.keys(open).length) return { items: view, detailRows: [] };
    const items = [];
    const detailRows = [];
    view.forEach(row => {
        items.push(row);
        if (row.__group || row.__detail) return;
        const id = String(row[keyField]);
        if (!open[id]) return;
        detailRows.push(items.length);
        items.push({ [keyField]: detailId(id), __detail: { rowId: id, row } });
    });
    return { items, detailRows };
}

/** How many of the sorted positions are below `index` (a binary search). */
function countBefore(sorted, index) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < index) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * px from the top of the first row to the top of row `index` (0-based).
 * `panelHeight` is one height for every panel, or a list with one height per
 * detail row, in the order of `detailRows` (each panel is sized to its
 * content, up to its level's maximum).
 */
export function rowTop(index, rowHeight, detailRows = [], panelHeight = DETAIL_HEIGHT) {
    const above = countBefore(detailRows, index);
    if (!Array.isArray(panelHeight)) return index * rowHeight + above * (panelHeight - rowHeight);
    let extra = 0;
    for (let i = 0; i < above; i++) extra += (Number(panelHeight[i]) || DETAIL_HEIGHT) - rowHeight;
    return index * rowHeight + extra;
}

/** px: the smallest panel, whatever its content (the tabs and a message). */
export const MIN_PANEL_HEIGHT = 120;
/** px: a panel's own padding (0.5rem above and below) and its row's 1px border, round its content. */
export const PANEL_PADDING = 17;

/**
 * px: an open row's detail row, sized to what its panel holds: the
 * measured content and the panel's padding, clamped between MIN_PANEL_HEIGHT
 * and the panel's maximum: the level's, or panelMax's when the admin gave a
 * tab a Height. Until the content is measured (null), the maximum, as
 * before.
 */
export function panelHeightFor(contentHeight, level, max = detailHeight(level)) {
    const content = Number(contentHeight);
    if (!Number.isFinite(content) || content <= 0) return max;
    return Math.max(MIN_PANEL_HEIGHT, Math.min(max, Math.ceil(content + PANEL_PADDING)));
}

/**
 * The row at `px` from the top of the first row: the last of `count` rows
 * whose top is at or above it. 0 for a negative offset, count - 1 past the end.
 */
export function rowAt(px, count, rowHeight, detailRows = [], panelHeight = DETAIL_HEIGHT) {
    if (count <= 0) return 0;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rowTop(mid, rowHeight, detailRows, panelHeight) <= px) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}
