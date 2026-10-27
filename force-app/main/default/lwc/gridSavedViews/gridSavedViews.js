/**
 * gridSavedViews — saved views, as plain functions: no DOM, no events, no
 * state (HR-25). gridView keeps the views' state; the server keeps the views
 * (GridController.listViews, saveView and the rest; GridViews.cls) and checks
 * everything in them again.
 *
 * A VIEW, AS SAVED (Grid View's View field, JSON, version 1)
 *   { v: 1, columns, frozen, grouping, groups, sort, filters, logic, charts }
 *   columns   the columns shown and their order ({ order, hidden }), or none
 *             for the admin's
 *   frozen    the columns frozen, or none for the admin's
 *   grouping  [{ field, unit }], [] for none
 *   groups    the groups' order and percentages, when not the default
 *   sort      [{ field, direction }]: the sort it opens with
 *   filters   [{ field, operator, value, valueTo }], logic "1 AND (2 OR 3)"
 *   charts    a list of one chart, with whether its panel is open, or []:
 *             a list, so named charts can come later without a new field
 *
 * WHAT IS EACH USER'S OWN (their Grid User Layout of the grid, with the
 * admin's grid's own layout)
 *   pin       the view this grid opens on for them (none: the admin's grid)
 *   recent    the views they opened last, newest first ('' is the admin's grid)
 *   views     { [viewId]: { sort, draft } }: how they last sorted each view,
 *             and a change to it they have not saved
 * Widths, Wrap or Clip and the rows opened are theirs across every view.
 */
import { parseLogic, canFilter, MAX_FILTERS } from 'c/gridFilters';

export const VIEW_VERSION = 1;
/** The picker's Recent Views. */
export const MAX_RECENT = 5;
/** Views whose sort or unsaved change one layout keeps. */
export const MAX_VIEW_STATES = 20;
/** The admin's grid, in a list of views (recent). */
export const ADMIN_VIEW = '';
/** Characters a view's name may have: GridViews.MAX_NAME. */
export const MAX_NAME = 80;
/** Who sees a view, as the server names it. */
export const ONLY_ME = 'me';
export const ALL_USERS = 'all';
export const WITH_GROUPS = 'groups';

const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * What a view keeps, from the grid as it is now: { columnChoice, frozen,
 * grouping, groupView, sort, filters, logic, chart, chartsOpen }. A plain
 * object, ready for JSON.
 */
export function viewFrom(state) {
    const s = state || {};
    const view = { v: VIEW_VERSION };
    if (s.columnChoice) view.columns = s.columnChoice;
    if (Number.isInteger(s.frozen)) view.frozen = s.frozen;
    view.grouping = Array.isArray(s.grouping) ? s.grouping.map(g => ({ field: g.field, unit: g.unit || null })) : [];
    const gv = s.groupView;
    if (gv && ((gv.order && gv.order.by && gv.order.by !== 'name') || gv.percent === true))
        view.groups = { order: gv.order || null, percent: gv.percent === true };
    view.sort = Array.isArray(s.sort) ? s.sort.map(k => ({ field: k.field, direction: k.direction })) : [];
    view.filters = Array.isArray(s.filters)
        ? s.filters.map(f => ({
              field: f.field,
              operator: f.operator,
              value: f.value === undefined ? null : f.value,
              valueTo: f.valueTo === undefined ? null : f.valueTo
          }))
        : [];
    if (s.logic && view.filters.length) view.logic = s.logic;
    view.charts = s.chart ? [{ ...s.chart, open: s.chartsOpen === true }] : [];
    return view;
}

/** A view as it was saved: a JSON object, or null when the text is not one. */
export function parseView(json) {
    if (isObject(json)) return json;
    try {
        const v = typeof json === 'string' && json ? JSON.parse(json) : null;
        return isObject(v) ? v : null;
    } catch {
        return null;
    }
}

/**
 * The parts of a saved view a layout reader takes (gridView readLayout): its
 * sort, grouping, columns, frozen columns, groups and its first chart.
 */
export function asLayout(view) {
    const v = parseView(view) || {};
    const chart = Array.isArray(v.charts) && isObject(v.charts[0]) ? v.charts[0] : null;
    const out = {};
    if (Array.isArray(v.sort)) out.sort = v.sort;
    out.grouping = Array.isArray(v.grouping) ? v.grouping : [];
    if (v.columns) out.columns = v.columns;
    if (Number.isInteger(v.frozen)) out.frozen = v.frozen;
    if (isObject(v.groups)) out.groups = v.groups;
    if (chart) out.chart = chart;
    return out;
}

/**
 * A saved view's filters that still fit the grid: each on a column this user
 * can filter by, at most MAX_FILTERS; and its filter logic, when every
 * filter is left and it can be read. { filters, logic }.
 */
export function filtersOf(view, columns) {
    const v = parseView(view) || {};
    const byField = new Map((Array.isArray(columns) ? columns : []).map(c => [c.field, c]));
    const raw = Array.isArray(v.filters) ? v.filters.filter(isObject).slice(0, MAX_FILTERS) : [];
    const filters = raw
        .filter(f => typeof f.field === 'string' && typeof f.operator === 'string' && canFilter(byField.get(f.field)))
        .map(f => ({
            field: f.field,
            operator: f.operator,
            value: f.value === undefined ? null : f.value,
            valueTo: f.valueTo === undefined ? null : f.valueTo
        }));
    const read = filters.length === raw.length ? parseLogic(v.logic, filters.length) : { logic: '' };
    return { filters, logic: read.logic || '' };
}

/** The parts of a view that say what it is; the sort and the chart panel's being open are each user's own. */
function definition(view) {
    const v = view || {};
    const chart = Array.isArray(v.charts) && v.charts[0] ? { ...v.charts[0] } : null;
    if (chart) delete chart.open;
    return {
        columns: JSON.stringify(v.columns || null) + JSON.stringify(Number.isInteger(v.frozen) ? v.frozen : null),
        grouping: JSON.stringify(v.grouping || []) + JSON.stringify(v.groups || null),
        filters: JSON.stringify(v.filters || []) + JSON.stringify(v.logic || ''),
        chart: JSON.stringify(chart)
    };
}

/** What differs between two views (viewFrom), in this order: columns, grouping, filters, chart. */
export function changesBetween(saved, now) {
    const a = definition(saved);
    const b = definition(now);
    return ['columns', 'grouping', 'filters', 'chart'].filter(k => a[k] !== b[k]);
}

const CHANGE_WORDS = { columns: 'the columns', grouping: 'the grouping', filters: 'the filters', chart: 'the chart' };

/** "the filters and the grouping": what changed, for "You changed this view: …". */
export function changedText(parts) {
    const words = (parts || []).map(p => CHANGE_WORDS[p]).filter(Boolean);
    if (words.length <= 1) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

// ------------------------------------------------------------ each user's own

/** The views part of a layout, read back: { pin, recent, views }. */
export function viewStore(layout) {
    const l = isObject(layout) ? layout : {};
    const pin = typeof l.pin === 'string' && l.pin ? l.pin : null;
    const recent = Array.isArray(l.recent) ? l.recent.filter(id => typeof id === 'string').slice(0, MAX_RECENT) : [];
    const views = {};
    if (isObject(l.views)) {
        Object.keys(l.views).forEach(id => {
            if (isObject(l.views[id])) views[id] = l.views[id];
        });
    }
    return { pin, recent, views };
}

/** The views opened last, newest first, with this one first. */
export function withRecent(recent, id) {
    const list = Array.isArray(recent) ? recent : [];
    return [id, ...list.filter(r => r !== id)].slice(0, MAX_RECENT);
}

/**
 * The per-view part of the layout with one view's own sort and unsaved
 * change set (null for none), most recently set last, at most
 * MAX_VIEW_STATES views; a view with neither is left out.
 */
export function withViewState(views, id, state) {
    const out = {};
    Object.keys(isObject(views) ? views : {}).forEach(key => {
        if (key !== id) out[key] = views[key];
    });
    const s = {};
    if (state && Array.isArray(state.sort)) s.sort = state.sort;
    if (state && isObject(state.draft)) s.draft = state.draft;
    if (Object.keys(s).length) out[id] = s;
    const keys = Object.keys(out);
    keys.slice(0, Math.max(0, keys.length - MAX_VIEW_STATES)).forEach(key => delete out[key]);
    return out;
}

/** The per-view part without any view not in this list of Ids (deleted, or no longer shared). */
export function onlyViews(views, ids) {
    const keep = new Set(ids || []);
    const out = {};
    Object.keys(isObject(views) ? views : {}).forEach(key => {
        if (keep.has(key)) out[key] = views[key];
    });
    return out;
}

// ------------------------------------------------------------ the picker

/**
 * The view picker's lists, as a list view's: Recent Views (the views opened
 * last, the one shown among them) and All Other Views, A to Z. The admin's
 * grid is a view like the others, under the grid's title. A search narrows
 * both to names that contain it. { recent: [item], others: [item] }; an item
 * is { key, id, label, current, pinned, mine, owner }.
 */
export function pickerItems({ views, recent, currentId, pinId, gridTitle, term }) {
    const all = [{ id: ADMIN_VIEW, name: gridTitle || 'Records', mine: false, ownerName: null }].concat(
        Array.isArray(views) ? views : []
    );
    const current = currentId || ADMIN_VIEW;
    const pinned = pinId || ADMIN_VIEW;
    const byId = new Map(all.map(v => [v.id, v]));
    const needle = (term || '').trim().toLowerCase();
    const fits = v =>
        !needle ||
        String(v.name || '')
            .toLowerCase()
            .includes(needle);
    const item = v => ({
        key: 'v:' + (v.id || 'grid'),
        id: v.id,
        label: v.name,
        current: v.id === current,
        pinned: v.id === pinned,
        mine: v.mine === true,
        owner: v.mine === true ? null : v.ownerName || null
    });
    const recentIds = withRecent(
        (recent || []).filter(id => byId.has(id)),
        current
    ).filter(id => byId.has(id));
    const inRecent = new Set(recentIds);
    const recentItems = recentIds
        .map(id => byId.get(id))
        .filter(fits)
        .map(item);
    const others = all
        .filter(v => !inRecent.has(v.id) && fits(v))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(item);
    return { recent: recentItems, others };
}

// ------------------------------------------------------------ sharing

/** "Only the owner", "All users", or "2 groups: Sales New England, Sales Managers": the Grid Admin tab's Who sees it. */
export function whoSees(view) {
    if (!view || view.sharing === ALL_USERS) return view ? 'All users' : '';
    const groups = Array.isArray(view.groups) ? view.groups : [];
    if (view.sharing !== WITH_GROUPS || !groups.length) return 'Only the owner';
    return `${groups.length} ${groups.length === 1 ? 'group' : 'groups'}: ${groups.map(g => g.name).join(', ')}`;
}

/** A clone's name, as Salesforce names a cloned list view: "Copy of Closing this quarter", cut to fit. */
export function copyName(name) {
    return ('Copy of ' + (name || '')).slice(0, MAX_NAME).trim();
}
