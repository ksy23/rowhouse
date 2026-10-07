/**
 * gridChildren — the panel under an open row: one tab per child table,
 * each a c/gridView of its own, limited to this row's records.
 *
 * lightning-tabset builds only the open tab's content, so a child grid loads
 * its rows only when its tab is shown (measured in Lightning Experience, under
 * Lightning Web Security and under Locker).
 *
 * gridView renders gridTable, which renders this, which renders gridView: a
 * cycle across bundles, which the platform supports (same measurement).
 * Nesting stops at three levels because the third level's table is handed no
 * tabs (gridView MAX_LEVELS), not because the cycle would not end otherwise.
 *
 * AFTER THE UX REVIEW
 * - Each tab's label carries its count, "Contacts (3)", as a related list's
 *   title does: from the server's counts (`counts`) until the tab's grid has
 *   loaded, then from the grid itself, which also reports later changes (an
 *   import, a delete). A change is passed up as `childcount`.
 * - It opens on the first tab with records (activeTab).
 * - The panel is sized to what it holds: this component measures its own
 *   height (ResizeObserver on its own root, HR-24) and reports it as
 *   `panelsize`; the parent table sets the panel's height from it.
 *
 * INPUTS (plain values, HR-28)
 *   tabs       [{ name, label, configName, height }] from the grid's configuration
 *   counts     { [tab name]: n } from the server, or null
 *   parentId   the open row's record Id
 *   parentName the open row's name, for labels
 *   level      the child tables' level: 2 or 3
 *
 * EVENTS OUT (plain details, HR-28)
 *   panelsize  { height }   px, this panel's content
 *   childcount { tab, count } a child grid's row count changed
 */
import { LightningElement, api } from 'lwc';

export default class GridChildren extends LightningElement {
    @api tabs = [];
    @api counts = null;
    @api parentId;
    @api parentName = '';
    @api level = 2;

    /** Counts the tabs' own grids reported: { [tab name]: n }. */
    liveCounts = {};

    _memo = {};
    /** The open tab's key, and the one the panel opened on. Not reactive: focus() and activeTab read them. */
    _state = { active: null, initial: null };
    /** Non-reactive (HR-20): the observer, whether it was set up, the last height reported. */
    _layout = { observer: null, started: false, reported: 0 };

    /**
     * One model per tab. Memoised on its inputs, so each child grid is handed
     * the same parent object until something changes (HR-17): a new one would
     * make it load its rows again.
     */
    get tabModels() {
        const tabs = Array.isArray(this.tabs) ? this.tabs : [];
        const m = this._memo;
        if (
            m.tabs === tabs &&
            m.parentId === this.parentId &&
            m.parentName === this.parentName &&
            m.level === this.level
        ) {
            return m.value;
        }
        m.tabs = tabs;
        m.parentId = this.parentId;
        m.parentName = this.parentName;
        m.level = this.level;
        m.value = tabs.map(t => ({
            key: t.name,
            label: t.label,
            configName: t.configName,
            // The tab's Height goes with it: the child grid is that tall.
            parent: {
                link: t.name,
                id: this.parentId,
                name: this.parentName,
                level: this.level,
                height: t.height || null
            }
        }));
        return m.value;
    }

    /**
     * The tab the panel opens on: the first with records, so a row
     * whose toggle says 2 does not open on an empty tab (otherwise an
     * account opened on "Test Records (0)" beside "Contacts (2)"). Decided once, when the server's counts are
     * known, and kept: a tab emptied later (a delete) must not jump the
     * panel to another tab. Until the counts are known, the first tab.
     */
    get activeTab() {
        const tabs = this.tabModels;
        if (!tabs.length) return undefined;
        if (this._state.initial) return this._state.initial;
        const counts = this.counts;
        if (!counts) return tabs[0].key;
        const withRecords = tabs.find(t => Number(counts[t.key]) > 0);
        this._state.initial = (withRecords || tabs[0]).key;
        return this._state.initial;
    }

    /** The tabs with their labels: "Contacts (3)" once the count is known. */
    get tabItems() {
        const counts = this.counts || {};
        return this.tabModels.map(t => {
            const n = Object.prototype.hasOwnProperty.call(this.liveCounts, t.key)
                ? this.liveCounts[t.key]
                : counts[t.key];
            return { ...t, tabLabel: n === undefined || n === null ? t.label : `${t.label} (${n})` };
        });
    }

    get panelLabel() {
        return this.parentName ? `Related records for ${this.parentName}` : 'Related records';
    }

    handleActive(event) {
        this._state.active = event.target.value;
    }

    /** A tab's grid loaded, imported or deleted: its label, and the parent row's count, follow. */
    handleCountChange(event) {
        event.stopPropagation();
        const tab = event.currentTarget.dataset.tab;
        const count = Number(event.detail && event.detail.count);
        if (!tab || !Number.isFinite(count) || this.liveCounts[tab] === count) return;
        this.liveCounts = { ...this.liveCounts, [tab]: count };
        this.dispatchEvent(new CustomEvent('childcount', { detail: { tab, count } }));
    }

    renderedCallback() {
        if (this._layout.started) return;
        const root = this.template.querySelector('.rh-children');
        if (!root) return;
        this._layout.started = true;
        // Without ResizeObserver (Locker in an old browser, HR-23) nothing is
        // measured and the panel keeps its level's full height.
        if (typeof ResizeObserver !== 'function') return;
        this._layout.observer = new ResizeObserver(() => {
            const height = Math.ceil(root.getBoundingClientRect().height);
            if (!height || Math.abs(height - this._layout.reported) <= 1) return;
            this._layout.reported = height;
            this.dispatchEvent(new CustomEvent('panelsize', { detail: { height } }));
        });
        this._layout.observer.observe(root);
    }

    disconnectedCallback() {
        if (this._layout.observer) this._layout.observer.disconnect();
        this._layout.observer = null;
        this._layout.started = false;
        this._layout.reported = 0;
    }

    /**
     * Focus goes into the open tab's grid: Enter on the row's panel, in the
     * parent table. A tab opened before keeps its grid, so the first grid is not
     * necessarily the open one; before any tab has said it is open, the one the
     * panel opened on is.
     */
    @api
    focus() {
        const active = this._state.active || this._state.initial;
        const view =
            (active && this.template.querySelector(`c-grid-view[data-tab="${String(active).replace(/"/g, '\\"')}"]`)) ||
            this.template.querySelector('c-grid-view');
        if (view && typeof view.focus === 'function') view.focus();
    }
}
