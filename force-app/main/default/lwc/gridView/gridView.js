/**
 * gridView — one grid: it owns the data; gridTable owns the rendering. gridApp,
 * the exposed component, shows one; a child table under a row is another.
 *
 * What it does, in order:
 *   1. opens the grid with one call (GridController.openGrid): its
 *      configuration — only the columns this user can read, with editing
 *      already narrowed by FLS — this user's layout, and the first page of
 *      rows, sorted and grouped as the layout says;
 *   2. loads the rest page by page through the server's cursor until everything
 *      is loaded or PRELOAD_ROWS is reached, then one more page at a time as
 *      the user scrolls towards the end (loadmore from the table), up to
 *      MAX_LOADED_ROWS;
 *   3. keeps uncommitted edits as plain drafts (gridEditState) and hands the
 *      table a NEW config object whenever anything changes (HR-17);
 *   4. saves: one call validates and queues the batches, then it polls until
 *      every batch has reported, re-reads the saved rows, and shows errors at
 *      cell level where the server named a field, row level where it did not.
 *
 * INPUTS
 *   configName — the DeveloperName of a Grid Configuration record. The title
 *   is the configuration's label; everything else (object, columns, sort,
 *   editing, export) comes from the configuration on the server. The client
 *   never names fields or objects.
 *   parent — for a child table only: { link, id, name, level }, the
 *   Grid Child Table it is shown in, the parent record and its name, and how
 *   deep it is (2 or 3). The server checks the link and filters by the parent.
 *   recordId — the record whose page a top-level grid is on, from
 *   gridApp; empty elsewhere.
 *   gridApp's public members are configName and recordId (HR-2); gridView is not exposed, so parent is not a permanent public input.
 *
 * CHILD TABLES
 * A configuration may list tabs of related records (its children). The table
 * shows a toggle on each row; an open row shows a panel with a tab per child,
 * each a gridView of its own, limited to that row's records. Rows, counts,
 * subtotals and import all go to the server with the parent; a child grid
 * saves, deletes and exports like any other. Nesting stops at MAX_LEVELS: the
 * third level's rows have no toggle.
 *
 * UNDO AND REDO
 * Every change the user makes before saving (a typed cell, a paste, a
 * fill-down, a clear) is one step in c/gridHistory. The table asks for undo
 * and redo with the spreadsheet keys; the header has buttons for the same.
 * Save and Cancel clear the history: saved values belong to the record now.
 *
 * LOADING MORE AS YOU SCROLL
 * The server opens one cursor per query and hands it over as a token with the
 * page locator; every later page, preloaded or scrolled to, hands both back,
 * so the org pays for the query once however far the user scrolls. The table
 * asks for more when its window comes near the end of the loaded rows, when
 * the keyboard reaches the last row, or from its Load more button.
 *
 * SORTING AND SEARCH
 * When every row is loaded, sorting happens in the table, instantly and on all
 * keys. When only some are loaded, they are not the whole answer, so a sort
 * change re-queries the server on its primary key.
 * Quick search always runs on the server, where the term is a bind variable
 * with LIKE wildcards escaped (TC-021).
 *
 * MASS UPDATE AND MASS DELETE
 * Row selection is on when the grid has an editable column or allows mass
 * delete. "Update field" opens c/gridUpdateField; its value becomes unsaved
 * edits on the selected rows, one undo step, exactly like a paste, and is
 * written only by Save, through the same server checks. "Delete" asks first
 * (c/gridDeleteDialog), then sends the selected Ids in batches of DELETE_BATCH;
 * the server refuses unless the configuration allows it and the user may
 * delete the object, deletes what it can, and says why for the rest. Deleted
 * rows leave the grid and go to the Recycle Bin. A reload or a delete clears
 * the selection (selectionKey).
 *
 * UNDO A DELETE, AND EVERY MATCHING RECORD
 * After a delete a bar under the header says what was deleted and offers
 * Undo, which puts those records back from the Recycle Bin
 * (GridController.restoreRows, DELETE_BATCH at a time) and reloads. It stays
 * until it is used, closed, or replaced by the next delete. With every loaded
 * row selected and more records matching on the server, the selection bar
 * offers "Select all N matching records" (up to MAX_DELETE_ALL); Delete then
 * deletes every record the search and filters match: the server lists them a
 * slice at a time (GridController.matchingIds) and each slice is deleted as
 * above. Update field and the actions stay with the loaded rows.
 *
 * IMPORT
 * With Allow Import on the configuration, the toolbar offers an import from a
 * CSV or Excel file (c/gridImportDialog): a preview first, then the rows are
 * written in batches, updating records by Id and creating the rest. It waits
 * until unsaved changes are saved or cancelled, so the two never mix, and the
 * grid reloads afterwards. The CSV export writes an Id column first, so an
 * exported file comes back in as updates.
 *
 * GROUPING AND SUBTOTALS
 * The admin sets the grouping the grid opens with (up to three levels) and a
 * subtotal per column; the user changes the grouping from the column menus,
 * for the session. The table groups the rows it has; with rows still on the
 * server they are fetched in group order, so a group's rows arrive together.
 * Each group's count and subtotals cover every matching record, so they come
 * from GridController.summarizeGroups: one call, or, when a subtotal must
 * read more records than one call may, one call per slice of the records,
 * added up here (c/gridGroups rollUp). Counts and subtotals are of saved
 * values; they are fetched again after a search, a grouping change, a save,
 * a delete or an import.
 *
 * AFTER THE UX REVIEW
 * - The header reads as a list view's: the object's icon, the title, then
 *   "N items • Sorted by X • Updated a minute ago", with a Refresh button. The
 *   row-limit notice is a help icon on that line, not a box of its own.
 * - Import and Export are labelled buttons; icons alone were guessed at. Undo
 *   and Redo moved to the Save bar, beside what they undo (the table's
 *   footer, from `history`). Below 480px, and in a child table, the actions
 *   are in one menu beside the search.
 * - Selecting rows shows a bar: "N selected", Update field, Delete and Clear
 *   (labelled, not icons).
 * - Deleting asks in c/gridDeleteDialog, which names the rows.
 * - An empty list says why and what to do: clear the search, or import.
 *   While the first rows load, grey placeholder rows stand where they will be,
 *   instead of a spinner.
 * - With display rules, a Display Key switch (a swatch icon beside Charts) shows what each color, icon and bar means.
 * - Configuration warnings (diagnostics only) are one line until opened.
 * - Child tables: how many related records each row has comes from
 *   GridController.countChildren after the rows load, and a child grid tells
 *   its tab its own count (countchange).
 *
 * THE ROW MENU'S OWN ITEMS
 * As a list view's row menu, each row's menu starts with Edit, Delete and
 * Change Owner, each only where the server says this user may (the
 * definition's canEditRecords, allowMassDelete and canChangeOwner), then the
 * grid's actions. Edit opens Salesforce's edit form for the record
 * (c/gridEditRecord); Delete asks in c/gridDeleteDialog, as for a selection;
 * Change Owner asks for a user or queue (c/gridChangeOwner) and saves at once
 * (GridController.changeOwner). Edit and Change Owner wait for a row's unsaved
 * changes to be saved or cancelled. Afterwards the row is read again.
 *
 * ACTIONS
 * A configuration's Grid Actions are offered in each row's menu (the table's
 * last column), in the selection bar, or both. The table says which action on
 * which row (rowaction); the selection bar's buttons, or its Actions menu when
 * there are more than MAX_ACTION_BUTTONS, run on the selected rows.
 * - A screen flow runs on its own page, c/rowhouseFlow, with the row's Id as its input (recordId
 *   unless the action names another), or the selected Ids as the text
 *   collection `ids`. Not over unsaved changes, which leaving the page could
 *   lose. When it comes back, the rows it ran on are read again.
 * - A quick action opens in Salesforce's own window over this page, on one
 *   row (c/gridFlowRoute quickActionUrl). Not over that row's unsaved changes:
 *   the window works on the saved record. Nothing tells the page when the
 *   window closes, so the grid watches the address (QUICK_POLL_MS), then reads
 *   the row again; after QUICK_OPEN_WAIT_MS it reads it anyway (a hidden
 *   tab's slowed timers can miss the window).
 * - An autolaunched flow runs on the server (GridController.runAction),
 *   ACTION_BATCH records per call, one call after another. The dialog asks
 *   first for a selection, for an action with its own question, and for a
 *   row with unsaved changes (the flow sees the saved record). Records it
 *   could not run on keep a row error saying why.
 * Afterwards the rows it ran on are read again, since the action may have
 * changed them; counts and subtotals are fetched again. The selection stays,
 * so another action can run on the same rows.
 *
 * NEW
 * With Allow New Records on the configuration and create access to the
 * object, the toolbar has a list view's New button (openGrid's `newRow` says
 * how). Where a new record can be a row of the grid, New adds an empty row
 * at the top, with Salesforce's defaults and the parent it belongs under
 * filled in; the user fills in its cells and Save creates it
 * (GridController.createRows), before the other changes are saved, and reads
 * it back. It is one undo step; Cancel takes it away with the other changes.
 * Where it cannot (a choice of record type, a required field that is not
 * a column, a grid that does not edit cells), New opens Salesforce's New form
 * (c/gridNewRecord), and the record it creates is read and added to the grid.
 *
 * GRID SETTINGS
 * With the Rowhouse Grid Admin permission set (canConfigure, from the server),
 * the toolbar has a gear, and the compact menu a Grid settings item, that open
 * this grid's settings in c/gridSettings. Not over unsaved changes: saving the
 * settings loads the grid again. openGrid is never answered from the browser's
 * cache, so the configuration read is always the one just saved.
 *
 * FILTERS
 * The admin's filters (the definition's `filters`) always apply on the
 * server; the table shows them as locked chips. The user's own, one per
 * column from the column menus (filterchange), are kept here for the session
 * and go with every request for rows and for counts and subtotals, as the
 * search term does; the server checks them against the grid's columns.
 *
 * ON A RECORD PAGE
 * gridApp passes the page's recordId. With a Record Page Field on the
 * configuration, the server shows only the records whose field points to that
 * record, and an import fills it in on the records it creates. A child table
 * is filtered by its parent row instead.
 *
 * CHARTS
 * As a list view's: the Charts button (utility:chart) opens a panel beside the
 * table (c/gridChartPanel), under it in a narrow space, with a chart of every
 * record the search and filters match: counted, or a number column added up or
 * averaged (GridController.chartGroups, sliced as the groups' subtotals are),
 * by one column the grid can group by, as vertical or horizontal bars or a
 * donut. The panel's gear opens Edit chart (c/gridChartDialog), which
 * chooses. One chart per user per grid, kept with the layout, open or
 * closed; the first is the records counted by the grid's grouping, else by its
 * first picklist. Read again whenever the counts and subtotals are. Not in a
 * child table.
 *
 * EACH USER'S LAYOUT
 * A grid reads this user's layout with its configuration (openGrid,
 * never cached), and starts with its sort, grouping, widths, Wrap or Clip,
 * frozen columns and open rows, as far as they still fit the grid. A
 * change to any of them is kept LAYOUT_DELAY_MS after the last one
 * (saveLayout), and at once if the grid goes away first. Reset layout
 * forgets it and puts back the admin's. A layout that cannot be read or kept
 * changes nothing; only Rowhouse Grid Diagnostics users hear of it, in the
 * console. A child table keeps a layout of its own for the tab that shows
 * it (parentLink): every parent row's tab opens the same way.
 *
 * TELEMETRY
 * With the Rowhouse_Grid_Diagnostics custom permission, each load and save writes one
 * structured line to the browser console: timings, row counts, server CPU. It is
 * off for everyone else, and it never includes record data. The same permission
 * turns on the User Timing measures the published benchmark reads (c/gridTiming).
 */
import { LightningElement, api, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LOCALE from '@salesforce/i18n/locale';
import openGrid from '@salesforce/apex/GridController.openGrid';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import saveRows from '@salesforce/apex/GridController.save';
import createRows from '@salesforce/apex/GridController.createRows';
import saveStatus from '@salesforce/apex/GridController.saveStatus';
import deleteRows from '@salesforce/apex/GridController.deleteRows';
import changeOwner from '@salesforce/apex/GridController.changeOwner';
import restoreRows from '@salesforce/apex/GridController.restoreRows';
import matchingIds from '@salesforce/apex/GridController.matchingIds';
import lookupName from '@salesforce/apex/GridController.lookupName';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import chartGroups from '@salesforce/apex/GridController.chartGroups';
import countChildren from '@salesforce/apex/GridController.countChildren';
import runAction from '@salesforce/apex/GridController.runAction';
import saveLayout from '@salesforce/apex/GridController.saveLayout';
import resetLayout from '@salesforce/apex/GridController.resetLayout';
import { displayKeyFor, dateIn } from 'c/gridDisplayRules';
import { normalizeGrouping, sameGrouping, levelParam, rollUp } from 'c/gridGroups';
import {
    applyEdit,
    applyEdits,
    applySaveResult,
    applyRefusedFields,
    carryNewEdits,
    clearCellError,
    hasDrafts,
    mergeErrors,
    requiredErrors,
    toPayload,
    NEW_MARK,
    newRowKey,
    addNewRow,
    splitDrafts,
    toCreatePayload,
    newRowRequiredErrors,
    applyCreateResult,
    withSameParent,
    rowsSharingParents
} from 'c/gridEditState';
import { toCsv, downloadCsv } from 'c/gridCsv';
import { sortRows, picklistRanks, isMixedCurrency } from 'c/gridFormat';
import { mark } from 'c/gridTiming';
import {
    emptyHistory,
    stepBetween,
    record,
    undo as undoStep,
    redo as redoStep,
    describe as describeStep,
    withoutRecords
} from 'c/gridHistory';
import { massChanges } from 'c/gridUpdateField';
import { sharedOptions } from 'c/gridFields';
import { childTableHeight } from 'c/gridChildTables';
import { readChoice, shownColumns, chooseColumns, sameChoice, searchHint } from 'c/gridColumns';
import {
    namespaceOf,
    newToken,
    backRef,
    flowPageRef,
    doneToken,
    quickActionUrl,
    isQuickActionPath
} from 'c/gridFlowRoute';
import { openGuide } from 'c/guideRoute';
import { normalizeChart, defaultChart, chartParam, groupByColumns } from 'c/gridCharts';

/** Loaded up front: the published benchmark ceiling. Beyond it, rows load as the user scrolls. */
export const PRELOAD_ROWS = 10000;
/** The most one grid holds: the rows one Apex pagination cursor can hold. */
export const MAX_LOADED_ROWS = 100000;
/** Pages after the first; the server's own maximum. */
export const FOLLOW_PAGE_SIZE = 2000;
/** New rows created per call (GridCreateService.MAX_ROWS). */
const CREATE_BATCH = 200;
/** fetchRowsById takes at most this many Ids per call. */
const REREAD_BATCH = 2000;
export const SEARCH_DELAY_MS = 300;
export const POLL_DELAYS_MS = [400, 700, 1000, 1500, 2000];
export const POLL_TIMEOUT_MS = 120000;
/** Rows one selection holds: the most one save sends (50 batches of 200). */
export const MAX_SELECTED = 10000;
/** Ids per delete call: one DML statement's worth (GridDeleteService.MAX_IDS). */
export const DELETE_BATCH = 200;
/** Ids per matchingIds call (GridDeleteService.MATCH_SLICE). */
export const MATCH_SLICE = 2000;
/** The most "delete every matching record" deletes in one go: 250 delete calls. */
export const MAX_DELETE_ALL = 50000;
/** Records per action call (GridActionService.MAX_IDS). */
export const ACTION_BATCH = 50;
/** ms between looks at the address while a quick action's window is open. */
export const QUICK_POLL_MS = 400;
/** ms after which the grid stops watching for a quick action's window and reads the row again. */
export const QUICK_OPEN_WAIT_MS = 15000;
/** Selection actions shown as buttons; more than this and they are one menu. */
export const MAX_ACTION_BUTTONS = 3;
/** The row menu's own items, before the grid's actions: no Grid Action's name starts with "_". */
export const ROW_EDIT = '__edit';
export const ROW_DELETE = '__delete';
export const ROW_OWNER = '__owner';
/** A top-level grid, its child tables and theirs. */
export const MAX_LEVELS = 3;
/** Rows one countChildren call takes (GridChildTables.MAX_COUNT_PARENTS). */
export const COUNT_BATCH = 2000;
/** px: below this the toolbar's actions fold into one menu, as the table turns to cards. */
export const NARROW_WIDTH = 480;
/** Placeholder rows while the first rows load. */
export const PLACEHOLDER_ROWS = 6;
/** ms after the last layout change before it is kept. */
export const LAYOUT_DELAY_MS = 2000;
/** Sort keys a saved layout may hold: the table's own limit is lower. */
const MAX_SAVED_SORT = 5;
/** px: one item of the compact toolbar's menu (lightning-menu-item, measured in Lightning Experience). */
export const MENU_ITEM_HEIGHT = 34;
/** px: the menu's gap below its button and its own padding, above and below its items. */
export const MENU_CHROME = 12;
/** Columns a user may freeze: as many as an admin may (Frozen Columns, 0 to 5). */
export const MAX_FROZEN = 5;
const NO_CHILDREN = [];
const NO_FILTERS = [];

/** This page's address, path and query; blank where it cannot be read. */
const currentAddress = () => {
    try {
        return window.location.pathname + window.location.search;
    } catch {
        return '';
    }
};

const delay = ms =>
    new Promise(resolve => {
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- back-off between save-status checks
        setTimeout(resolve, ms);
    });

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Run `callback` once the browser has drawn what is on screen now. A frame
 * callback runs just BEFORE the next paint, so a change made there would be
 * drawn in the same frame as the one before it; a zero timeout set there runs
 * after that paint. Without frames at all, it runs at once.
 */
function afterNextPaint(callback) {
    if (typeof requestAnimationFrame !== 'function') {
        callback();
        return;
    }
    // eslint-disable-next-line @lwc/lwc/no-async-operation -- a spinner must be drawn before the work it stands for
    requestAnimationFrame(() => {
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- after the paint, not before it
        setTimeout(callback, 0);
    });
}

/** An Apex error's message, whatever shape it arrived in. */
export function messageOf(error) {
    if (!error) return 'Unknown error.';
    const body = error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    if (Array.isArray(body))
        return body
            .map(e => e && e.message)
            .filter(Boolean)
            .join(' ');
    return error.message || String(error);
}

/**
 * A saved layout, read back: the parts that still fit the grid. A
 * sort or grouping key on a column the grid no longer has, or can no longer
 * sort or group by, is left out; the table checks widths, wrap and open rows
 * against its columns itself. Null when there is nothing to use.
 */
export function readLayout(json, columns) {
    let saved;
    try {
        saved = json ? JSON.parse(json) : null;
    } catch {
        return null;
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    const cols = Array.isArray(columns) ? columns : [];
    const byField = new Map(cols.map(c => [c.field, c]));
    const sort = Array.isArray(saved.sort)
        ? saved.sort
              .filter(k => k && byField.has(k.field) && byField.get(k.field).sortable !== false)
              .slice(0, MAX_SAVED_SORT)
              .map(k => ({ field: k.field, direction: k.direction === 'desc' ? 'desc' : 'asc' }))
        : null;
    return {
        // A saved sort that no column is left for is no sort to use.
        sort: sort && (sort.length || !saved.sort.length) ? sort : null,
        // The same for a grouping: one no column is left for falls back to the admin's.
        grouping: Array.isArray(saved.grouping) ? groupingOf(saved.grouping, cols) : null,
        widths: saved.widths && typeof saved.widths === 'object' && !Array.isArray(saved.widths) ? saved.widths : null,
        wrap: saved.wrap && typeof saved.wrap === 'object' && !Array.isArray(saved.wrap) ? saved.wrap : {},
        expanded: Array.isArray(saved.expanded) ? saved.expanded.filter(id => typeof id === 'string') : [],
        // The user's own columns: null for the admin's.
        columns: readChoice(saved.columns, cols),
        // The columns the user froze: null for the admin's Frozen Columns.
        frozen: Number.isInteger(saved.frozen) && saved.frozen >= 0 && saved.frozen <= MAX_FROZEN ? saved.frozen : null,
        // The groups' order and percentages; the table checks the order against its columns.
        groupView:
            saved.groups && typeof saved.groups === 'object' && !Array.isArray(saved.groups)
                ? { order: saved.groups.order || null, percent: saved.groups.percent === true }
                : null,
        // The user's chart, as far as it still fits the columns, and whether its panel was open.
        ...chartOf(saved.chart, cols)
    };
}

/** A kept chart, read back: { chart, chartsOpen }. */
function chartOf(saved, cols) {
    const chart = normalizeChart(saved, cols);
    return { chart, chartsOpen: Boolean(chart) && saved.open === true };
}

/** A saved grouping that still fits; null when it had levels and none is left. */
function groupingOf(saved, cols) {
    const grouping = normalizeGrouping(saved, cols);
    return grouping.length || !saved.length ? grouping : null;
}

/** The admin's sort, as the configuration sets it. */
function adminSort(d) {
    return d && d.sortField ? [{ field: d.sortField, direction: d.sortDirection === 'desc' ? 'desc' : 'asc' }] : [];
}

/** Re-opening a cursor between calls can shift a page by one row: de-duplicate by Id. */
function appendUnique(rows, page) {
    if (!rows.length) return page.slice();
    const seen = new Set(rows.map(r => r.Id));
    return rows.concat(page.filter(r => !seen.has(r.Id)));
}

export default class GridView extends NavigationMixin(LightningElement) {
    _configName = '';
    /** A child table's parent: { link, id, name, level }, or null at the top. */
    _parent = null;
    /** The record whose page this grid is on, or ''. */
    _recordId = '';

    // ---- reactive state ----
    definition = null;
    diagnostics = false;
    /** The user holds Rowhouse Grid Admin: the gear opens this grid's settings. */
    canConfigure = false;
    settingsOpen = false;
    rows = [];
    totalRows = 0;
    hasMore = false;
    loading = false;
    loadingMore = false;
    loadError = null;
    searchTerm = '';
    sort = [];
    drafts = {};
    errors = {};
    saving = false;
    saveProgress = '';
    notice = null; // { variant: 'error' | 'warning', message }
    announcement = '';
    history = emptyHistory();
    /** The org's fiscal year, for grouping by fiscal quarter or year; null for none. */
    fiscal = null;
    /** Lookup and owner names, { [recordId]: name }: from the rows, and from editor choices. */
    refNames = {};
    /** Row selection. A new selectionKey tells the table to clear its own. */
    selectedIds = [];
    selectionKey = 0;
    massUpdateOpen = false;
    deleting = false;
    /** Every record the search and filters match is selected, not only the loaded rows. */
    allMatching = false;
    /** A lookup's New item: { recordId, field, object, objectLabel } while its record form is open. */
    newRecord = null;
    /** A row's Edit: { recordId, objectApiName, name } while Salesforce's edit form is open. */
    editRecord = null;
    /** A row's Change Owner: { recordId, name, busy, error } while its dialog is open. */
    ownerChange = null;
    /** The records the last delete took out, for Undo: { ids }, or null. */
    undoDelete = null;
    restoring = false;
    importOpen = false;
    /** The grouping, outermost first: [{ field, unit }]. */
    grouping = [];
    /** Counts and subtotals: null, or { status: 'loading' | 'ready' | 'unavailable', totals }. */
    groupSummary = null;
    /** Related records under each row: { [rowId]: { total, byTab } }. */
    childCounts = {};
    /** The counts could not be fetched: rows without one then offer their toggle. */
    childCountsFailed = false;
    /**
     * The day TODAY stands for in display rules, as YYYY-MM-DD in the user's
     * time zone. Null until a Refresh: the rules then take the day the grid
     * opened. A Refresh sets it to today, so a grid left open past midnight
     * catches up.
     */
    formatToday = null;
    /** The search box's text, so an empty list's "Clear search" can empty it. */
    searchValue = '';
    /** When the rows were last loaded, for "Updated a minute ago". */
    loadedAt = null;
    /** The toolbar folds into a menu: set from this component's own width. */
    narrow = false;
    deleteOpen = false;
    displayKeyOpen = false;
    /** While the Display Key opens or closes: what its button's spinner says; '' otherwise. */
    displayKeyBusy = '';
    warningsOpen = false;
    /** An action is running on the server: editing and other actions wait. */
    acting = false;
    /** The action dialog's inputs (c/gridActionDialog), or null when it is closed. */
    actionDialog = null;
    /** The user's column filters, [{ field, operator, value, valueTo }], for the session. */
    filters = NO_FILTERS;
    /** The sort the table starts with: the user's saved one, or the admin's. */
    startSort = [];
    /** The saved layout handed to the table, { key, widths, wrap, expanded, sort }, or null. */
    userLayout = null;
    /** This user has a layout of this grid kept: Reset layout is offered. */
    layoutSaved = false;
    /** This user's own columns, { order, hidden }, or null for the admin's. */
    columnChoice = null;
    /** Search this list has focus: its hint shows. */
    searchFocused = false;
    /** The Charts panel is open. */
    chartsOpen = false;
    /** This user's chart of this grid (gridCharts), or null until there is one. */
    chart = null;
    /** The chart's answer: { status, groups, message }, or null. */
    chartData = null;
    /** Edit chart is open. */
    chartDialogOpen = false;
    /** The Choose columns dialog is open. */
    columnsOpen = false;
    /**
     * How this user adds records here (openGrid's newRow): { objectLabel,
     * inline, defaults, names, presets, recordTypeId }, or null for no New button.
     */
    newRowContext = null;
    /**
     * The rows added with New and not saved yet, in the order added: { Id:
     * key, ...Salesforce's defaults, ...the parent }. A row shows while its
     * draft carries the new-row mark (c/gridEditState NEW_MARK).
     */
    newRows = [];
    /** A row for the table to focus, { id, seq }: the row New just added. */
    focusRow = null;
    /**
     * px: how tall a child table's grid stays while its actions menu is open,
     * so the menu fits inside the related-records panel (which grows to hold
     * it) rather than running past the panel's bottom. 0 when closed.
     */
    menuRoom = 0;
    /**
     * The picklist values each record type among the rows allows, { [record
     * type Id]: { [field, lower case]: [values] } }, as Salesforce answers
     * (c/gridRecordTypeValues); null until it has for one.
     */
    recordTypePicklists = null;

    // ---- non-reactive containers (mutated, never reassigned) ----
    _runtime = {
        token: 0,
        summaryToken: 0,
        chartToken: 0,
        countToken: 0,
        searchTimer: null,
        connected: false,
        newCount: 0,
        next: { locator: null, cursorToken: null }
    };
    _memo = {};
    _readers = {};
    /** Non-reactive (HR-20): the width observer, and whether Charts was shown at the last drawing. */
    _layout = { observer: null, onResize: null, started: false, chartsShown: undefined };
    _reported = { count: null };
    /** What the delete dialog is about: the Ids, fixed when it opens. */
    _pendingDelete = { ids: [], all: false };
    /** What the action dialog is about: the action, the Ids and where it was chosen, fixed when it opens. */
    _pendingAction = { action: null, ids: [], source: null };
    /**
     * Screen flows: the page this grid is on, to come back to, and the
     * flow it sent the user to: { token, action, ids }, until it comes back.
     */
    _flow = { page: null, sent: null };
    /** Quick actions: the window this grid opened ({ action, recordId }), and the timer that watches for it to close. */
    _quick = { sent: null, timer: null };
    /**
     * The layout being kept: the table's part as it last reported it,
     * the timer of the next save, what was last kept, the key of the layout
     * handed to the table, and whether keeping is off (it failed, or the user
     * has no access).
     */
    _saved = {
        table: { widths: null, wrap: {}, expanded: [], frozen: null },
        timer: null,
        pending: false,
        name: null,
        lastJson: null,
        key: 0,
        off: false,
        inFlight: null
    };

    @api
    get configName() {
        return this._configName;
    }
    set configName(value) {
        const next = typeof value === 'string' ? value.trim() : '';
        if (next === this._configName) return;
        // A layout change still waiting is kept for the grid it was made on,
        // before the name changes.
        if (this._runtime.connected) this.keepLayoutNow();
        this._configName = next;
        if (this._runtime.connected) this.initialise();
    }

    @api
    get parent() {
        return this._parent;
    }
    set parent(value) {
        const height = value && Number(value.height) > 0 ? Number(value.height) : null; // the tab's Height
        const next =
            value && value.link && value.id
                ? {
                      link: String(value.link),
                      id: String(value.id),
                      name: value.name ? String(value.name) : '',
                      level: Math.max(2, Number(value.level) || 2),
                      height
                  }
                : null;
        const before = this._parent;
        const sameRecord = before && next ? before.link === next.link && before.id === next.id : before === next;
        // Unchanged: keep the same object, so the table is not handed a new config (HR-17).
        if (
            sameRecord &&
            (!next || (before.name === next.name && before.level === next.level && before.height === next.height))
        )
            return;
        this._parent = next;
        // Another record, or another link: its rows are other rows. A new name alone is only a label.
        if (!sameRecord && this._runtime.connected) this.initialise();
    }

    /** The record whose page this grid is on: its rows are that record's, with a Record Page Field. */
    @api
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        const next = typeof value === 'string' ? value.trim() : '';
        if (next === this._recordId) return;
        this._recordId = next;
        if (this._runtime.connected) this.initialise();
    }

    /** Focus the table: a parent table sends it here when Enter opens a child panel. */
    @api
    focus() {
        const table = this.template.querySelector('c-grid-table');
        if (table && typeof table.focus === 'function') table.focus();
    }

    /** 1 for a top-level grid, 2 or 3 for a child table. */
    get level() {
        return this._parent ? this._parent.level : 1;
    }

    get isNested() {
        return Boolean(this._parent);
    }

    /** What the server needs to know a child table's parent; nothing for a top-level grid. */
    get parentParams() {
        return this._parent ? { parentLink: this._parent.link, parentId: this._parent.id } : {};
    }

    /**
     * What narrows every request for rows, counts and subtotals besides the
     * search: the user's filters and the page's record.
     */
    get filterParams() {
        return {
            filters: this.filters.length ? this.filters : null,
            recordId: this._parent ? null : this._recordId || null
        };
    }

    connectedCallback() {
        this._runtime.connected = true;
        this.initialise();
    }

    disconnectedCallback() {
        this._runtime.connected = false;
        this._runtime.token++; // any response still in flight is now stale
        this._runtime.summaryToken++;
        this._runtime.chartToken++;
        this._runtime.countToken++;
        clearTimeout(this._runtime.searchTimer);
        this.stopWatchingQuickAction();
        this.keepLayoutNow(); // a change still waiting is kept, not lost
        if (this._layout.observer) this._layout.observer.disconnect();
        if (this._layout.onResize) window.removeEventListener('resize', this._layout.onResize);
        this._layout.observer = null;
        this._layout.onResize = null;
        this._layout.started = false;
    }

    /**
     * The toolbar folds its actions into a menu below NARROW_WIDTH,
     * measured on this component's own root (HR-24), with ResizeObserver, or
     * the window's resize where it does not exist (HR-23). A width of 0 is not
     * known yet (a hidden tab): the toolbar stays as it is.
     */
    renderedCallback() {
        this.tellTableItsRoom();
        if (this._layout.started || this.isNested) return;
        const root = this.template.querySelector('[data-view-root]');
        if (!root) return;
        this._layout.started = true;
        const measure = width => {
            if (!width) return;
            const narrow = width < NARROW_WIDTH;
            if (narrow !== this.narrow) this.narrow = narrow;
        };
        if (typeof ResizeObserver === 'function') {
            this._layout.observer = new ResizeObserver(entries => {
                const entry = entries && entries[0];
                measure(entry && entry.contentRect ? entry.contentRect.width : root.getBoundingClientRect().width);
            });
            this._layout.observer.observe(root);
        } else if (typeof window !== 'undefined') {
            this._layout.onResize = () => measure(root.getBoundingClientRect().width);
            window.addEventListener('resize', this._layout.onResize);
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- measured after the render (HR-20)
            requestAnimationFrame(this._layout.onResize);
        }
    }

    /**
     * Charts opened or closed beside the table, so the table has more or less
     * room. Under Lightning Locker nothing else tells it (no ResizeObserver;
     * see gridTable.measureWidth). Only on a change after the first drawing,
     * when the table measures itself anyway. Written to a non-reactive
     * container (HR-20).
     */
    tellTableItsRoom() {
        const shown = this.showCharts;
        const before = this._layout.chartsShown;
        this._layout.chartsShown = shown;
        if (before === undefined || before === shown) return;
        const table = this.template.querySelector('c-grid-table');
        if (table) table.measureWidth();
    }

    // ============================================================ loading

    /**
     * Open the grid: one call (GridController.openGrid) brings its
     * configuration, this user's layout and the first page of rows, sorted and
     * grouped as the server read the layout. The grid reads the layout itself
     * as before; where it reads the sort or grouping differently from the
     * server, it does not use that page and asks for the rows again. Never
     * from the browser's cache, so a configuration saved a moment ago
     * is the one read.
     */
    async initialise() {
        const token = ++this._runtime.token;
        // A layout change still waiting is kept first, while the grid it was
        // made on (its definition, sort and grouping) is still here to read.
        this.keepLayoutNow();
        this.definition = null;
        this.rows = [];
        this.drafts = {};
        this.errors = {};
        this.history = emptyHistory();
        this.refNames = {};
        this.notice = null;
        this.loadError = null;
        this.grouping = [];
        this.groupSummary = null;
        this.childCounts = {};
        this.childCountsFailed = false;
        this.filters = NO_FILTERS; // the user's filters were for the grid that was
        this.userLayout = null;
        this.layoutSaved = false;
        this.columnChoice = null;
        this.columnsOpen = false;
        this.newRowContext = null;
        this.newRows = [];
        this.focusRow = null;
        this.recordTypePicklists = null;
        this._saved.off = false;
        this._saved.lastJson = null;
        this._runtime.summaryToken++;
        this._runtime.countToken++;
        const name = this._configName;
        if (!name) {
            this.loadError = 'This grid has no configuration name.';
            return;
        }
        this.loading = true;
        const started = now();
        try {
            const opened = await openGrid({
                configName: name,
                searchTerm: this.searchTerm || null,
                parentLink: this._parent ? this._parent.link : null,
                parentId: this._parent ? this._parent.id : null,
                recordId: this._parent ? null : this._recordId || null
            });
            if (token !== this._runtime.token) return;
            const openMs = Math.round(now() - started);
            this.diagnostics = opened.diagnostics === true;
            this.canConfigure = opened.canConfigure === true;
            this.fiscal = opened.fiscal || null;
            // Back-dated to when loading began: whether to time is only known now.
            mark(this.diagnostics, 'start', started);
            const d = opened.definition;
            const layout = this.layoutOf(opened, name);
            if (layout.error) this.telemetry('layout', { error: layout.error });
            const saved = readLayout(layout.json, d.columns);
            this.layoutSaved = Boolean(layout.json);
            this._saved.lastJson = layout.json || null;
            this.sort = saved && saved.sort ? saved.sort : adminSort(d);
            this.startSort = this.sort;
            // The admin's grouping, as far as this user can group (the server has
            // already narrowed it), unless the user's layout has one.
            this.grouping = saved && saved.grouping ? saved.grouping : normalizeGrouping(d.grouping, d.columns);
            this._saved.table = saved
                ? {
                      widths: saved.widths,
                      wrap: saved.wrap,
                      expanded: saved.expanded,
                      groupView: saved.groupView,
                      frozen: saved.frozen
                  }
                : { widths: null, wrap: {}, expanded: [], groupView: null, frozen: null };
            this.userLayout = saved ? { key: ++this._saved.key, ...this._saved.table, sort: this.sort } : null;
            this.columnChoice = saved ? saved.columns : null;
            this.chart = saved ? saved.chart : null;
            this.chartsOpen = Boolean(saved && saved.chartsOpen) && !this._parent;
            this.chartData = null;
            this.newRowContext = opened.newRow || null;
            this.definition = d;
            const first = this.firstPageOf(opened, openMs);
            this.telemetry('config', {
                ms: openMs,
                columns: d.columns.length,
                layout: Boolean(saved),
                firstPage: Boolean(first)
            });
            this.loadSummary(); // alongside the rows, not after them
            if (first && first.error) {
                // The server read the layout as the grid does, and could not read
                // those rows: asking again would only fail again.
                this.fail({ body: { message: first.error } });
                return;
            }
            await this.loadRows(token, first);
        } catch (e) {
            if (token === this._runtime.token) this.fail(e);
        }
    }

    /**
     * The layout openGrid brought: { json, error }. A layout that could not be
     * read is none, and keeping one is off for this grid. A child table's is
     * its own for the tab that shows it.
     */
    layoutOf(opened, name) {
        const json = typeof opened.layout === 'string' && opened.layout ? opened.layout : null;
        const error = opened.layoutError ? String(opened.layoutError) : null;
        if (error && name === this._configName) this._saved.off = true;
        return { json, error };
    }

    /**
     * The first page openGrid brought, when it is the page this grid would
     * ask for: the same sort and grouping, as the server applies them. null
     * otherwise, and the grid asks for its first page itself. { page, ms }, or
     * { error } when the server could not read those rows.
     */
    firstPageOf(opened, ms) {
        const start = opened.start;
        if (!start || !this.sameStart(start)) return null;
        if (opened.pageError) return { error: String(opened.pageError) };
        return opened.page ? { page: opened.page, ms } : null;
    }

    /** Does the server's start match what queryParams asks for, as the server applies it? */
    sameStart(start) {
        const d = this.definition || {};
        const primary = this.sort[0];
        const sortField = primary ? primary.field : d.sortField || null;
        const sortDirection = primary
            ? primary.direction
            : sortField
              ? d.sortDirection === 'desc'
                  ? 'desc'
                  : 'asc'
              : null;
        const groupBy = this.grouping.map(levelParam);
        const theirs = Array.isArray(start.groupBy) ? start.groupBy : [];
        return (
            (start.sortField || null) === sortField &&
            (start.sortDirection || null) === sortDirection &&
            theirs.length === groupBy.length &&
            theirs.every((g, i) => g === groupBy[i])
        );
    }

    reload() {
        return this.loadRows(++this._runtime.token);
    }

    /** What the server is asked for; a later page must ask for the same. */
    get queryParams() {
        const primary = this.sort[0];
        return {
            configName: this._configName,
            searchTerm: this.searchTerm || null,
            sortField: primary ? primary.field : null,
            sortDirection: primary ? primary.direction : null,
            // Grouped, rows come in group order. Not sent otherwise.
            groupBy: this.grouping.length ? this.grouping.map(levelParam) : undefined,
            // A child table's rows are its parent's.
            ...this.parentParams,
            // The user's filters and the page's record.
            ...this.filterParams
        };
    }

    /**
     * Load the rows from the first page: page after page, up to PRELOAD_ROWS.
     * `opened` is a first page already in hand, { page, ms }, from openGrid;
     * without it the first page is asked for too.
     */
    async loadRows(token, opened = null) {
        this.loading = true;
        this.clearSelection(); // the rows are about to be different ones
        this.loadingMore = false; // a load-more still in flight belongs to the old query
        this.loadError = null;
        const params = this.queryParams;
        let rows = [];
        let locator = null;
        let cursorToken = null;
        let first = true;
        let inHand = opened && opened.page ? opened : null;
        const started = now();
        try {
            do {
                const pageStarted = now();
                // Pages are sequential by design: each needs the previous locator.
                const page = inHand
                    ? inHand.page
                    : // eslint-disable-next-line no-await-in-loop
                      await fetchRows({
                          ...params,
                          cursorLocator: locator,
                          cursorToken,
                          // The first page is the configuration's own size. After it,
                          // large pages, but never past the preload: the last one asks
                          // only for the rows still missing.
                          pageSize: first ? null : Math.min(FOLLOW_PAGE_SIZE, PRELOAD_ROWS - rows.length)
                      });
                const pageMs = inHand ? inHand.ms : Math.round(now() - pageStarted);
                inHand = null;
                if (token !== this._runtime.token) return;
                rows = appendUnique(rows, page.rows || []);
                this.learnNames(page.rows);
                locator = page.cursorLocator;
                cursorToken = page.cursorToken || cursorToken;
                this.rows = rows; // a new array each page (HR-17)
                this.totalRows = page.totalRows || 0;
                this.hasMore = page.hasMore === true && Boolean(locator);
                this.telemetry('page', {
                    ms: pageMs,
                    serverMs: page.serverMs,
                    cpuMs: page.cpuMs,
                    rows: (page.rows || []).length,
                    loaded: rows.length,
                    total: this.totalRows
                });
                first = false;
            } while (this.hasMore && rows.length < PRELOAD_ROWS);
        } catch (e) {
            if (token === this._runtime.token) this.fail(e);
            return;
        }
        this._runtime.next = { locator, cursorToken };
        this.loading = false;
        this.loadedAt = Date.now();
        this.telemetry('load', { ms: Math.round(now() - started), loaded: rows.length, total: this.totalRows });
        this.announce(this.loadedMessage);
        this.reportCount();
        this.loadChildCounts(rows.map(r => r.Id));
    }

    /**
     * One more page, when the table asks (loadmore). It continues on the same
     * cursor and locator as the load before it; a new sort or search starts a
     * new load, and a page still arriving for the old one is dropped.
     */
    async handleLoadMore() {
        if (this.loading || this.loadingMore || !this.canLoadMore) return;
        const token = this._runtime.token;
        const { locator, cursorToken } = this._runtime.next;
        if (!locator) return;
        this.loadingMore = true;
        this.announce('Loading more rows…');
        const started = now();
        try {
            const page = await fetchRows({
                ...this.queryParams,
                cursorLocator: locator,
                cursorToken,
                pageSize: Math.min(FOLLOW_PAGE_SIZE, MAX_LOADED_ROWS - this.rows.length)
            });
            if (token !== this._runtime.token) return;
            const before = this.rows.length;
            this.rows = appendUnique(this.rows, page.rows || []); // a new array (HR-17)
            this.learnNames(page.rows);
            this.totalRows = page.totalRows || this.totalRows;
            this.hasMore = page.hasMore === true && Boolean(page.cursorLocator);
            this._runtime.next = { locator: page.cursorLocator, cursorToken: page.cursorToken || cursorToken };
            const added = this.rows.length - before;
            this.loadChildCounts((page.rows || []).map(r => r.Id));
            this.telemetry('more', {
                ms: Math.round(now() - started),
                serverMs: page.serverMs,
                cpuMs: page.cpuMs,
                rows: added,
                loaded: this.rows.length,
                total: this.totalRows
            });
            this.announce(`Loaded ${this.format(added)} more ${added === 1 ? 'row' : 'rows'}. ${this.loadedMessage}`);
        } catch (e) {
            if (token !== this._runtime.token) return;
            this.notice = { variant: 'error', message: 'More rows could not be loaded. ' + messageOf(e) };
            this.announce(this.notice.message);
        } finally {
            if (token === this._runtime.token) this.loadingMore = false;
        }
    }

    /** More rows exist and the grid has room for them. */
    get canLoadMore() {
        return this.hasMore && this.rows.length < MAX_LOADED_ROWS;
    }

    /**
     * Record the lookup names a page of rows carries (row._labels, from the
     * server) as { [recordId]: name }. A new object only when something is new,
     * so the table re-renders only then (HR-17).
     */
    learnNames(rows) {
        let next = null;
        (rows || []).forEach(row => {
            const labels = row && row._labels;
            if (!labels) return;
            Object.keys(labels).forEach(field => {
                const id = row[field];
                if (id && this.refNames[id] !== labels[field] && (!next || next[id] !== labels[field])) {
                    next = next || { ...this.refNames };
                    next[id] = labels[field];
                }
            });
        });
        if (next) this.refNames = next;
    }

    /** A name the lookup editor chose, known before the row is saved and read back. */
    learnName(id, name) {
        if (id && name && this.refNames[id] !== name) this.refNames = { ...this.refNames, [id]: name };
    }

    /** Records a paste or an import found by name: { [id]: name }, so their cells show the names. */
    handleNamesFound(event) {
        const names = (event.detail && event.detail.names) || {};
        const next = { ...this.refNames };
        let changed = false;
        Object.keys(names).forEach(id => {
            if (names[id] && next[id] !== names[id]) {
                next[id] = names[id];
                changed = true;
            }
        });
        if (changed) this.refNames = next;
    }

    fail(error) {
        this.loading = false;
        this.loadError = messageOf(error);
        this.announce(this.loadError);
    }

    // ============================================================ table config

    /**
     * The table's one input. Memoised on the references it is built from, so a
     * render that changed nothing hands the table the SAME object, and any real
     * change hands it a NEW one (HR-17).
     */
    get tableConfig() {
        const deps = [
            this.definition,
            this.rows,
            this.drafts,
            this.errors,
            this.saving,
            this.loading,
            this.diagnostics,
            this.hasMore,
            this.loadingMore,
            this.totalRows,
            this.refNames,
            this.selectionKey,
            this.deleting,
            this.grouping,
            this.groupSummary,
            this._parent,
            this.childCounts,
            this.childCountsFailed,
            this.history,
            this.searchTerm,
            this.acting,
            this.filters,
            this.startSort,
            this.userLayout,
            this.columnChoice,
            this.saveProgress,
            this.fiscal,
            this.newRows,
            this.focusRow,
            this.recordTypePicklists
        ];
        const memo = this._memo;
        if (memo.deps && memo.deps.every((d, i) => d === deps[i])) return memo.value;
        const d = this.definition || { columns: [] };
        memo.deps = deps;
        memo.value = {
            columns: d.columns,
            // The user's own order and hidden columns; the table draws what it says.
            columnChoice: this.columnChoice,
            rows: this.rows,
            // Rows added with New, not saved yet: the table shows them first.
            newRows: this.shownNewRows,
            focusRow: this.focusRow,
            keyField: 'Id',
            drafts: this.drafts,
            errors: this.errors,
            // The table reads this once; the user's saved sort, or the admin's.
            sort: this.startSort,
            // -1 is ARIA's "unknown": the count is not final while pages arrive.
            // With more rows on the server, it is the server's count.
            totalRows: this.totalRowsForTable,
            hasMore: !this.loading && this.canLoadMore,
            loadingMore: this.loadingMore,
            ariaLabel: this.title,
            // Editing waits while rows are being deleted, or an action runs,
            // as it does during a save.
            saving: this.saving || this.deleting || this.acting,
            // A save of the edits, which the Save button shows with a spinner,
            // and how far a save of many batches has got.
            savingEdits: this.saving,
            saveProgress: this.saving ? this.saveProgress : '',
            // Each row's menu of actions.
            rowActions: this.rowActions,
            // Row selection, for mass update and mass delete.
            selection: this.selectionMode,
            // An edit to a selected row can go to every selected row, as Update field does.
            bulkEdit: this.canMassUpdate && !this.allMatching,
            maxSelected: MAX_SELECTED,
            selectionKey: this.selectionKey,
            diagnostics: this.diagnostics,
            frozenColumns: d.frozenColumns || 0,
            // Rows numbered down the left edge unless the admin unchecked
            // Show Row Numbers; a child table by its own grid's setting.
            rowNumbers: Boolean(this.definition) && d.showRowNumbers !== false,
            // Pixels; empty fills the window. A child table sits in a
            // panel of fixed height under its row, and is sized to fit it.
            height: this.isNested ? childTableHeight(this.level, this._parent.height) : d.height || null,
            // Tabs of related records under each row, and how deep this grid is.
            children: this.level < MAX_LEVELS && Array.isArray(d.children) ? d.children : NO_CHILDREN,
            level: this.level,
            refNames: this.refNames,
            configName: this._configName,
            // A filtered lookup is edited on the row's record with Salesforce's own lookup.
            objectApiName: d.objectApiName || null,
            // Conditional formats, checked on the server.
            displayRules: d.displayRules || [],
            // The day TODAY stands for; null for the day the rules were first read.
            formatToday: this.formatToday,
            // Grouping, and the server's counts and subtotals.
            grouping: this.grouping,
            groupSummary: this.groupSummary,
            // The org's fiscal year, for fiscal quarters and years.
            fiscal: this.fiscal,
            // How many related records each row has. A row not in it
            // yet offers no toggle, unless the counts could not be fetched.
            childCounts: this.childCounts,
            childCountsFailed: this.childCountsFailed,
            // Undo and Redo sit in the Save bar.
            history: this.hasHistory
                ? { canUndo: this.canUndo, canRedo: this.canRedo, undoLabel: this.undoLabel, redoLabel: this.redoLabel }
                : null,
            // What an empty list says, and offers.
            emptyState: this.emptyState,
            // The user's filters, and the admin's, shown locked.
            filters: this.filters,
            adminFilters: this.adminFilters,
            // The user's saved layout, applied once per key.
            userLayout: this.userLayout,
            // The values each row's record type allows its picklists.
            recordTypePicklists: this.recordTypePicklists
        };
        return memo.value;
    }

    /**
     * An empty list says why, and what to do next: a search that
     * matched nothing offers to clear it; an empty object offers an import
     * when the grid allows one.
     */
    get emptyState() {
        if (this.searchTerm) {
            return {
                title: `No records match “${this.searchTerm}”`,
                message: 'Check the spelling, or search for something else.',
                actionLabel: 'Clear search',
                icon: 'utility:search'
            };
        }
        if (this.filters.length) {
            return {
                title: 'No records match your filters',
                message: 'Change or remove a filter to see more records.',
                actionLabel: 'Clear filters',
                icon: 'utility:filterList'
            };
        }
        if (this.adminFilters.length) {
            // The admin's filters are why it is empty, not that there are no records.
            return {
                title: this.isNested
                    ? 'No related records match this grid’s filters'
                    : 'No records match this grid’s filters',
                message:
                    'Your Salesforce admin set this grid to show only some records.' +
                    (this.canImport ? ' Import a CSV or Excel file to add records.' : ''),
                actionLabel: this.canImport ? 'Import' : null,
                icon: 'utility:filterList'
            };
        }
        return {
            title: this.isNested ? 'No related records' : 'No records yet',
            message: this.canImport ? 'Import a CSV or Excel file to add records.' : '',
            actionLabel: this.canImport ? 'Import' : null,
            icon: 'utility:table'
        };
    }

    handleEmptyAction() {
        if (this.searchTerm) {
            this.clearSearch();
        } else if (this.filters.length) {
            this.setFilters(NO_FILTERS);
        } else if (this.canImport) {
            this.handleImportOpen();
        }
    }

    clearSearch() {
        clearTimeout(this._runtime.searchTimer);
        this.searchValue = '';
        if (!this.searchTerm) return;
        this.searchTerm = '';
        this.reload();
        this.loadSummary();
        this.focusButton('.rh-search');
    }

    get totalRowsForTable() {
        if (this.loading) return -1;
        return this.hasMore ? Math.max(this.totalRows, this.rows.length) : this.rows.length;
    }

    get hasDefinition() {
        return Boolean(this.definition);
    }

    /**
     * The grid has not opened yet: its name and icon are grey bars where they
     * will be, not "Records" and a generic icon that then change.
     */
    get titlePending() {
        return !this.definition && this.loading && !this.loadError;
    }

    /**
     * The bar that sweeps along the top while rows load: the first
     * load, a search, a sort the server must do, a refresh. Not while more rows
     * load as the user scrolls: the table says so where they will appear.
     */
    get showBusyBar() {
        return this.loading && !this.loadError;
    }

    get title() {
        const d = this.definition;
        return (d && (d.label || d.objectLabel)) || 'Records';
    }

    /**
     * A child table sits in its parent's tab, which already names it; its
     * title is kept for screen readers only. A card border inside the
     * parent's row would be a box in a box, so it has none.
     */
    get articleClass() {
        return this.isNested ? 'rh-app rh-app_nested' : 'slds-card rh-app';
    }

    get articleStyle() {
        return this.menuRoom ? `min-height:${this.menuRoom}px` : null;
    }

    /**
     * The compact toolbar's menu opened. In a child table, the panel round it
     * is sized to what it holds, so the grid makes room below for the whole
     * menu, and the panel grows with it until the menu closes.
     */
    handleActionsOpen() {
        if (!this.isNested) return;
        const root = this.template.querySelector('[data-view-root]');
        const menu = this.template.querySelector('.rh-actions-menu');
        if (!root || !menu) return;
        const top = root.getBoundingClientRect().top;
        const need =
            Math.ceil(menu.getBoundingClientRect().bottom - top) +
            this.menuItems.length * MENU_ITEM_HEIGHT +
            MENU_CHROME;
        this.menuRoom = need > root.getBoundingClientRect().height ? need : 0;
    }

    handleActionsClose() {
        if (this.menuRoom) this.menuRoom = 0;
    }

    get titleClass() {
        return this.isNested ? 'slds-assistive-text' : 'slds-card__header-title';
    }

    get isTruncated() {
        return !this.loading && this.moreOnServer;
    }

    /** Grey rows stand in for the first rows while they load. */
    get showPlaceholder() {
        return this.loading && !this.rows.length;
    }

    get placeholderRows() {
        return Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => ({
            key: 'p' + i,
            cls: 'rh-placeholder-row rh-placeholder-row_' + (i % 3)
        }));
    }

    /** The object's icon, as a list view shows it. */
    get objectIcon() {
        return (this.definition && this.definition.objectIcon) || 'standard:record';
    }

    /** "Sorted by Name", or "Sorted by Stage, then Name". */
    get sortedByText() {
        const d = this.definition;
        if (!d || !this.sort.length) return '';
        const labelOf = field => (d.columns.find(c => c.field === field) || {}).label || field;
        return 'Sorted by ' + this.sort.map(k => labelOf(k.field)).join(', then ');
    }

    get showMeta() {
        return !this.isNested && !this.failedEmpty;
    }

    /**
     * The rows could not be loaded and there are none to show: the error says
     * why, and an empty table under it ("No records yet", Import) would say
     * something else.
     */
    get failedEmpty() {
        return Boolean(this.loadError) && !this.rows.length;
    }

    get showTable() {
        return this.hasDefinition && !this.failedEmpty;
    }

    /** The toolbar's actions in one menu: in a child table, and below NARROW_WIDTH. */
    get compactToolbar() {
        return this.isNested || this.narrow;
    }

    get wideToolbar() {
        return !this.compactToolbar;
    }

    /** The list view's buttons: New, Import, Export. */
    get hasListButtons() {
        return this.canAddRecords || this.canImport || this.canExport;
    }

    get refreshDisabled() {
        return this.loading || this.saving || this.deleting || hasDrafts(this.drafts);
    }

    get refreshLabel() {
        return hasDrafts(this.drafts) ? 'Refresh (save or cancel your changes first)' : 'Refresh';
    }

    /** The actions of the compact toolbar's menu. */
    get menuItems() {
        const items = [];
        if (this.canAddRecords) items.push({ key: 'new', value: 'new', label: 'New', disabled: this.newDisabled });
        items.push({ key: 'refresh', value: 'refresh', label: 'Refresh', disabled: this.refreshDisabled });
        if (this.canChooseColumns)
            items.push({ key: 'columns', value: 'columns', label: 'Choose columns', disabled: false });
        if (this.canImport)
            items.push({ key: 'import', value: 'import', label: 'Import', disabled: this.importDisabled });
        if (this.canExport)
            items.push({ key: 'export', value: 'export', label: 'Export as CSV', disabled: this.exportDisabled });
        if (this.canChart)
            items.push({
                key: 'charts',
                value: 'charts',
                label: this.chartsOpen ? 'Hide charts' : 'Charts',
                disabled: false
            });
        if (this.hasDisplayKey)
            items.push({
                key: 'displayKey',
                value: 'displayKey',
                label: this.displayKeyOpen ? 'Hide Display Key' : 'Display Key',
                disabled: false
            });
        if (this.canResetLayout) items.push({ key: 'reset', value: 'reset', label: 'Reset layout', disabled: false });
        if (this.canConfigure)
            items.push({ key: 'settings', value: 'settings', label: 'Grid settings', disabled: this.settingsDisabled });
        // A child table's grid is inside one that already has Help.
        if (!this.isNested) items.push({ key: 'help', value: 'help', label: 'Help', disabled: false });
        return items;
    }

    handleMenuSelect(event) {
        const value = event.detail && event.detail.value;
        if (value === 'refresh') this.handleRefresh();
        else if (value === 'new') this.handleNew();
        else if (value === 'import') this.handleImportOpen();
        else if (value === 'export') this.handleExport();
        else if (value === 'displayKey') this.handleDisplayKeyToggle();
        else if (value === 'charts') this.handleChartsToggle();
        else if (value === 'settings') this.handleSettingsOpen();
        else if (value === 'reset') this.handleResetLayout();
        else if (value === 'columns') this.handleColumnsOpen();
        else if (value === 'help') this.handleHelp();
    }

    /**
     * The Grid Guide's User guide, in a new browser tab, so unsaved
     * changes stay where they are.
     */
    handleHelp() {
        openGuide(this, this.namespace, 'using').catch(() => {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'The Grid Guide did not open',
                    message: 'Open it from the App Launcher: search for Grid Guide.',
                    variant: 'warning'
                })
            );
        });
    }

    // ---- grid settings

    get settingsDisabled() {
        return this.loading || this.saving || this.deleting || this.acting || hasDrafts(this.drafts);
    }

    get settingsLabel() {
        return hasDrafts(this.drafts) ? 'Grid settings (save or cancel your changes first)' : 'Grid settings';
    }

    handleSettingsOpen() {
        if (!this.canConfigure || this.settingsDisabled) return;
        this.settingsOpen = true;
    }

    handleSettingsClose() {
        this.settingsOpen = false;
    }

    /** Saved: the grid loads again, from the new configuration. */
    handleSettingsSaved() {
        this.settingsOpen = false;
        this.announce('Grid settings saved. Loading the grid again.');
        this.initialise();
    }

    /**
     * Load the rows again, and their counts and subtotals. Not over unsaved
     * changes. Display rules work TODAY out again too.
     */
    handleRefresh() {
        if (this.refreshDisabled) return;
        this.announce('Refreshing the list.');
        this.formatToday = dateIn(new Date());
        this.childCounts = {};
        this.childCountsFailed = false;
        this._runtime.countToken++; // an answer still on its way is for the old list
        this.loadSummary();
        this.reload();
    }

    // ---- the Display Key

    get displayKey() {
        const d = this.definition;
        return d ? displayKeyFor(d.displayRules || []) : [];
    }

    get hasDisplayKey() {
        return this.displayKey.length > 0;
    }

    get displayKeyItems() {
        return this.displayKey.map(l => ({
            ...l,
            swatchCls: [
                'rh-display-key-swatch',
                l.bar ? 'rh-display-key-swatch_bar ' + l.bar : 'rh-display-key-swatch_cell',
                l.bar ? '' : l.cls,
                l.kind === 'databar' ? 'rh-display-key-swatch_databar' : ''
            ]
                .filter(Boolean)
                .join(' '),
            // An icon rule's sample is its icon.
            hasIcon: Boolean(l.icon),
            where: l.row ? 'Row' : 'Cell'
        }));
    }

    /**
     * Open or close the Display Key. Opening it can take a moment, so the button
     * shows a spinner first: the spinner
     * is drawn, then the key opens or closes, and the spinner goes once that
     * has been drawn. A click while it works is ignored, not a second toggle.
     */
    handleDisplayKeyToggle() {
        if (this.displayKeyBusy) return;
        this.displayKeyBusy = this.displayKeyOpen ? 'Closing the Display Key' : 'Opening the Display Key';
        afterNextPaint(() => {
            this.displayKeyOpen = !this.displayKeyOpen;
            afterNextPaint(() => {
                this.displayKeyBusy = '';
            });
        });
    }

    // ---- configuration warnings, one line until opened

    get warningsSummary() {
        const w = this.configWarnings;
        if (!w) return '';
        return `${w.length} configuration ${w.length === 1 ? 'warning' : 'warnings'} (shown with Rowhouse Grid Diagnostics only)`;
    }

    get warningsToggleLabel() {
        return this.warningsOpen ? 'Hide' : 'Show';
    }

    get warningsExpanded() {
        return String(this.warningsOpen);
    }

    handleWarningsToggle() {
        this.warningsOpen = !this.warningsOpen;
    }

    format(n) {
        return new Intl.NumberFormat(LOCALE).format(n);
    }

    /** "3 items", or "10,000 of 25,000 items"; the selection has its own bar. */
    get countLabel() {
        if (this.loading && !this.rows.length) return 'Loading…';
        const loaded = this.format(this.rows.length);
        if (this.loading) return `Loading… ${loaded} of ${this.format(this.totalRows)}`;
        if (this.moreOnServer) return `${loaded} of ${this.format(this.totalRows)} items`;
        return `${loaded} ${this.rows.length === 1 ? 'item' : 'items'}`;
    }

    /**
     * More records match than are loaded: rows still to scroll to, or, past
     * the 100,000 one grid can reach, records only a search or filter brings in.
     */
    get moreOnServer() {
        return this.hasMore || this.totalRows > this.rows.length;
    }

    /**
     * "Filtered" after the count, when the user's or the admin's filters apply.
     * Not for a record page's record alone: the grid is then what a
     * related list is, and a related list does not say "Filtered".
     */
    get isFiltered() {
        return this.filters.length > 0 || this.adminFilters.length > 0;
    }

    /** The admin's filters, as the table's locked chips show them. */
    get adminFilters() {
        const f = this.definition && this.definition.filters;
        return Array.isArray(f) && f.length ? f.map(x => ({ text: x.text })) : NO_FILTERS;
    }

    /** The page's record, for an import on a record page; a child table has its parent instead. */
    get importRecordId() {
        return this._parent ? null : this._recordId || null;
    }

    get loadedMessage() {
        if (this.moreOnServer) {
            return `Showing the first ${this.format(this.rows.length)} of ${this.format(this.totalRows)} rows.`;
        }
        return `${this.format(this.rows.length)} ${this.rows.length === 1 ? 'row' : 'rows'} loaded.`;
    }

    get truncatedMessage() {
        if (!this.canLoadMore) {
            return `${this.loadedMessage} That is the most one grid holds; search to narrow the list.`;
        }
        return `${this.loadedMessage} Scroll down to load more, or search to narrow the list. Sorting reloads from the server.`;
    }

    get searchDisabled() {
        return Boolean(this.loadError) && !this.definition;
    }

    get canExport() {
        return Boolean(this.definition && this.definition.allowCsvExport);
    }

    get exportDisabled() {
        return this.loading || !this.rows.length;
    }

    /**
     * Configuration problems that did not stop the grid, such as a skipped
     * display rule. The server sends them only to users with the
     * Rowhouse_Grid_Diagnostics permission; this checks again.
     */
    get configWarnings() {
        const w = this.diagnostics && this.definition && this.definition.warnings;
        return Array.isArray(w) && w.length ? w.map((message, i) => ({ key: 'w' + i, message })) : null;
    }

    get noticeClass() {
        const variant = this.notice && this.notice.variant === 'warning' ? 'slds-alert_warning' : 'slds-alert_error';
        return `slds-notify slds-notify_alert ${variant}`;
    }

    // ============================================================ search and sort

    /**
     * While Search this list has focus: the shown columns it does not look
     * in, in Salesforce's tooltip under the box, as a list view's search does.
     */
    get searchHint() {
        if (!this.searchFocused || !this.definition) return '';
        return searchHint(shownColumns(this.definition.columns, this.columnChoice));
    }

    handleSearchFocus() {
        this.searchFocused = true;
    }

    handleSearchBlur() {
        this.searchFocused = false;
    }

    handleSearchChange(event) {
        this.searchValue = String((event.detail && event.detail.value) || '');
        const term = this.searchValue.trim();
        clearTimeout(this._runtime.searchTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- debounce typing; cleared on disconnect
        this._runtime.searchTimer = setTimeout(() => {
            if (term === this.searchTerm) return;
            this.searchTerm = term;
            this.reload();
            this.loadSummary(); // counts and subtotals of what matches now
        }, SEARCH_DELAY_MS);
    }

    handleSortChange(event) {
        this.sort = (event.detail && event.detail.sort) || [];
        // Complete data: the table has already sorted it. Partial data: the loaded
        // rows are not the right rows for the new order, so ask the server. So
        // also for amounts in mixed currencies, which only the server can order.
        if (this.hasMore || this.sortNeedsServer(this.sort)) this.reload();
        this.rememberLayout();
    }

    /** Does this sort put amounts in mixed currencies in order? Only the server can. */
    sortNeedsServer(sort) {
        const columns = (this.definition && this.definition.columns) || [];
        return (sort || []).some(k => isMixedCurrency(columns.find(c => c.field === k.field)));
    }

    // ============================================================ filters

    /** A column filter applied or removed in the table: the rows, counts and subtotals come again. */
    handleFilterChange(event) {
        const next = event.detail && Array.isArray(event.detail.filters) ? event.detail.filters : NO_FILTERS;
        this.setFilters(next);
    }

    setFilters(next) {
        if (!next.length && !this.filters.length) return;
        // Plain objects, so what goes to the server is exactly what the panel built.
        this.filters = next.length
            ? next.map(f => ({
                  field: f.field,
                  operator: f.operator,
                  value: f.value === undefined ? null : f.value,
                  valueTo: f.valueTo === undefined ? null : f.valueTo
              }))
            : NO_FILTERS;
        this.telemetry('filter', { filters: this.filters.length });
        this.reload();
        this.loadSummary();
    }

    // ============================================================ each user's layout

    /** The table's part of the layout changed: widths, Wrap or Clip, open rows. */
    handleLayoutChange(event) {
        const d = event.detail || {};
        this._saved.table = {
            widths: d.widths && typeof d.widths === 'object' ? d.widths : null,
            wrap: d.wrap && typeof d.wrap === 'object' ? d.wrap : {},
            expanded: Array.isArray(d.expanded) ? d.expanded : [],
            groupView: d.groupView && typeof d.groupView === 'object' ? d.groupView : null,
            frozen: Number.isInteger(d.frozen) ? d.frozen : null
        };
        this.rememberLayout();
    }

    /** The layout as it is kept: JSON, version 1. */
    get layoutJson() {
        const t = this._saved.table;
        const layout = { v: 1, sort: this.sort, grouping: this.grouping };
        if (t.widths && Object.keys(t.widths).length) layout.widths = t.widths;
        if (t.wrap && Object.keys(t.wrap).length) layout.wrap = t.wrap;
        if (t.expanded && t.expanded.length) layout.expanded = t.expanded;
        if (this.columnChoice) layout.columns = this.columnChoice;
        if (Number.isInteger(t.frozen)) layout.frozen = t.frozen;
        // The groups' order and percentages, when not the default.
        const gv = t.groupView;
        if (gv && ((gv.order && gv.order.by && gv.order.by !== 'name') || gv.percent === true)) layout.groups = gv;
        if (this.chart) layout.chart = { ...this.chart, open: this.chartsOpen };
        return JSON.stringify(layout);
    }

    /** Keep the layout LAYOUT_DELAY_MS after the last change, for the grid it belongs to. */
    rememberLayout() {
        if (this._saved.off || !this.definition) return;
        clearTimeout(this._saved.timer);
        this._saved.pending = true;
        this._saved.name = this._configName;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- debounce layout saves; flushed on disconnect
        this._saved.timer = setTimeout(() => this.keepLayoutNow(), LAYOUT_DELAY_MS);
    }

    /** Keep a waiting layout now. Nothing is said if it cannot be kept, except in diagnostics. */
    keepLayoutNow() {
        clearTimeout(this._saved.timer);
        this._saved.timer = null;
        if (!this._saved.pending) return;
        this._saved.pending = false;
        const name = this._saved.name;
        // Only for the grid it was made on: a new configuration name has its own.
        if (!name || name !== this._configName || !this.definition) return;
        const json = this.layoutJson;
        if (json === this._saved.lastJson) return;
        this._saved.lastJson = json;
        // Kept as the save in flight: Reset layout waits for it, so a save that
        // reaches the server after the reset cannot bring the layout back.
        const saving = saveLayout({ configName: name, layout: json, parentLink: this.parentLink })
            .then(kept => {
                if (kept === true) {
                    if (name === this._configName) this.layoutSaved = true;
                } else {
                    if (name === this._configName) this._saved.off = true; // no access: do not try on every change
                    this.telemetry('layout', { error: 'not kept' });
                }
            })
            .catch(e => {
                if (name === this._configName) this._saved.off = true;
                this.telemetry('layout', { error: messageOf(e) });
            })
            .finally(() => {
                if (this._saved.inFlight === saving) this._saved.inFlight = null;
            });
        this._saved.inFlight = saving;
    }

    /** Reset layout is offered once a layout is kept. */
    get canResetLayout() {
        return this.layoutSaved && Boolean(this.definition);
    }

    /** The child table tab this grid is shown in, which keys its layout; null on its own. */
    get parentLink() {
        return this._parent ? this._parent.link || null : null;
    }

    /**
     * Forget this user's layout: the admin's sort, grouping, widths and
     * wrapping come back, and open rows close. The rows come again when the
     * sort changed, and when the grouping changed with rows still on the
     * server.
     */
    async handleResetLayout() {
        if (!this.canResetLayout) return;
        clearTimeout(this._saved.timer);
        this._saved.pending = false;
        const name = this._configName;
        try {
            if (this._saved.inFlight) await this._saved.inFlight; // never throws: its failures are caught
            await resetLayout({ configName: name, parentLink: this.parentLink });
        } catch (e) {
            this.notice = { variant: 'error', message: 'The layout could not be reset. ' + messageOf(e) };
            this.announce(this.notice.message);
            return;
        }
        if (name !== this._configName || !this.definition) return;
        const d = this.definition;
        const sort = adminSort(d);
        const grouping = normalizeGrouping(d.grouping, d.columns);
        const sortChanged = JSON.stringify(sort) !== JSON.stringify(this.sort);
        const groupingChanged = !sameGrouping(grouping, this.grouping);
        this.layoutSaved = false;
        this._saved.lastJson = null;
        this._saved.off = false;
        this._saved.table = { widths: null, wrap: {}, expanded: [], groupView: null, frozen: null };
        this.sort = sort;
        this.grouping = grouping;
        this.columnChoice = null;
        this.chart = null;
        this.chartsOpen = false;
        this.chartData = null;
        this._runtime.chartToken++;
        this.userLayout = {
            key: ++this._saved.key,
            widths: null,
            wrap: {},
            expanded: [],
            groupView: null,
            frozen: null,
            sort
        };
        // A new sort reads the rows again: the admin's sort field need not be a
        // column, and then the browser cannot sort by it.
        const reloading = sortChanged || (this.hasMore && groupingChanged) ? this.reload() : null;
        if (groupingChanged) this.loadSummary();
        // Said after the rows have come again, so "N rows loaded" does not replace it.
        if (reloading) await reloading;
        this.announce('Layout reset. The grid is as your admin set it up.');
        this.focusButton(this.compactToolbar ? '.rh-actions-menu' : '.rh-refresh');
    }

    // ============================================================ the user's columns

    /** Choose columns is offered when there is a choice to make. */
    get canChooseColumns() {
        const d = this.definition;
        return Boolean(d) && Array.isArray(d.columns) && d.columns.length > 1;
    }

    /**
     * A new choice of columns, from the table (Hide column, a dragged header)
     * or the dialog. It is checked against the columns and kept with the layout.
     */
    setColumnChoice(next) {
        const d = this.definition;
        if (!d) return false;
        const choice = readChoice(next, d.columns);
        if (sameChoice(choice, this.columnChoice)) return false;
        this.columnChoice = choice;
        this.telemetry('columns', { shown: shownColumns(d.columns, choice).length, of: d.columns.length });
        this.rememberLayout();
        return true;
    }

    /** Hide column, or a header dragged to a new place: the table has said what changed. */
    handleColumnsChange(event) {
        this.setColumnChoice(event.detail ? event.detail.choice : null);
    }

    handleColumnsOpen() {
        if (this.canChooseColumns) this.columnsOpen = true;
    }

    handleColumnsCancel() {
        this.columnsOpen = false;
        this.focusButton(this.compactToolbar ? '.rh-actions-menu' : '.rh-choose-columns');
    }

    /** Save in Choose columns: the columns to show, in order. */
    handleColumnsSave(event) {
        this.columnsOpen = false;
        const d = this.definition;
        const visible = event.detail && Array.isArray(event.detail.visible) ? event.detail.visible : [];
        if (d && this.setColumnChoice(chooseColumns(d.columns, this.columnChoice, visible))) {
            const shown = shownColumns(d.columns, this.columnChoice).length;
            this.announce(`Columns changed: ${shown} of ${d.columns.length} shown.`);
        }
        this.focusButton(this.compactToolbar ? '.rh-actions-menu' : '.rh-choose-columns');
    }

    // ============================================================ grouping

    /** A new grouping from a column menu. It lasts for the session. */
    handleGroupChange(event) {
        const d = this.definition;
        if (!d) return;
        const next = normalizeGrouping(event.detail && event.detail.grouping, d.columns);
        if (sameGrouping(next, this.grouping)) return;
        this.grouping = next;
        this.telemetry('group', { levels: next.length });
        // Every row loaded: the table groups them as they are. Otherwise the
        // rows must come again, in group order.
        if (this.hasMore) this.reload();
        this.loadSummary();
        this.rememberLayout();
    }

    /** Counts are wanted for a grouping; subtotals for a column that has one. */
    get needsSummary() {
        const d = this.definition;
        return Boolean(d) && (this.grouping.length > 0 || (d.columns || []).some(c => c.subtotal));
    }

    /**
     * Counts and subtotals for the current search and grouping. The first call
     * may say where the other slices of a large list start; each slice is then
     * asked for in turn and everything is added up here. A newer request, or a
     * new configuration, makes an older one's answer stale.
     */
    async loadSummary() {
        // The chart covers the same records: it is read again with them.
        this.loadChart();
        const token = ++this._runtime.summaryToken;
        if (!this.needsSummary) {
            this.groupSummary = null;
            return;
        }
        const levels = this.grouping;
        const columns = this.definition.columns;
        const params = {
            configName: this._configName,
            searchTerm: this.searchTerm || null,
            grouping: levels.map(levelParam),
            ...this.parentParams,
            ...this.filterParams
        };
        this.groupSummary = { status: 'loading' };
        const started = now();
        try {
            const first = (await summarizeGroups({ ...params, fromId: null, toId: null })) || {};
            if (token !== this._runtime.summaryToken) return;
            let groups = first.groups || [];
            let tooMany = first.tooManyGroups === true;
            const starts = first.boundaries || [];
            // Slices are sequential by design: each is its own transaction, and
            // stopping early (too many groups) saves the rest.
            for (let i = 0; i < starts.length && !tooMany; i++) {
                const range = { ...params, fromId: starts[i], toId: starts[i + 1] || null };
                // eslint-disable-next-line no-await-in-loop
                const slice = (await summarizeGroups(range)) || {};
                if (token !== this._runtime.summaryToken) return;
                groups = groups.concat(slice.groups || []);
                tooMany = slice.tooManyGroups === true;
            }
            this.telemetry('summary', {
                ms: Math.round(now() - started),
                slices: starts.length + 1,
                groups: groups.length,
                tooMany
            });
            if (tooMany) {
                this.groupSummary = { status: 'unavailable' };
                this.notice = {
                    variant: 'warning',
                    message:
                        'This list has too many groups to count. Group by fewer columns, a date by a longer period, or search to narrow the list.'
                };
                return;
            }
            this.groupSummary = { status: 'ready', totals: rollUp(groups, levels, columns) };
        } catch (e) {
            if (token !== this._runtime.summaryToken) return;
            this.groupSummary = { status: 'unavailable' };
            this.notice = { variant: 'warning', message: 'Counts and subtotals could not be loaded. ' + messageOf(e) };
        }
    }

    // ============================================================ charts

    /** A list view's Charts: on a grid with a column to group by, not in a child table. */
    get canChart() {
        const d = this.definition;
        return Boolean(d) && !this._parent && groupByColumns(d.columns).length > 0;
    }

    get showCharts() {
        return this.chartsOpen && this.canChart && Boolean(this.chart);
    }

    get chartRowClass() {
        return 'rh-chart-row' + (this.showCharts ? ' rh-chart-row_open' : '');
    }

    /** The Charts button, or Charts in the narrow menu: open or close the panel. */
    handleChartsToggle() {
        if (!this.canChart) return;
        if (this.chartsOpen) {
            this.closeCharts();
            return;
        }
        if (!this.chart) this.chart = defaultChart(this.definition.columns, this.grouping);
        if (!this.chart) return;
        this.chartsOpen = true;
        this.announce('Charts shown beside the list.');
        this.rememberLayout();
        this.loadChart();
    }

    handleChartsClose() {
        this.closeCharts();
        this.focusButton('.rh-charts');
    }

    closeCharts() {
        this.chartsOpen = false;
        this._runtime.chartToken++;
        this.announce('Charts hidden.');
        this.rememberLayout();
    }

    handleChartEdit() {
        this.chartDialogOpen = true;
    }

    handleChartDialogCancel() {
        this.chartDialogOpen = false;
        this.focusChartMenu();
    }

    handleChartDialogSave(event) {
        const chart = event.detail && event.detail.chart;
        this.chartDialogOpen = false;
        if (chart) {
            this.chart = chart;
            this.rememberLayout();
            this.loadChart();
        }
        this.focusChartMenu();
    }

    focusChartMenu() {
        Promise.resolve().then(() => {
            const panel = this.template.querySelector('c-grid-chart-panel');
            if (panel && typeof panel.focusMenu === 'function') panel.focusMenu();
        });
    }

    /**
     * The chart's figures for the current search and filters: one call, or
     * slices of a large list one after another, as the groups' subtotals are.
     * A newer request makes an older answer stale.
     */
    async loadChart() {
        const token = ++this._runtime.chartToken;
        if (!this.showCharts) return;
        const chart = this.chart;
        const params = {
            configName: this._configName,
            searchTerm: this.searchTerm || null,
            groupBy: chartParam(chart),
            measure: chart.measure,
            measureField: chart.field || null,
            ...this.parentParams,
            ...this.filterParams
        };
        this.chartData = { status: 'loading' };
        try {
            const first = (await chartGroups({ ...params, fromId: null, toId: null })) || {};
            if (token !== this._runtime.chartToken) return;
            let groups = first.groups || [];
            let tooMany = first.tooManyGroups === true;
            const starts = first.boundaries || [];
            for (let i = 0; i < starts.length && !tooMany; i++) {
                // Sequential by design: each slice is its own transaction.
                // eslint-disable-next-line no-await-in-loop
                const slice = (await chartGroups({ ...params, fromId: starts[i], toId: starts[i + 1] || null })) || {};
                if (token !== this._runtime.chartToken) return;
                groups = groups.concat(slice.groups || []);
                tooMany = slice.tooManyGroups === true;
            }
            this.chartData = tooMany ? { status: 'tooMany' } : { status: 'ready', groups };
        } catch (e) {
            if (token !== this._runtime.chartToken) return;
            this.chartData = { status: 'error', message: messageOf(e) };
        }
    }

    // ============================================================ child tables

    /** This grid lists tabs of related records under its rows. */
    get hasChildTabs() {
        const d = this.definition;
        return Boolean(d) && this.level < MAX_LEVELS && Array.isArray(d.children) && d.children.length > 0;
    }

    /**
     * How many related records these rows have, per tab, so a row with
     * none offers no toggle. Asked for in batches of COUNT_BATCH, one after
     * another, for rows not already known; a new configuration makes an older
     * answer stale. A row offers no toggle until its count arrives, so rows
     * with none do not flash one (found in Lightning Experience). If the
     * counts cannot be fetched, every row offers it instead.
     */
    async loadChildCounts(ids) {
        if (!this.hasChildTabs) return;
        const wanted = (ids || []).filter(id => id && !this.childCounts[id]);
        if (!wanted.length) return;
        const token = this._runtime.countToken;
        try {
            for (let i = 0; i < wanted.length; i += COUNT_BATCH) {
                // Sequential by design: each is a transaction of its own, and a
                // stale answer stops the rest.
                // eslint-disable-next-line no-await-in-loop
                const counts = await countChildren({
                    configName: this._configName,
                    parentIds: wanted.slice(i, i + COUNT_BATCH)
                });
                if (token !== this._runtime.countToken) return;
                this.childCounts = { ...this.childCounts, ...(counts || {}) };
            }
        } catch (e) {
            // Every row without a count offers its toggle; nothing else depends on them.
            if (token === this._runtime.countToken) this.childCountsFailed = true;
            this.telemetry('childcounts', { failed: messageOf(e) });
        }
    }

    /** A child table's count changed (an import, a delete): its row's count follows. */
    handleChildCount(event) {
        const { parentId, tab, count } = event.detail || {};
        const n = Number(count);
        if (!parentId || !tab || !Number.isFinite(n)) return;
        const before = this.childCounts[parentId] || { total: 0, byTab: {} };
        const byTab = { ...before.byTab, [tab]: n };
        const total = Object.values(byTab).reduce((sum, v) => sum + (Number(v) || 0), 0);
        this.childCounts = { ...this.childCounts, [parentId]: { total, byTab } };
    }

    /**
     * A child grid tells its tab how many records it has, after a load,
     * a delete or an import: the whole count, not a search's or a filter's
     * (a filtered count of 0 would hide the parent row's toggle).
     */
    reportCount() {
        if (!this.isNested || this.searchTerm || this.filters.length || this.loading) return;
        const count = this.hasMore ? Math.max(this.totalRows, this.rows.length) : this.rows.length;
        if (count === this._reported.count) return;
        this._reported.count = count;
        this.dispatchEvent(new CustomEvent('countchange', { detail: { count } }));
    }

    // ============================================================ editing

    handleCellChange(event) {
        const { recordId, field, value, originalValue, valueLabel } = event.detail;
        // A parent record's field changes on every row with that parent, as one step.
        const spread = withSameParent(
            [{ recordId, field, value, originalValue, valueLabel }],
            this.rows,
            this.pathFields
        );
        if (spread.length > 1) {
            this.applyChanges('edit', spread, []);
            return;
        }
        this.learnName(value, valueLabel);
        const before = this.drafts;
        this.drafts = applyEdit(this.drafts, recordId, field, value, originalValue);
        this.errors = clearCellError(this.errors, recordId, field);
        this.history = record(this.history, stepBetween('edit', before, this.drafts, [{ recordId, field }]));
    }

    /** A lookup's New item: open Salesforce's record form for the object. */
    handleNewRecord(event) {
        const d = event.detail || {};
        if (!d.recordId || !d.field || !d.object) return;
        this.newRecord = { recordId: d.recordId, field: d.field, object: d.object, objectLabel: d.objectLabel || '' };
    }

    get newRecordFieldLabel() {
        return this.newRecord && this.newRecord.field ? this.newRecordFieldLabelFor(this.newRecord.field) : '';
    }

    /** Focus goes back where the form was opened from: the New button, or the lookup's cell. */
    handleNewRecordCancel() {
        const pending = this.newRecord;
        this.newRecord = null;
        if (pending && pending.mode === 'row') this.focusButton('.rh-new');
        else Promise.resolve().then(() => this.focus());
    }

    /**
     * The new record is saved: it goes in the cell as an unsaved change, one
     * undo step, with its name, as a record chosen from the list would.
     */
    async handleNewRecordCreated(event) {
        const pending = this.newRecord;
        const id = event.detail && event.detail.id;
        this.newRecord = null;
        if (!pending || !id) return;
        if (pending.mode === 'row') {
            await this.addCreatedRecord(id, pending.objectLabel);
            return;
        }
        let name = null;
        try {
            name = await lookupName({ configName: this._configName, field: pending.field, recordId: id });
        } catch {
            name = null; // the cell shows the name once the row is saved and read back
        }
        const row = this.rows.find(r => r.Id === pending.recordId);
        this.handleCellChange({
            detail: {
                recordId: pending.recordId,
                field: pending.field,
                value: id,
                originalValue: row ? row[pending.field] : null,
                valueLabel: name
            }
        });
        this.announce(
            `${pending.objectLabel || 'Record'} ${name || ''} created and put in ${this.newRecordFieldLabelFor(pending.field)}. Save to keep the change.`.replace(
                /\s+/g,
                ' '
            )
        );
        Promise.resolve().then(() => this.focus());
    }

    newRecordFieldLabelFor(field) {
        const d = this.definition;
        const column = d ? d.columns.find(c => c.field === field) : null;
        return column ? column.label : field;
    }

    /**
     * A paste, fill-down or clear from the table: many cells, one undo step.
     * Values the table could not read come as errors on their cells; those
     * cells keep what they had.
     */
    handleCellsChange(event) {
        const { label, changes = [], errors = [] } = event.detail || {};
        this.applyChanges(label || 'change', changes, errors);
    }

    /** The columns that show a field of a parent record, made once per definition. */
    get pathFields() {
        const d = this.definition;
        if (this._memo.pathFieldsFor !== d) {
            this._memo.pathFieldsFor = d;
            this._memo.pathFields = new Set(((d && d.columns) || []).filter(c => c.isPath).map(c => c.field));
        }
        return this._memo.pathFields;
    }

    /**
     * Many cells as one undo step: a paste, a fill, a clear or a mass update.
     * A change to a parent record's field is made on every loaded row with
     * that parent too.
     */
    applyChanges(label, edits, errors) {
        const changes = withSameParent(edits, this.rows, this.pathFields);
        changes.forEach(c => this.learnName(c.value, c.valueLabel));
        const before = this.drafts;
        this.drafts = applyEdits(before, changes);
        let cellErrors = this.errors;
        changes.forEach(c => {
            cellErrors = clearCellError(cellErrors, c.recordId, c.field);
        });
        const refused = {};
        errors.forEach(e => {
            refused[e.recordId] = refused[e.recordId] || { row: null, fields: {} };
            refused[e.recordId].fields[e.field] = e.message;
        });
        this.errors = mergeErrors(cellErrors, refused);
        this.history = record(this.history, stepBetween(label, before, this.drafts, changes));
    }

    /** Undo and Redo are offered only where something can be edited. */
    get hasEditableColumns() {
        const d = this.definition;
        return Boolean(d && d.allowInlineEdit && (d.columns || []).some(c => c.editable));
    }

    /** ... or filled in on a new row. */
    get hasHistory() {
        return this.hasEditableColumns || Boolean(this.newRowContext && this.newRowContext.inline);
    }

    get canUndo() {
        return !this.saving && this.history.undo.length > 0;
    }

    get canRedo() {
        return !this.saving && this.history.redo.length > 0;
    }

    get undoDisabled() {
        return !this.canUndo;
    }

    get redoDisabled() {
        return !this.canRedo;
    }

    get undoLabel() {
        const step = this.history.undo[this.history.undo.length - 1];
        return step ? `Undo ${describeStep(step)}` : 'Undo';
    }

    get redoLabel() {
        const step = this.history.redo[this.history.redo.length - 1];
        return step ? `Redo ${describeStep(step)}` : 'Redo';
    }

    handleUndo() {
        this.moveInHistory(undoStep, 'Undid', 'Nothing to undo.');
    }

    handleRedo() {
        this.moveInHistory(redoStep, 'Redid', 'Nothing to redo.');
    }

    moveInHistory(move, verb, nothing) {
        if (this.saving) return;
        const result = move(this.history, this.drafts);
        if (!result) {
            this.announce(nothing);
            return;
        }
        this.history = result.history;
        this.drafts = result.drafts;
        // An error was about the value the cell had; that value has changed.
        let cellErrors = this.errors;
        result.step.cells.forEach(c => {
            cellErrors = clearCellError(cellErrors, c.recordId, c.field);
        });
        this.errors = cellErrors;
        this.announce(`${verb} ${describeStep(result.step)}.`);
    }

    handleCancel() {
        if (this.saving) return;
        this.drafts = {};
        this.newRows = [];
        this.focusRow = null;
        this.errors = {};
        this.history = emptyHistory();
        this.notice = null;
        this.announce('Changes discarded.');
    }

    async handleSave() {
        if (this.saving || this.deleting || !hasDrafts(this.drafts)) return;
        // Required fields first, without a round trip: those blanked, and those
        // a new row leaves empty. The server checks again.
        const columns = this.definition ? this.definition.columns : [];
        const missing = mergeErrors(
            requiredErrors(this.drafts, columns),
            newRowRequiredErrors(this.drafts, this.newRowsByKey, columns)
        );
        const blanks = Object.values(missing).reduce((n, e) => n + Object.keys(e.fields).length, 0);
        if (blanks) {
            this.errors = mergeErrors(this.errors, missing);
            this.announce(
                `${blanks} required ${blanks === 1 ? 'field is' : 'fields are'} blank. Complete ${blanks === 1 ? 'it' : 'them'}, then save.`
            );
            return;
        }
        const sent = this.drafts;
        // New rows are created first, then the changes to saved records are saved.
        const { creates, updates } = splitDrafts(sent);
        const started = now();
        this.saving = true;
        this.notice = null;
        this.saveProgress = '';
        this.announce('Saving…');
        try {
            const made = Object.keys(creates).length
                ? await this.createNewRows(creates)
                : { drafts: {}, errors: {}, created: [], rejectedFields: [], strippedFields: [], failed: [] };
            let result = { successCount: 0, errors: [], rejectedFields: [], strippedFields: [] };
            let settled = { drafts: {}, errors: {} };
            if (hasDrafts(updates)) {
                const ticket = await saveRows({ configName: this._configName, rows: toPayload(updates) });
                const final = ticket.done ? ticket : await this.pollUntilDone(ticket);
                // The ticket carries what was refused up front; the final status
                // carries what each batch reported. Together they are the answer.
                result = {
                    successCount: final.successCount || 0,
                    errors: (ticket.done ? [] : ticket.errors || []).concat(final.errors || []),
                    rejectedFields: ticket.rejectedFields || [],
                    strippedFields: ticket.strippedFields || []
                };
                const failed = new Set(result.errors.map(e => e.recordId));
                const savedIds = Object.keys(updates).filter(id => !failed.has(id));
                // Rows that show a parent record the save changed are read again too.
                const sharing = rowsSharingParents(this.rows, updates, savedIds, this.pathFields);
                if (savedIds.length) await this.refreshRows(savedIds.concat(sharing), updates);
                settled = applyRefusedFields(applySaveResult(updates, result), updates, result);
            }
            this.drafts = carryNewEdits(this.drafts, sent, { ...made.drafts, ...settled.drafts });
            this.errors = mergeErrors(settled.errors, made.errors);
            // Saved values belong to the record now; undo covers unsaved edits.
            this.history = emptyHistory();
            const both = {
                successCount: result.successCount + made.created.length,
                errors: result.errors.concat(made.failed.map(key => ({ recordId: key }))),
                rejectedFields: [...new Set(result.rejectedFields.concat(made.rejectedFields))],
                strippedFields: [...new Set(result.strippedFields.concat(made.strippedFields))]
            };
            this.reportSave(both, Math.round(now() - started));
            // Saved values can move a record to another group or change a subtotal.
            if (both.successCount) this.loadSummary();
        } catch (e) {
            // Nothing is thrown away: the drafts stay, so the user can retry.
            this.notice = { variant: 'error', message: 'Your changes were not saved. ' + messageOf(e) };
            this.announce(this.notice.message);
        } finally {
            this.saving = false;
            this.saveProgress = '';
        }
    }

    async pollUntilDone(ticket) {
        const deadline = now() + POLL_TIMEOUT_MS;
        let attempt = 0;
        let status = ticket;
        while (!status.done) {
            if (now() > deadline) {
                throw new Error(
                    'The save is still running on the server. Reload the list in a minute to see the result.'
                );
            }
            // eslint-disable-next-line no-await-in-loop
            await delay(POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]);
            attempt++;
            // eslint-disable-next-line no-await-in-loop
            status = await saveStatus({ saveId: ticket.saveId });
            const total = status.chunkCount || ticket.chunkCount || 0;
            if (total > 1) this.saveProgress = `Saving… ${status.chunksReported || 0} of ${total} batches done.`;
        }
        return status;
    }

    /**
     * Re-read saved rows so formulas, rounding and triggers show their real
     * result; after an action, whatever it changed. `sent` holds the
     * values to show for a row that could not be re-read.
     */
    async refreshRows(ids, sent, failure = 'Saved, but the saved rows could not be re-read. ') {
        const fresh = {};
        try {
            for (let i = 0; i < ids.length; i += REREAD_BATCH) {
                // eslint-disable-next-line no-await-in-loop
                const batch = await fetchRowsById({
                    configName: this._configName,
                    recordIds: ids.slice(i, i + REREAD_BATCH)
                });
                (batch || []).forEach(r => {
                    fresh[r.Id] = r;
                });
                this.learnNames(batch);
            }
        } catch (e) {
            // The save itself succeeded; show the typed values rather than fail.
            this.notice = { variant: 'warning', message: failure + messageOf(e) };
        }
        const savedIds = new Set(ids);
        this.rows = this.rows.map(r => {
            if (fresh[r.Id]) return fresh[r.Id];
            return savedIds.has(r.Id) ? { ...r, ...sent[r.Id] } : r;
        });
    }

    reportSave(result, ms) {
        const failedRecords = new Set(result.errors.map(e => e.recordId)).size;
        const refused = result.rejectedFields.length + result.strippedFields.length;
        const saved = result.successCount;
        // "Saved 0 records" reads as a success; say plainly when nothing saved.
        let message = saved
            ? `Saved ${this.format(saved)} ${saved === 1 ? 'record' : 'records'}.`
            : 'Nothing was saved.';
        if (failedRecords)
            message += ` ${failedRecords} ${failedRecords === 1 ? 'record has' : 'records have'} errors.`;
        if (refused) message += ' Some fields were not saved; see the marked cells.';
        this.announce(message);
        let title = 'Saved';
        let variant = 'success';
        if (!saved) {
            title = 'Not saved';
            variant = 'error';
        } else if (failedRecords || refused) {
            title = 'Saved with errors';
            variant = 'warning';
        }
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
        this.telemetry('save', { ms, saved, failedRecords, refusedFields: refused });
    }

    // ============================================================ new records

    /** The grid has a New button for this user. */
    get canAddRecords() {
        return Boolean(this.newRowContext) && Boolean(this.definition);
    }

    get newDisabled() {
        return this.loading || this.saving || this.deleting || this.acting;
    }

    /** What New does here, for its tooltip. */
    get newLabel() {
        const context = this.newRowContext;
        if (context && context.inline) return 'New: add a row at the top of the grid, then save';
        return context && context.objectLabel
            ? `New: open Salesforce's New ${context.objectLabel} form`
            : "New: open Salesforce's form for a new record";
    }

    /**
     * The new rows the table shows: those whose draft still carries the
     * new-row mark (Undo takes it away). The same array as before while
     * the same rows show, so a keystroke does not re-sort the table (HR-17).
     */
    get shownNewRows() {
        const m = this._memo;
        if (!this.newRows.length) return this.newRows;
        const next = this.newRows.filter(r => this.drafts[r.Id] && this.drafts[r.Id][NEW_MARK] === true);
        const prev = m.shownNewRows;
        if (prev && prev.length === next.length && prev.every((r, i) => r === next[i])) return prev;
        m.shownNewRows = next;
        return next;
    }

    /** { [key]: new row }, for the save and the required check. */
    get newRowsByKey() {
        const out = {};
        this.newRows.forEach(r => {
            out[r.Id] = r;
        });
        return out;
    }

    /**
     * New: a row at the top of the grid where a new record can be one, else
     * Salesforce's New form.
     */
    handleNew() {
        const ctx = this.newRowContext;
        if (!ctx || !this.definition || this.newDisabled) return;
        if (ctx.inline) {
            this.addRow();
            return;
        }
        this.newRecord = {
            mode: 'row',
            object: this.definition.objectApiName,
            objectLabel: ctx.objectLabel || '',
            presets: ctx.presets || null
        };
    }

    /**
     * An empty row at the top, as the new record will start: Salesforce's
     * defaults and the parent it belongs under. One undo step. The table
     * puts focus in its first cell that can be filled in.
     */
    addRow() {
        const ctx = this.newRowContext;
        const n = ++this._runtime.newCount;
        const key = newRowKey(n);
        const names = ctx.names || {};
        Object.keys(names).forEach(id => this.learnName(id, names[id]));
        // Its record type, the user's default, decides what its picklists offer.
        const type = this.definition.byRecordType && ctx.recordTypeId ? { RecordTypeId: ctx.recordTypeId } : {};
        this.newRows = this.newRows.concat([{ Id: key, ...type, ...(ctx.defaults || {}), ...(ctx.presets || {}) }]);
        const before = this.drafts;
        this.drafts = addNewRow(before, key);
        this.history = record(
            this.history,
            stepBetween('new row', before, this.drafts, [{ recordId: key, field: NEW_MARK }])
        );
        this.focusRow = { id: key, seq: n };
        this.announce('New row added at the top of the grid. Fill it in, then save.');
    }

    /**
     * Create the new rows' records, CREATE_BATCH at a time, and read each one
     * created back into the grid. { drafts, errors } of the rows that were
     * not created, the keys of those (failed), the records created, and
     * the fields refused.
     */
    async createNewRows(creates) {
        const columns = this.definition ? this.definition.columns : [];
        const payload = toCreatePayload(creates, this.newRowsByKey, columns);
        const answer = { rows: [] };
        let rejectedFields = [];
        let strippedFields = [];
        for (let i = 0; i < payload.length; i += CREATE_BATCH) {
            // eslint-disable-next-line no-await-in-loop
            const res = await createRows({
                configName: this._configName,
                rows: payload.slice(i, i + CREATE_BATCH),
                parentLink: this._parent ? this._parent.link : null,
                parentId: this._parent ? this._parent.id : null,
                recordId: this._parent ? null : this._recordId || null
            });
            answer.rows = answer.rows.concat((res && res.rows) || []);
            rejectedFields = rejectedFields.concat((res && res.rejectedFields) || []);
            strippedFields = strippedFields.concat((res && res.strippedFields) || []);
        }
        const state = applyCreateResult(creates, answer);
        if (state.created.length) {
            const done = new Set(state.created.map(c => c.key));
            await this.addRecords(state.created.map(c => c.recordId));
            this.newRows = this.newRows.filter(r => !done.has(r.Id));
        }
        return {
            drafts: state.drafts,
            errors: state.errors,
            created: state.created,
            failed: Object.keys(state.errors),
            rejectedFields,
            strippedFields
        };
    }

    /**
     * Records just created, read back as the grid shows them and added at
     * the top of its rows, where the user sees them; the next sort or
     * refresh puts them in their place.
     */
    async addRecords(ids) {
        let fresh = [];
        try {
            for (let i = 0; i < ids.length; i += REREAD_BATCH) {
                // eslint-disable-next-line no-await-in-loop
                const batch = await fetchRowsById({
                    configName: this._configName,
                    recordIds: ids.slice(i, i + REREAD_BATCH)
                });
                fresh = fresh.concat(batch || []);
            }
        } catch (e) {
            this.notice = {
                variant: 'warning',
                message: 'Created, but the new records could not be read. Refresh to see them. ' + messageOf(e)
            };
            return [];
        }
        const known = new Set(this.rows.map(r => r.Id));
        const added = fresh.filter(r => !known.has(r.Id));
        this.learnNames(added);
        if (added.length) {
            this.rows = added.concat(this.rows);
            this.totalRows = (Number(this.totalRows) || 0) + added.length;
            this.reportCount();
        }
        return added;
    }

    /** Salesforce's New form created a record: it joins the grid, as on a list view. */
    async addCreatedRecord(id, objectLabel) {
        const added = await this.addRecords([id]);
        const row = added[0];
        const nameColumn = this.definition ? this.definition.columns.find(c => c.isName) : null;
        const name = row && nameColumn ? row[nameColumn.field] : '';
        const label = objectLabel || 'Record';
        const message = name ? `${label} "${name}" was created.` : `${label} was created.`;
        this.dispatchEvent(new ShowToastEvent({ title: message, message: '', variant: 'success' }));
        this.announce(message);
        if (row) {
            // The table puts focus on the new record's row, at the top.
            this.focusRow = { id: row.Id, seq: ++this._runtime.newCount };
            this.loadSummary();
        } else {
            Promise.resolve().then(() => this.focus());
        }
    }

    // ============================================================ selection, mass update, mass delete

    get canMassUpdate() {
        return this.hasEditableColumns;
    }

    /** The server narrows allowMassDelete to users who may delete the object; it checks again on every call. */
    get canMassDelete() {
        return Boolean(this.definition && this.definition.allowMassDelete);
    }

    get selectionMode() {
        return this.canMassUpdate || this.canMassDelete || this.selectionActions.length ? 'multi' : undefined;
    }

    get massColumns() {
        return (this.definition && this.definition.columns) || [];
    }

    /** Update field: a picklist offers the values every selected row's record type allows. */
    get massUpdateColumns() {
        const columns = this.massColumns;
        const byType = this.recordTypePicklists;
        if (!byType) return columns;
        const rows = this.selectedRows;
        return columns.map(c =>
            c.type === 'picklist' || c.type === 'multipicklist' ? { ...c, options: sharedOptions(c, rows, byType) } : c
        );
    }

    /**
     * One reader (c/gridRecordTypeValues) for each record type among the rows,
     * while the grid's picklists follow record types (the definition's
     * byRecordType): { id, objectApiName }.
     */
    get recordTypeReaders() {
        const d = this.definition;
        if (!d || !d.byRecordType) return [];
        const memo = this._readers;
        if (memo.rows === this.rows && memo.newRows === this.newRows && memo.object === d.objectApiName) {
            return memo.value;
        }
        const ids = new Set();
        this.rows.concat(this.newRows).forEach(r => {
            if (r && r.RecordTypeId) ids.add(String(r.RecordTypeId));
        });
        memo.rows = this.rows;
        memo.newRows = this.newRows;
        memo.object = d.objectApiName;
        memo.value = [...ids].map(id => ({ id, objectApiName: d.objectApiName }));
        return memo.value;
    }

    handleRecordTypeValues(event) {
        const { recordTypeId, fields } = event.detail || {};
        if (!recordTypeId || !fields) return;
        this.recordTypePicklists = { ...(this.recordTypePicklists || {}), [recordTypeId]: fields };
    }

    get selectedCount() {
        return this.selectedIds.length;
    }

    get massDisabled() {
        return (
            !this.selectedIds.length || this.saving || this.deleting || this.acting || this.loading || this.restoring
        );
    }

    /** Update field and the actions work on loaded rows only: not with every match selected. */
    get massEditDisabled() {
        return this.massDisabled || this.allMatching;
    }

    /**
     * "Select all N matching records": every loaded row is selected (or
     * as many as one selection holds), and more records match on the server.
     */
    get canSelectAllMatching() {
        const n = this.selectedIds.length;
        return (
            this.canMassDelete &&
            !this.allMatching &&
            n > 0 &&
            n >= Math.min(this.rows.length, MAX_SELECTED) &&
            this.totalRows > n &&
            this.totalRows <= MAX_DELETE_ALL
        );
    }

    get selectAllMatchingLabel() {
        return `Select all ${this.format(this.totalRows)} matching records`;
    }

    handleSelectAllMatching() {
        this.allMatching = true;
        this.announce(
            `All ${this.format(this.totalRows)} matching records selected. Delete deletes every one; Update field and actions work on loaded rows.`
        );
    }

    /** The bar that appears with a selection. */
    get hasSelectionBar() {
        return this.selectedIds.length > 0;
    }

    /**
     * The selection bar floats, centred just under the header (gridView.css),
     * so the table does not move under the pointer when the first row is
     * ticked (found in Lightning Experience: the second click
     * landed a row higher), and the header stays in view and usable. Narrow, the title takes the first line and
     * the search the second: side by side, the title was cut to "Consignm…"
     * and its count line broke into six lines (found at 420px in Lightning
     * Experience).
     */
    get headerClass() {
        return (
            'slds-card__header slds-grid slds-wrap slds-grid_vertical-align-center rh-header' +
            (this.narrow && !this.isNested ? ' rh-header_narrow' : '')
        );
    }

    get selectedText() {
        if (this.allMatching) return `All ${this.format(this.totalRows)} matching records selected`;
        return `${this.format(this.selectedIds.length)} selected`;
    }

    /** The selected rows as they are now, unsaved edits included, for the mass update dialog. */
    get selectedRows() {
        const wanted = new Set(this.selectedIds);
        return this.rows
            .filter(r => wanted.has(r.Id))
            .map(r => (this.drafts[r.Id] ? { ...r, ...this.drafts[r.Id] } : r));
    }

    handleClearSelection() {
        this.clearSelection();
        this.announce('Selection cleared.');
        this.focus();
    }

    handleSelectionChange(event) {
        this.selectedIds = (event.detail && event.detail.selectedIds) || [];
        this.allMatching = false;
    }

    clearSelection() {
        if (this.selectedIds.length) this.selectedIds = [];
        this.allMatching = false;
        this.selectionKey++;
    }

    handleMassUpdateOpen() {
        if (this.massDisabled || !this.canMassUpdate) return;
        this.massUpdateOpen = true;
    }

    handleMassUpdateCancel() {
        this.massUpdateOpen = false;
        this.focusButton('.rh-mass-edit');
    }

    /** The dialog's value, as unsaved edits on the selected rows: one undo step. */
    handleMassUpdateApply(event) {
        const { field, value, valueLabel } = event.detail || {};
        this.massUpdateOpen = false;
        if (this.applyToRows('mass update', this.selectedIds, field, value, valueLabel))
            this.focusButton('.rh-mass-edit');
    }

    /**
     * An edit to one of several selected rows, for them all: the cell
     * editor's "Update N selected items", or Ctrl+Enter (the table's
     * applyselected). As Update field: the selected rows that are loaded,
     * one undo step. Focus stays in the grid, on the cell.
     */
    handleApplySelected(event) {
        const { recordId, field, value, valueLabel } = event.detail || {};
        if (!recordId || this.allMatching) return;
        const ids = this.selectedIds.includes(recordId) ? this.selectedIds : [recordId];
        this.applyToRows('edit', ids, field, value, valueLabel);
    }

    /**
     * Give a column one value on these rows, as unsaved edits: one undo step,
     * with each row's own checks (c/gridUpdateField massChanges). Says what
     * changed, and warns when a row kept its value or a dependent value was
     * cleared. Returns whether anything was tried.
     */
    applyToRows(label, ids, field, value, valueLabel) {
        const d = this.definition;
        const column = d && (d.columns || []).find(c => c.field === field && c.editable);
        if (!column || this.saving || this.deleting) return false;
        this.learnName(value, valueLabel);
        const rowById = new Map(this.rows.map(r => [r.Id, r]));
        const { changes, errors, cleared } = massChanges({
            ids,
            column,
            value,
            rowById,
            drafts: this.drafts,
            columns: d.columns
        });
        this.applyChanges(label, changes, errors);
        const set = changes.length - cleared.length;
        let message = `${column.label} changed on ${this.format(set)} ${set === 1 ? 'row' : 'rows'}. Save to keep it; Undo takes it back.`;
        if (errors.length) {
            message += ` ${this.format(errors.length)} ${errors.length === 1 ? 'row keeps its' : 'rows keep their'} value; see the marked cells.`;
        }
        if (cleared.length) {
            const fields = [
                ...new Set(cleared.map(c => (d.columns.find(x => x.field === c.field) || {}).label || c.field))
            ];
            message += ` ${fields.join(', ')} cleared on ${this.format(cleared.length)} ${cleared.length === 1 ? 'row' : 'rows'}: the old value does not go with the new ${column.label}.`;
        }
        this.announce(message);
        if (errors.length || cleared.length) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Changed, with exceptions', message, variant: 'warning' }));
        }
        this.telemetry('massupdate', { rows: set, refused: errors.length, cleared: cleared.length });
        return true;
    }

    /**
     * Delete the selected rows, after the user confirms in c/gridDeleteDialog,
     * which names them: batches of DELETE_BATCH, one after another. A
     * batch the server refuses outright stops the rest; rows it could not
     * delete stay, with the reason.
     */
    handleMassDelete() {
        if (this.massDisabled || !this.canMassDelete) return;
        const loaded = new Set(this.rows.map(r => r.Id));
        const ids = this.selectedIds.filter(id => loaded.has(id));
        if (!ids.length) return;
        this._pendingDelete = { ids, all: this.allMatching };
        this.deleteOpen = true;
    }

    /** The first rows' names, for the dialog: the name column's, as the grid shows them. */
    get deleteNames() {
        const d = this.definition;
        const col = d && (d.columns.find(c => c.isName) || d.columns[0]);
        if (!col) return [];
        const byId = new Map(this.rows.map(r => [r.Id, r]));
        return this._pendingDelete.ids.slice(0, 5).map(id => {
            const r = byId.get(id);
            const v = r ? r[col.field] : null;
            return v === null || v === undefined ? '' : String(v);
        });
    }

    get deleteCount() {
        return this._pendingDelete.all ? this.totalRows : this._pendingDelete.ids.length;
    }

    get deleteMatching() {
        return this._pendingDelete.all === true;
    }

    get deleteHasDrafts() {
        return this._pendingDelete.ids.some(id => this.drafts[id]);
    }

    handleDeleteCancel() {
        const row = this._pendingDelete.row === true;
        this.deleteOpen = false;
        this._pendingDelete = { ids: [], all: false };
        // A row's Delete came from its menu: back to the grid, where the menu was.
        if (row) Promise.resolve().then(() => this.focus());
        else this.focusButton('.rh-mass-delete');
    }

    async handleDeleteConfirm() {
        const { ids, all, row } = this._pendingDelete;
        const total = this.totalRows;
        this.deleteOpen = false;
        this._pendingDelete = { ids: [], all: false };
        if (!ids.length || this.saving || this.deleting) return;
        if (all) {
            await this.deleteAllMatching(total);
            return;
        }
        const n = ids.length;
        const noun = `${this.format(n)} ${n === 1 ? 'record' : 'records'}`;
        const started = now();
        this.deleting = true;
        this.notice = null;
        this.announce(`Deleting ${noun}…`);
        const deleted = [];
        const failed = [];
        let stopped = null;
        for (let i = 0; i < n; i += DELETE_BATCH) {
            try {
                // Batches are sequential by design: each is its own transaction.
                // eslint-disable-next-line no-await-in-loop
                const result = await deleteRows({
                    configName: this._configName,
                    recordIds: ids.slice(i, i + DELETE_BATCH)
                });
                deleted.push(...((result && result.deletedIds) || []));
                failed.push(...((result && result.errors) || []));
            } catch (e) {
                stopped = messageOf(e);
                break;
            }
            if (n > DELETE_BATCH)
                this.saveProgress = `Deleting… ${this.format(Math.min(i + DELETE_BATCH, n))} of ${this.format(n)}`;
        }
        this.removeRows(deleted);
        if (failed.length) {
            const rowErrors = {};
            failed.forEach(e => {
                rowErrors[e.recordId] = { row: e.message, fields: {} };
            });
            this.errors = mergeErrors(this.errors, rowErrors);
        }
        // A row's Delete leaves the selection alone, unless it took a selected row.
        if (!row || ids.some(id => this.selectedIds.includes(id))) this.clearSelection();
        this.deleting = false;
        this.saveProgress = '';
        this.undoDelete = deleted.length ? { ids: deleted } : null;
        this.reportDelete(deleted.length, failed.length, stopped, Math.round(now() - started));
        if (deleted.length) {
            this.loadSummary();
            this.reportCount();
        }
        // The selection bar is gone with the selection: focus goes back to the grid.
        Promise.resolve().then(() => this.focus());
    }

    /**
     * Delete every record the grid's search and filters match: the
     * server lists them MATCH_SLICE at a time, in Id order, and each slice is
     * deleted DELETE_BATCH at a time, as a selection is. A record that cannot
     * be deleted is passed over (the next slice starts after it). Then the
     * grid loads again: the deleted records were not all loaded.
     */
    async deleteAllMatching(total) {
        const started = now();
        const noun = `${this.format(total)} ${total === 1 ? 'record' : 'records'}`;
        this.deleting = true;
        this.notice = null;
        this.announce(`Deleting ${noun}…`);
        const base = {
            configName: this._configName,
            searchTerm: this.searchTerm || null,
            ...this.parentParams,
            ...this.filterParams
        };
        const deleted = [];
        const failed = [];
        let stopped = null;
        let afterId = null;
        while (!stopped && deleted.length + failed.length < MAX_DELETE_ALL) {
            let ids;
            try {
                // eslint-disable-next-line no-await-in-loop
                ids = ((await matchingIds({ ...base, afterId })) || {}).ids || [];
            } catch (e) {
                stopped = messageOf(e);
                break;
            }
            for (let i = 0; i < ids.length && !stopped; i += DELETE_BATCH) {
                try {
                    // Batches are sequential by design: each is its own transaction.
                    // eslint-disable-next-line no-await-in-loop
                    const result = await deleteRows({
                        configName: this._configName,
                        recordIds: ids.slice(i, i + DELETE_BATCH)
                    });
                    deleted.push(...((result && result.deletedIds) || []));
                    failed.push(...((result && result.errors) || []));
                } catch (e) {
                    stopped = messageOf(e);
                }
                this.saveProgress = `Deleting… ${this.format(deleted.length + failed.length)} of ${this.format(total)}`;
            }
            if (ids.length < MATCH_SLICE) break;
            afterId = ids[ids.length - 1];
        }
        this.deleting = false;
        this.saveProgress = '';
        this.undoDelete = deleted.length ? { ids: deleted } : null;
        this.reportDelete(
            deleted.length,
            failed.length,
            stopped,
            Math.round(now() - started),
            failed.length ? failed[0].message : null
        );
        this.reload();
        if (deleted.length) this.loadSummary();
        Promise.resolve().then(() => this.focus());
    }

    // ------------------------------------------------------------ undo a delete

    get undoDeleteText() {
        const n = this.undoDelete ? this.undoDelete.ids.length : 0;
        if (this.restoring) return `Putting back ${this.format(n)} ${n === 1 ? 'record' : 'records'}…`;
        return `Deleted ${this.format(n)} ${n === 1 ? 'record' : 'records'}. ${n === 1 ? 'It is' : 'They are'} in the Recycle Bin.`;
    }

    get undoDeleteDisabled() {
        return this.restoring || this.saving || this.deleting;
    }

    handleUndoDeleteClose() {
        this.undoDelete = null;
    }

    /** Put the records the last delete took out back from the Recycle Bin, then load the grid again. */
    async handleUndoDelete() {
        if (!this.undoDelete || this.undoDeleteDisabled) return;
        const ids = this.undoDelete.ids;
        this.restoring = true;
        this.announce(this.undoDeleteText);
        const restored = [];
        const failed = [];
        let stopped = null;
        for (let i = 0; i < ids.length; i += DELETE_BATCH) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const result = await restoreRows({
                    configName: this._configName,
                    recordIds: ids.slice(i, i + DELETE_BATCH)
                });
                restored.push(...((result && result.restoredIds) || []));
                failed.push(...((result && result.errors) || []));
            } catch (e) {
                stopped = messageOf(e);
                break;
            }
        }
        this.restoring = false;
        this.undoDelete = null;
        let message = restored.length
            ? `Put back ${this.format(restored.length)} ${restored.length === 1 ? 'record' : 'records'}.`
            : 'Nothing was put back.';
        if (failed.length) message += ` ${this.format(failed.length)} could not be: ${failed[0].message}`;
        if (stopped) message += ` ${restored.length ? 'The rest were not put back: ' : ''}${stopped}`;
        const variant = !restored.length ? 'error' : failed.length || stopped ? 'warning' : 'success';
        this.announce(message);
        this.dispatchEvent(
            new ShowToastEvent({ title: variant === 'success' ? 'Undone' : 'Undo incomplete', message, variant })
        );
        this.telemetry('restore', { restored: restored.length, failed: failed.length, stopped: Boolean(stopped) });
        if (restored.length) {
            this.reload();
            this.loadSummary();
        }
    }

    /** Take deleted rows out of the grid, with their unsaved edits, errors and undo steps. */
    removeRows(ids) {
        if (!ids.length) return;
        const gone = new Set(ids);
        this.rows = this.rows.filter(r => !gone.has(r.Id));
        const drafts = { ...this.drafts };
        const errors = { ...this.errors };
        ids.forEach(id => {
            delete drafts[id];
            delete errors[id];
        });
        this.drafts = drafts;
        this.errors = errors;
        this.history = withoutRecords(this.history, ids);
        this.totalRows = Math.max(0, this.totalRows - ids.length);
    }

    reportDelete(deleted, failed, stopped, ms, why = null) {
        let message;
        if (deleted) message = `Deleted ${this.format(deleted)} ${deleted === 1 ? 'record' : 'records'}.`;
        else if (stopped && !failed) message = `Nothing was deleted: ${stopped}`;
        else message = 'Nothing was deleted.';
        // Every match: the rows are not all loaded to be marked, so the first reason is said.
        if (failed)
            message += why
                ? ` ${this.format(failed)} could not be deleted: ${why}`
                : ` ${this.format(failed)} could not be deleted; see the marked rows.`;
        if (stopped && (deleted || failed)) message += ` The rest were not deleted: ${stopped}`;
        let title = 'Deleted';
        let variant = 'success';
        if (!deleted) {
            title = 'Not deleted';
            variant = 'error';
        } else if (failed || stopped) {
            title = 'Deleted with errors';
            variant = 'warning';
        }
        this.announce(message);
        // A clean delete is said by the Undo bar under the header; a toast is for what went wrong.
        if (variant !== 'success') this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
        this.telemetry('delete', { ms, deleted, failed, stopped: Boolean(stopped) });
    }

    // ============================================================ actions

    /**
     * The grid's actions, split once per configuration: each row's menu gets
     * [{ name, label }], the same array until the configuration changes (the
     * table is handed it in its config, HR-17); the selection bar gets the
     * actions themselves.
     */
    get rowActions() {
        this.splitActions();
        return this._memo.rowActions;
    }

    get selectionActions() {
        this.splitActions();
        return this._memo.selectionActions;
    }

    splitActions() {
        const m = this._memo;
        if (m.actionsFrom === this.definition && m.rowActions) return;
        const all = this.definition && Array.isArray(this.definition.actions) ? this.definition.actions : [];
        m.actionsFrom = this.definition;
        const d = this.definition || {};
        const own = [];
        if (d.canEditRecords) own.push({ name: ROW_EDIT, label: 'Edit' });
        if (d.allowMassDelete) own.push({ name: ROW_DELETE, label: 'Delete' });
        if (d.canChangeOwner) own.push({ name: ROW_OWNER, label: 'Change Owner' });
        m.rowActions = own.concat(all.filter(a => a.onRow).map(a => ({ name: a.name, label: a.label })));
        m.selectionActions = all.filter(a => a.onSelection);
    }

    actionNamed(name) {
        const all = this.definition && Array.isArray(this.definition.actions) ? this.definition.actions : [];
        return all.find(a => a.name === name) || null;
    }

    /** Up to MAX_ACTION_BUTTONS selection actions are buttons; more are one menu. */
    get selectionActionButtons() {
        const list = this.selectionActions;
        return list.length <= MAX_ACTION_BUTTONS ? list.map(a => ({ key: a.name, name: a.name, label: a.label })) : [];
    }

    get selectionActionMenu() {
        const list = this.selectionActions;
        return list.length > MAX_ACTION_BUTTONS ? list.map(a => ({ key: a.name, name: a.name, label: a.label })) : null;
    }

    /** A row's menu (the table's rowaction): the action, on that record. */
    handleRowAction(event) {
        const { action, recordId } = event.detail || {};
        if (recordId && (action === ROW_EDIT || action === ROW_DELETE || action === ROW_OWNER)) {
            this.startRowCommand(action, recordId);
            return;
        }
        const a = this.actionNamed(action);
        if (!a || !a.onRow || !recordId) return;
        this.startAction(a, [recordId], 'row');
    }

    /**
     * The row menu's Edit, Delete or Change Owner, on one record. Delete asks
     * in the delete dialog, which says when the row has unsaved changes; Edit
     * and Change Owner save the record outside the grid's Save, so they wait
     * until the row's changes are saved or cancelled.
     */
    startRowCommand(action, recordId) {
        if (this.saving || this.deleting || this.acting || this.restoring) return;
        const d = this.definition || {};
        if (action === ROW_DELETE) {
            if (!d.allowMassDelete) return;
            this._pendingDelete = { ids: [recordId], all: false, row: true };
            this.deleteOpen = true;
            return;
        }
        if (this.drafts[recordId]) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Unsaved changes',
                    message:
                        action === ROW_EDIT
                            ? 'Save or cancel the changes to this row, then edit it.'
                            : 'Save or cancel the changes to this row, then change its owner.',
                    variant: 'warning'
                })
            );
            return;
        }
        const name = this.namesOf([recordId])[0] || '';
        if (action === ROW_EDIT && d.canEditRecords) {
            this.editRecord = { recordId, objectApiName: d.objectApiName, name };
        } else if (action === ROW_OWNER && d.canChangeOwner) {
            this.ownerChange = { recordId, name, busy: false, error: '' };
        }
    }

    handleEditRecordCancel() {
        this.editRecord = null;
        Promise.resolve().then(() => this.focus());
    }

    /** Salesforce saved the record: read the row again, as after a save. */
    async handleEditRecordSaved() {
        const pending = this.editRecord;
        this.editRecord = null;
        if (!pending) return;
        await this.refreshRows([pending.recordId], {}, 'Saved, but the row could not be read again. ');
        this.loadSummary();
        const name = this.namesOf([pending.recordId])[0] || pending.name;
        const message = name ? `"${name}" was saved.` : 'The record was saved.';
        this.announce(message);
        this.dispatchEvent(new ShowToastEvent({ title: 'Saved', message, variant: 'success' }));
        Promise.resolve().then(() => this.focus());
    }

    handleOwnerCancel() {
        if (this.ownerChange && this.ownerChange.busy) return;
        this.ownerChange = null;
        Promise.resolve().then(() => this.focus());
    }

    /**
     * Change Owner, saved at once. A refusal, or the record's own error,
     * keeps the dialog open with the reason; success reads the row again.
     */
    async handleOwnerConfirm(event) {
        const pending = this.ownerChange;
        const { ownerId, ownerName } = event.detail || {};
        if (!pending || pending.busy || !ownerId) return;
        this.ownerChange = { ...pending, busy: true, error: '' };
        let result;
        try {
            result = await changeOwner({ configName: this._configName, recordIds: [pending.recordId], ownerId });
        } catch (e) {
            this.ownerChange = { ...pending, busy: false, error: messageOf(e) };
            return;
        }
        const errors = (result && result.errors) || [];
        if (errors.length) {
            this.ownerChange = { ...pending, busy: false, error: errors[0].message };
            return;
        }
        this.ownerChange = null;
        await this.refreshRows([pending.recordId], {}, 'The owner was changed, but the row could not be read again. ');
        this.loadSummary();
        const message = `${pending.name || 'The record'} is now owned by ${ownerName || 'the new owner'}.`;
        this.announce(message);
        this.dispatchEvent(new ShowToastEvent({ title: 'Owner changed', message, variant: 'success' }));
        Promise.resolve().then(() => this.focus());
    }

    /** A selection bar button, or its Actions menu: the action, on the selected rows. */
    handleSelectionAction(event) {
        const name = (event.detail && event.detail.value) || event.currentTarget.dataset.action;
        const a = this.actionNamed(name);
        if (!a || !a.onSelection || this.massDisabled) return;
        const loaded = new Set(this.rows.map(r => r.Id));
        const ids = this.selectedIds.filter(id => loaded.has(id));
        if (ids.length) this.startAction(a, ids, 'selection');
    }

    /**
     * A screen flow opens on its own page, a quick action in Salesforce's
     * window. An autolaunched flow asks first for a selection, when the admin
     * gave it a question, or when a row has unsaved changes; otherwise it runs
     * at once.
     */
    startAction(action, ids, source) {
        if (this.saving || this.deleting || this.acting || this.actionDialog) return;
        if (action.type === 'screen_flow') {
            this.openScreenFlow(action, ids, source);
            return;
        }
        if (action.type === 'quick_action') {
            if (ids.length === 1) this.openQuickAction(action, ids[0]);
            return;
        }
        this._pendingAction = { action, ids, source };
        const unsaved = ids.some(id => this.drafts[id]);
        if (source === 'selection' || action.confirmation || unsaved) {
            this.actionDialog = {
                label: action.label,
                question: action.confirmation || '',
                names: this.namesOf(ids),
                count: ids.length,
                hasDrafts: unsaved
            };
            return;
        }
        this.runServerAction();
    }

    /** The page this grid is on: where a screen flow comes back to. */
    @wire(CurrentPageReference)
    setPageReference(ref) {
        this._flow.page = ref || null;
        const sent = this._flow.sent;
        if (!sent || !ref || doneToken(ref, this.namespace) !== sent.token) return;
        // The flow this grid sent the user to is back: read its rows again.
        this._flow.sent = null;
        this.telemetry('action', { kind: 'screen_flow', records: sent.ids.length });
        this.announce(`${sent.action.label}: back from the flow. Reading its rows again.`);
        this.refreshAfterAction(sent.ids);
    }

    /** The namespace this grid runs in: c, or the package's, for the flow page's name and state. */
    get namespace() {
        return namespaceOf(this.template.host);
    }

    /**
     * Go to the screen flow's page (c/rowhouseFlow), which runs it and comes
     * back. Not over unsaved changes: leaving the page could lose them.
     */
    openScreenFlow(action, ids, source) {
        if (hasDrafts(this.drafts)) {
            const message = `Save or cancel your changes first: ${action.label} opens on its own page.`;
            this.announce(message);
            this.dispatchEvent(new ShowToastEvent({ title: action.label, message, variant: 'warning' }));
            return;
        }
        const ns = this.namespace;
        const token = newToken();
        let store = null;
        try {
            store = typeof sessionStorage === 'undefined' ? null : sessionStorage;
        } catch {
            store = null;
        }
        const ref = flowPageRef(
            ns,
            { grid: this._configName, action: action.name, on: source, ids, back: backRef(this._flow.page, ns), token },
            store
        );
        if (!ref) {
            const message = `${action.label} cannot take so many rows in this browser. Select fewer and run it again.`;
            this.announce(message);
            this.dispatchEvent(new ShowToastEvent({ title: action.label, message, variant: 'error' }));
            return;
        }
        this._flow.sent = { token, action, ids };
        this[NavigationMixin.Navigate](ref);
    }

    /**
     * Open the quick action's own window over this page, on one row. Not over
     * that row's unsaved changes: the window works on the saved record.
     */
    openQuickAction(action, recordId) {
        const toast = (message, variant) => {
            this.announce(message);
            this.dispatchEvent(new ShowToastEvent({ title: action.label, message, variant }));
        };
        if (this.drafts[recordId]) {
            toast(
                `Save or cancel your changes to this row first: ${action.label} works on the saved record.`,
                'warning'
            );
            return;
        }
        const url = quickActionUrl(action.quickActionName, recordId, currentAddress());
        if (!url) {
            toast(`${action.label} can't open here: Salesforce opens quick actions in Lightning Experience.`, 'error');
            return;
        }
        this.watchQuickAction(action, recordId);
        this.telemetry('action', { kind: 'quick_action', records: 1 });
        this[NavigationMixin.Navigate]({ type: 'standard__webPage', attributes: { url } });
    }

    /**
     * Watch the address: once the window has opened and closed (Save or
     * Cancel), read the row again. A hidden tab's timers are slowed to as
     * little as once a minute (measured), so a check may come too late to
     * see the window at all: after QUICK_OPEN_WAIT_MS the row is read again
     * anyway, once.
     */
    watchQuickAction(action, recordId) {
        this.stopWatchingQuickAction();
        const started = now();
        let opened = false;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- nothing tells the page when Salesforce's window closes
        const timer = setInterval(() => {
            if (isQuickActionPath(currentAddress())) {
                opened = true;
                return;
            }
            if (!opened && now() - started < QUICK_OPEN_WAIT_MS) return; // not open yet
            this.stopWatchingQuickAction();
            this.announce(
                opened ? `${action.label}: closed. Reading the row again.` : `${action.label}: reading the row again.`
            );
            this.refreshAfterAction([recordId]);
        }, QUICK_POLL_MS);
        this._quick = { sent: { action, recordId }, timer };
    }

    stopWatchingQuickAction() {
        if (this._quick.timer) clearInterval(this._quick.timer);
        this._quick = { sent: null, timer: null };
    }

    /** The first rows' names, for a dialog: the name column's, as the grid shows them. */
    namesOf(ids) {
        const d = this.definition;
        const col = d && (d.columns.find(c => c.isName) || d.columns[0]);
        if (!col) return [];
        const byId = new Map(this.rows.map(r => [r.Id, r]));
        return ids.slice(0, 5).map(id => {
            const r = byId.get(id);
            const v = r ? r[col.field] : null;
            return v === null || v === undefined ? '' : String(v);
        });
    }

    handleActionCancel() {
        this.actionDialog = null;
        this._pendingAction = { action: null, ids: [], source: null };
        this.focus();
    }

    handleActionConfirm() {
        this.actionDialog = null;
        this.runServerAction();
    }

    /**
     * Run the pending server action, ACTION_BATCH records per call, one call
     * after another: each is its own transaction. A call the server refuses
     * outright stops the rest; records it could not run on keep a row error.
     */
    async runServerAction() {
        const { action, ids } = this._pendingAction;
        this._pendingAction = { action: null, ids: [], source: null };
        if (!action || !ids.length || this.saving || this.deleting || this.acting) return;
        const n = ids.length;
        const started = now();
        this.acting = true;
        this.notice = null;
        this.announce(`${action.label}: running on ${this.format(n)} ${n === 1 ? 'record' : 'records'}…`);
        const done = [];
        const failed = [];
        let stopped = null;
        for (let i = 0; i < n; i += ACTION_BATCH) {
            try {
                // Batches are sequential by design: each is its own transaction.
                // eslint-disable-next-line no-await-in-loop
                const result = await runAction({
                    configName: this._configName,
                    actionName: action.name,
                    recordIds: ids.slice(i, i + ACTION_BATCH)
                });
                done.push(...((result && result.succeededIds) || []));
                failed.push(...((result && result.errors) || []));
            } catch (e) {
                stopped = messageOf(e);
                break;
            }
            if (n > ACTION_BATCH)
                this.saveProgress = `${action.label}… ${this.format(Math.min(i + ACTION_BATCH, n))} of ${this.format(n)}`;
        }
        // A record that ran now has no error from an earlier run; one that did not, says why.
        const errors = { ...this.errors };
        done.forEach(id => {
            const entry = errors[id];
            if (!entry || !entry.row) return;
            if (Object.keys(entry.fields || {}).length) errors[id] = { ...entry, row: null };
            else delete errors[id];
        });
        failed.forEach(e => {
            const before = errors[e.recordId] || { row: null, fields: {} };
            errors[e.recordId] = { ...before, row: `${action.label}: ${e.message}` };
        });
        this.errors = errors;
        this.acting = false;
        this.saveProgress = '';
        this.reportAction(action, done.length, failed.length, stopped, Math.round(now() - started));
        const ran = done.concat(failed.map(e => e.recordId));
        if (ran.length) this.refreshAfterAction(ran);
        Promise.resolve().then(() => this.focus());
    }

    /** The action may have changed its rows, their groups and subtotals: read them again. */
    refreshAfterAction(ids) {
        const loaded = new Set(this.rows.map(r => r.Id));
        const mine = ids.filter(id => loaded.has(id));
        if (!mine.length) return;
        this.refreshRows(mine, {}, 'The action ran, but its rows could not be read again. ');
        this.loadSummary();
    }

    reportAction(action, done, failed, stopped, ms) {
        const label = action.label;
        let message;
        if (done) message = `${label}: done on ${this.format(done)} ${done === 1 ? 'record' : 'records'}.`;
        else if (stopped && !failed) message = `${label} did not run: ${stopped}`;
        else message = `${label} did not run.`;
        if (failed) message += ` ${this.format(failed)} failed; see the marked ${failed === 1 ? 'row' : 'rows'}.`;
        if (stopped && (done || failed)) message += ` It did not run on the rest: ${stopped}`;
        let title = label;
        let variant = 'success';
        if (!done) variant = 'error';
        else if (failed || stopped) {
            title = `${label}, with errors`;
            variant = 'warning';
        }
        this.announce(message);
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
        this.telemetry('action', { kind: action.type, ms, done, failed, stopped: Boolean(stopped) });
    }

    // ============================================================ import

    get canImport() {
        return Boolean(this.definition && this.definition.allowImport) && this.hasEditableColumns;
    }

    get canCreate() {
        return Boolean(this.definition && this.definition.canCreate);
    }

    get importDisabled() {
        return this.loading || this.saving || this.deleting || hasDrafts(this.drafts);
    }

    get importLabel() {
        return hasDrafts(this.drafts)
            ? 'Import from a file (save or cancel your changes first)'
            : 'Import from a CSV or Excel file';
    }

    handleImportOpen() {
        if (this.importDisabled || !this.canImport) return;
        this.importOpen = true;
    }

    /**
     * Anything written means the loaded rows are out of date: reload them.
     * The import button is disabled while the list reloads, and a disabled
     * button cannot hold focus, so focus goes back to it once the reload is
     * done: unless another load has started since, or the user has moved
     * focus into the grid meanwhile.
     */
    handleImportClose(event) {
        this.importOpen = false;
        if (!(event.detail && event.detail.changed)) {
            this.focusButton('.rh-import');
            return;
        }
        this.announce('Import finished. Reloading the list.');
        this.loadSummary();
        const token = this._runtime.token + 1; // the token reload() takes
        this.reload().then(() => {
            if (token === this._runtime.token && !this.loading && !this.template.activeElement)
                this.focusButton('.rh-import');
        });
    }

    /**
     * Focus goes back to the button that opened a dialog, after the dialog is
     * gone: in the compact toolbar that button is a menu item, so the menu.
     */
    focusButton(selector) {
        Promise.resolve().then(() => {
            const button = this.template.querySelector(selector) || this.template.querySelector('.rh-actions-menu');
            if (button && typeof button.focus === 'function') button.focus();
        });
    }

    // ============================================================ export

    handleExport() {
        const d = this.definition;
        if (!d || !this.rows.length) return;
        const byField = {};
        d.columns.forEach(c => {
            byField[c.field] = c;
        });
        // A picklist sorts in its own order, as on screen.
        const keys = this.sort.map(k => {
            const c = byField[k.field] || {};
            return {
                field: k.field,
                direction: k.direction,
                type: c.type,
                ranks: c.type === 'picklist' ? picklistRanks(c.options) : null,
                mixed: isMixedCurrency(c)
            };
        });
        // The configuration holds only columns this user can read (forUser), and
        // toCsv writes only the columns it is given.
        // The record Id comes first, so the file can come back in as an import.
        // The columns this user sees, in their order: export writes what is on screen.
        const shown = shownColumns(d.columns, this.columnChoice);
        const columns = [{ field: 'Id', label: 'Id', type: 'id' }].concat(
            shown.map(c => ({ field: c.field, label: c.label, type: c.type }))
        );
        const csv = toCsv(sortRows(this.rows, keys), columns);
        if (!downloadCsv(csv, this.exportFileName, this.template.querySelector('.rh-download'))) {
            const refused = 'This browser did not allow the file to be downloaded.';
            this.announce(refused);
            this.dispatchEvent(new ShowToastEvent({ title: 'Not exported', message: refused, variant: 'error' }));
            return;
        }
        let message = `Exported ${this.format(this.rows.length)} rows.`;
        if (hasDrafts(this.drafts)) message += ' Unsaved changes are not included.';
        if (this.hasMore) message += ' Only the loaded rows were exported.';
        this.announce(message);
    }

    get exportFileName() {
        const base =
            String(this.title)
                .replace(/[^A-Za-z0-9 _-]+/g, '')
                .trim()
                .replace(/\s+/g, '-') || 'export';
        return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    // ============================================================ helpers

    announce(message) {
        this.announcement = message;
    }

    telemetry(event, data) {
        if (!this.diagnostics) return;
        const entry = { source: 'rowhouse', event, grid: this._configName, at: new Date().toISOString(), ...data };
        // Structured telemetry, only with the Rowhouse_Grid_Diagnostics permission.
        console.info('[rowhouse]', JSON.stringify(entry));
    }
}
