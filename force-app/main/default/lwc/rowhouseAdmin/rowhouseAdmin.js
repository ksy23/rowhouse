/**
 * rowhouseAdmin — the Grid Admin tab (laid out as): every grid
 * configuration in the org, the editor (c/gridConfigEditor) to change one or
 * build a new one, and Rowhouse's own settings, without going into Setup.
 *
 * LAYOUT
 * The Grid Guide's header and look: the logo, the tab's name, and two pages
 * as the guide's tabs draw them.
 *   Grids     the Welcome page's heading and stat cards (grids, objects,
 *             grids that log every change, grids with child tables, how long
 *             the edit log keeps its entries), then the list, searched by
 *             title or API name and sorted by any of its columns, a heading
 *             clicked once A to Z and again Z to A. Opening a grid shows
 *             the editor in its page layout, with the Grid Guide beside it.
 *             Each row's menu: Edit, Clone and Archive. Archived grids
 *             leave the list and the cards. A side navigation, as the
 *             Grid Guide's pages have, chooses what the list shows: Available
 *             grids, Archived grids (each with Restore and Delete in Setup;
 *             c/gridAdminRowDialog does the rest), or one object's grids.
 *   Settings  Rowhouse-wide settings: the Grid Edit Log's retention.
 *
 * The tab is the Rowhouse Grid Admin permission set's; the server refuses
 * everyone else (GridAdmin.requireAdmin), and this page then says what is
 * needed. Saving also needs Customize Application: without it the page still
 * lists and opens grids, and says why it cannot save.
 *
 * NO PUBLIC INPUTS
 * It is exposed only so it can be a Lightning tab (lightning__Tab). It has no
 * @api members, so it adds nothing permanent to the package (HR-2).
 */
import { LightningElement } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import listConfigs from '@salesforce/apex/GridAdminController.listConfigs';
import canSaveConfig from '@salesforce/apex/GridAdminController.canSave';
import logRetention from '@salesforce/apex/GridAdminController.logRetention';
import LOGO from '@salesforce/resourceUrl/RowhouseLogo';
import LOCALE from '@salesforce/i18n/locale';
import { openGuide, guideRef, guideUrl } from 'c/guideRoute';
import { namespaceOf } from 'c/gridFlowRoute';

/** The tab's two pages, in the order its header shows them. */
const VIEWS = [
    { id: 'grids', label: 'Grids' },
    { id: 'settings', label: 'Settings' }
];
/** What the list shows: the grids in use, the archived ones, or one object's API name. */
const AVAILABLE = '';
export const ARCHIVED = '__archived__';

/** The list's columns that sort, in the order they show; Grid Title first, A to Z. */
const SORT_COLUMNS = [
    { key: 'label', label: 'Grid Title' },
    { key: 'name', label: 'API name' },
    { key: 'objectLabel', label: 'Object' },
    { key: 'columns', label: 'Columns', numeric: true }
];

/** Two grids compared by one column: numbers as numbers, text as a person reads it (case aside, 9 before 10). */
function compareBy(a, b, key) {
    if (key === 'columns') return (a.columns || 0) - (b.columns || 0);
    const text = c => String((key === 'objectLabel' ? c.objectLabel || c.objectApiName : c[key]) || '');
    return text(a).localeCompare(text(b), LOCALE, { sensitivity: 'base', numeric: true });
}

const DONE_TOASTS = {
    clone: (label, configName) => ({ title: 'Grid cloned', message: `${configName} is a copy of ${label}.` }),
    archive: label => ({ title: 'Grid archived', message: `${label} is under Archived grids, in the side navigation.` }),
    restore: label => ({ title: 'Grid restored', message: `${label} is back under Available grids.` })
};

/** An Apex error's message, whatever shape it arrived in. */
function messageOf(error) {
    if (!error) return 'Unknown error.';
    const body = error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    if (Array.isArray(body)) return body.map(e => e && e.message).filter(Boolean).join(' ');
    return error.message || String(error);
}

export default class RowhouseAdmin extends NavigationMixin(LightningElement) {
    configs = [];
    loading = false;
    loadError = null;
    canSave = false;
    /** The page shown: grids or settings. */
    view = 'grids';
    /** The grid being edited: its API name, '' for a new one, null while a page shows. */
    editing = null;
    /** How long the edit log keeps its entries, as the Settings page says it: Forever, 1 year… */
    retentionLabel = '…';
    /** The side navigation's choice: AVAILABLE, ARCHIVED or an object's API name. */
    listView = AVAILABLE;
    search = '';
    /** The list's sort: a key of SORT_COLUMNS, and asc or desc. */
    sortBy = 'label';
    sortDir = 'asc';
    /** Said to a screen reader once a heading is clicked; empty until then. */
    sortAnnouncement = '';
    /** The row dialog open: { action, grid }, or null. */
    dialog = null;

    // Non-reactive (HR-20).
    _runtime = { token: 0, pendingView: null };

    get logoUrl() {
        return LOGO;
    }

    connectedCallback() {
        this.load(true);
    }

    disconnectedCallback() {
        this._runtime.token++;
    }

    /** The Grid Guide's Get started page, for the Get started link. */
    get startUrl() {
        return guideUrl(namespaceOf(this.template.host), 'start');
    }

    /** Get started: the Grid Guide tab, in this browser tab (nothing is unsaved on the list). */
    handleGuideLink(event) {
        if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        this[NavigationMixin.Navigate](guideRef(namespaceOf(this.template.host), 'start'));
    }

    /** Getting started, in the Grid Guide, in a new browser tab. */
    handleHelp() {
        openGuide(this, namespaceOf(this.template.host), 'start').catch(() => {
            this.dispatchEvent(
                new ShowToastEvent({ title: 'The Grid Guide did not open', message: 'Open the Grid Guide tab in the Rowhouse app.', variant: 'warning' })
            );
        });
    }

    /** The list of grids and the edit log's retention; quietly (no spinner) when only being brought up to date. */
    async load(showSpinner) {
        const token = ++this._runtime.token;
        if (showSpinner) this.loading = true;
        try {
            const [configs, canSave] = await Promise.all([listConfigs(), canSaveConfig()]);
            if (token !== this._runtime.token) return;
            this.configs = configs || [];
            this.canSave = canSave === true;
            this.loadError = null;
            this.keepViewReal();
        } catch (e) {
            if (token === this._runtime.token) this.loadError = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.loading = false;
        }
        this.loadRetention(token);
    }

    /** The retention card's figure. Its own call, so a problem there leaves the list alone. */
    async loadRetention(token) {
        try {
            const status = await logRetention();
            if (token !== this._runtime.token) return;
            this.retentionLabel = (status && status.label) || 'Forever';
        } catch {
            if (token === this._runtime.token) this.retentionLabel = '—';
        }
    }

    // ============================================================ the header's pages

    get navItems() {
        return VIEWS.map(v => {
            const current = this.view === v.id;
            return {
                id: v.id,
                label: v.label,
                current: current ? 'page' : null,
                className: current ? 'rh-admin-nav-item rh-admin-nav-item_current' : 'rh-admin-nav-item'
            };
        });
    }

    /** A page in the header, or the retention card's Settings link. Leaving the editor asks first when there are unsaved changes. */
    handleNav(event) {
        event.preventDefault();
        const view = event.currentTarget.dataset.view;
        if (!VIEWS.some(v => v.id === view)) return;
        if (this.editing !== null) {
            this._runtime.pendingView = view;
            const editor = this.template.querySelector('c-grid-config-editor');
            if (editor) editor.requestClose();
            else this.handleEditorClose();
            return;
        }
        if (view === this.view) return;
        this.view = view;
        if (view === 'grids') this.load(false);
    }

    get showList() {
        return this.editing === null && !this.loadError && this.view === 'grids';
    }

    get showSettings() {
        return this.editing === null && !this.loadError && this.view === 'settings';
    }

    get showEditor() {
        return this.editing !== null && !this.loadError;
    }

    // ============================================================ the Grids page

    /** The grids in use: everything the cards count and the list shows, except under Archived. */
    get activeConfigs() {
        return this.configs.filter(c => c.archived !== true);
    }

    get archivedConfigs() {
        return this.configs.filter(c => c.archived === true);
    }

    get showingArchived() {
        return this.listView === ARCHIVED;
    }

    /** One object's grids in use, when the side navigation names an object. */
    get showingObject() {
        return this.listView !== AVAILABLE && this.listView !== ARCHIVED;
    }

    /** What the list is drawn from: the grids in use, the archived ones, or one object's grids in use. */
    get listSource() {
        if (this.showingArchived) return this.archivedConfigs;
        if (this.showingObject) return this.activeConfigs.filter(c => c.objectApiName === this.listView);
        return this.activeConfigs;
    }

    get hasConfigs() {
        return this.listSource.length > 0;
    }

    /** Under Archived grids, what archiving means; not over an empty list. */
    get showArchivedNote() {
        return this.showingArchived && this.hasConfigs;
    }

    /** An object whose last grid was archived: back to Available grids. */
    keepViewReal() {
        if (!this.showingObject) return;
        if (!this.objectCounts.some(o => o.value === this.listView)) this.listView = AVAILABLE;
    }

    /** The stat cards' figures, from the grids in use. */
    get stats() {
        const n = new Intl.NumberFormat(LOCALE);
        const active = this.activeConfigs;
        const grids = active.length;
        const objects = new Set(active.map(c => c.objectApiName)).size;
        const logging = active.filter(c => c.logChanges === true).length;
        const children = active.filter(c => (c.childTables || 0) > 0).length;
        return {
            grids: n.format(grids),
            gridsLabel: grids === 1 ? 'grid' : 'grids',
            objects: n.format(objects),
            objectsLabel: objects === 1 ? 'object' : 'objects',
            logging: n.format(logging),
            loggingLabel: logging === 1 ? 'grid logs every change' : 'grids log every change',
            children: n.format(children),
            childrenLabel: children === 1 ? 'grid with child tables' : 'grids with child tables'
        };
    }

    /** Each object the grids in use show, A to Z, with how many grids it has. */
    get objectCounts() {
        const counts = new Map();
        this.activeConfigs.forEach(c => {
            const entry = counts.get(c.objectApiName) || { value: c.objectApiName, label: c.objectLabel || c.objectApiName, count: 0 };
            entry.count++;
            counts.set(c.objectApiName, entry);
        });
        return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label, LOCALE));
    }

    /**
     * The side navigation, as the Grid Guide's pages draw theirs:
     * Grids (Available, Archived), then By object, each with its count.
     */
    get sideGroups() {
        const n = new Intl.NumberFormat(LOCALE);
        const item = (value, label, count) => {
            const current = this.listView === value;
            return {
                key: `view-${value || 'available'}`,
                value,
                label,
                count: n.format(count),
                ariaLabel: `${label}, ${n.format(count)} ${count === 1 ? 'grid' : 'grids'}`,
                current: current ? 'page' : null,
                className: current ? 'rh-admin-side-link rh-admin-side-link_current' : 'rh-admin-side-link'
            };
        };
        const groups = [
            {
                key: 'grids',
                label: 'Grids',
                items: [item(AVAILABLE, 'Available grids', this.activeConfigs.length), item(ARCHIVED, 'Archived grids', this.archivedConfigs.length)]
            }
        ];
        const objects = this.objectCounts;
        if (objects.length) groups.push({ key: 'objects', label: 'By object', items: objects.map(o => item(o.value, o.label, o.count)) });
        return groups;
    }

    handleSideNav(event) {
        event.preventDefault();
        this.listView = event.currentTarget.dataset.value || AVAILABLE;
    }

    handleSearch(event) {
        this.search = (event.detail && event.detail.value) || event.target.value || '';
    }

    /** The grids the list shows: the side navigation's choice, matching the search in the title or API name. */
    get visibleConfigs() {
        const q = this.search.trim().toLowerCase();
        return this.listSource.filter(c => {
            if (!q) return true;
            return String(c.label || '').toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q);
        });
    }

    get hasRows() {
        return this.visibleConfigs.length > 0;
    }

    /**
     * The grids the list shows, in the chosen order. Ties go by Grid
     * Title, then API name, A to Z, whichever way the column sorts.
     */
    get sortedConfigs() {
        const key = this.sortBy;
        const sign = this.sortDir === 'desc' ? -1 : 1;
        return [...this.visibleConfigs].sort(
            (a, b) => sign * compareBy(a, b, key) || compareBy(a, b, 'label') || compareBy(a, b, 'name')
        );
    }

    /** The list's headings, each a button that sorts by it, with aria-sort on the current one. */
    get columnHeads() {
        return SORT_COLUMNS.map(c => {
            const current = this.sortBy === c.key;
            const desc = current && this.sortDir === 'desc';
            let className = c.numeric ? 'rh-admin-sortable rh-admin-num' : 'rh-admin-sortable';
            if (current) className += ' rh-admin-sorted';
            return {
                key: c.key,
                label: c.label,
                sortLabel: `Sort by ${c.label}`,
                ariaSort: current ? (desc ? 'descending' : 'ascending') : 'none',
                className,
                iconName: desc ? 'utility:arrowdown' : 'utility:arrowup',
                title: current ? `Sorted ${desc ? 'Z to A' : 'A to Z'}. Click to reverse.` : `Sort by ${c.label}`
            };
        });
    }

    /** A heading: sort by it, A to Z; the current one again: reverse it. */
    handleSort(event) {
        const column = SORT_COLUMNS.find(c => c.key === event.currentTarget.dataset.key);
        if (!column) return;
        if (column.key === this.sortBy) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = column.key;
            this.sortDir = 'asc';
        }
        this.sortAnnouncement = `Sorted by ${column.label}, ${this.sortDir === 'desc' ? 'descending' : 'ascending'}`;
    }

    get rows() {
        const n = new Intl.NumberFormat(LOCALE);
        return this.sortedConfigs.map(c => ({
            key: c.name,
            name: c.name,
            label: c.label,
            objectLabel: c.objectLabel,
            columns: n.format(c.columns || 0),
            editLabel: `Open ${c.label}`,
            archived: c.archived === true,
            menuLabel: `Actions for ${c.label}`
        }));
    }

    /** The list's eyebrow: what the side navigation chose. */
    get listEyebrow() {
        if (this.showingArchived) return 'Archived grids';
        if (this.showingObject) {
            const o = this.objectCounts.find(x => x.value === this.listView);
            return o ? o.label : this.listView;
        }
        return 'Available grids';
    }

    /** "21 grids", or "3 of 21 grids" while the search narrows it; "2 archived grids" under Archived grids. */
    get countText() {
        const n = new Intl.NumberFormat(LOCALE);
        const total = this.listSource.length;
        const shown = this.visibleConfigs.length;
        const noun = `${this.showingArchived ? 'archived ' : ''}${total === 1 ? 'grid' : 'grids'}`;
        return shown === total ? `${n.format(total)} ${noun}` : `${n.format(shown)} of ${n.format(total)} ${noun}`;
    }

    get newDisabled() {
        return !this.canSave;
    }

    get newTitle() {
        return this.canSave ? 'Build a new grid' : 'Saving a grid needs the Customize Application permission';
    }

    handleOpen(event) {
        this.editing = event.currentTarget.dataset.name;
    }

    handleNew() {
        if (this.newDisabled) return;
        this.editing = '';
    }

    // ============================================================ the row menu

    /** Clone, Archive and Restore deploy, so they need what saving needs. */
    get deployDisabled() {
        return !this.canSave;
    }

    /** Every grid's API name, archived or not: a clone's must be new. */
    get allNames() {
        return this.configs.map(c => c.name);
    }

    handleRowAction(event) {
        const action = event.detail && event.detail.value;
        const name = event.currentTarget.dataset.name;
        const config = this.configs.find(c => c.name === name);
        if (!config) return;
        if (action === 'edit') {
            this.editing = name;
            return;
        }
        if (['clone', 'archive', 'restore'].includes(action) && this.deployDisabled) return;
        if (!['clone', 'archive', 'restore', 'setup'].includes(action)) return;
        // A plain object across the boundary (HR-28).
        this.dialog = {
            action,
            grid: { name: config.name, label: config.label, usedBy: [...(config.usedBy || [])] }
        };
    }

    handleDialogCancel() {
        this.dialog = null;
    }

    /** It went through: say so, bring the list up to date, and open a clone to change it. */
    handleDialogDone(event) {
        const { action, configName } = event.detail || {};
        const label = this.dialog ? this.dialog.grid.label : configName;
        this.dialog = null;
        const toast = DONE_TOASTS[action];
        if (toast) this.dispatchEvent(new ShowToastEvent({ ...toast(label, configName), variant: 'success' }));
        if (action === 'clone' && configName) this.editing = configName;
        this.load(false);
    }

    // ============================================================ the editor and Settings

    /** The editor is done: back to the list, or to the page the header asked for. */
    handleEditorClose() {
        this.editing = null;
        this.view = this._runtime.pendingView || 'grids';
        this._runtime.pendingView = null;
        this.load(false);
    }

    /** Saved: a new grid is now that grid, and the list learns about it. */
    handleSaved(event) {
        this.editing = event.detail.configName;
        this.load(false);
    }

    /** The retention was saved on the Settings page: the Grids page's card follows. */
    handleRetentionSaved() {
        this.loadRetention(this._runtime.token);
    }
}
