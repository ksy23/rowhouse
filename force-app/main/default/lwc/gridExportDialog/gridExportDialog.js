/**
 * gridExportDialog — Export, as Salesforce exports a report: choose the
 * Export View and the Format, then Export.
 *   Formatted Report  the grid as it looks, under the report's header and
 *                     filter details; an Excel workbook (.xlsx) only
 *   Details Only      each row without formatting, for calculations or for
 *                     uploading: Excel (.xlsx) or a CSV (.csv), UTF-8
 * The grid writes the file (c/gridExcel, c/gridCsv) once every matching row
 * has loaded; while they load, the dialog shows how far it has got, and
 * Cancel stops it.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus starts on the
 * chosen view and stays inside (a guard at each end sends it round); the
 * arrow keys move between the views, as radio buttons do; Escape cancels.
 *
 * INPUTS (plain values, HR-28)
 *   total     how many records match (the grid's count)
 *   loaded    how many are loaded
 *   max       the most an export holds (the most a grid loads)
 *   busy      the grid is loading the rest, or writing the file
 *   error     what went wrong, to show
 * EVENTS OUT
 *   export { view: 'formatted' | 'details', format: 'xlsx' | 'csv' }, cancel
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';

/** The cards, left to right: Salesforce's own words. */
const VIEW_TILES = [
    {
        value: 'formatted',
        label: 'Formatted Report',
        description: 'Export the report, including the report header, groupings, and filter settings.'
    },
    {
        value: 'details',
        label: 'Details Only',
        description:
            'Export only the detail rows. Use this to do further calculations or for uploading to other systems.'
    }
];
const XLSX = { value: 'xlsx', label: 'Excel Format .xlsx' };
const CSV = { value: 'csv', label: 'Comma Delimited .csv' };
const ENCODINGS = [{ value: 'UTF-8', label: 'Unicode (UTF-8)' }];

export default class GridExportDialog extends LightningElement {
    @api total = 0;
    @api loaded = 0;
    @api max = 100000;
    @api busy = false;
    @api error = null;

    view = 'formatted';
    detailsFormat = 'xlsx';
    focusedView = null;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const chosen = this.template.querySelector('.rh-export-view-input:checked');
        if (chosen) {
            this._layout.focused = true;
            chosen.focus();
        }
    }

    get viewTiles() {
        return VIEW_TILES.map(t => {
            const checked = t.value === this.view;
            let tileClass = 'rh-export-view-tile';
            if (checked) tileClass += ' rh-export-view-tile_on';
            if (t.value === this.focusedView) tileClass += ' rh-export-view-tile_focus';
            return { ...t, checked, tileClass, descriptionId: 'rh-export-' + t.value };
        });
    }

    /** A Formatted Report is an Excel workbook; Details Only, Excel or CSV. */
    get format() {
        return this.view === 'formatted' ? XLSX.value : this.detailsFormat;
    }

    get formatOptions() {
        return this.view === 'formatted' ? [{ ...XLSX }] : [{ ...XLSX }, { ...CSV }];
    }

    get formatDisabled() {
        return this.view === 'formatted' || this.busy;
    }

    /** A CSV's encoding, as Salesforce asks for it: always UTF-8 here, which Excel reads. */
    get showEncoding() {
        return this.format === CSV.value;
    }

    get encodingOptions() {
        return ENCODINGS.map(e => ({ ...e }));
    }

    /** A number in the user's locale: 25,000. */
    count(n) {
        return new Intl.NumberFormat(LOCALE).format(Number(n) || 0);
    }

    /** What the export holds, when that is more than the rows on screen, or less than the rows that match. */
    get rowsNote() {
        const total = Number(this.total) || 0;
        const loaded = Number(this.loaded) || 0;
        if (total > this.max) {
            return `${this.count(total)} records match. An export holds the first ${this.count(this.max)}.`;
        }
        if (total > loaded) {
            return `All ${this.count(total)} records are exported. The ${this.count(total - loaded)} not yet loaded load first.`;
        }
        return null;
    }

    get progressGoal() {
        return Math.min(Number(this.total) || 0, this.max);
    }

    get progressText() {
        const goal = this.progressGoal;
        const loaded = Math.min(Number(this.loaded) || 0, goal || Infinity);
        return goal && loaded < goal
            ? `Loading rows… ${this.count(loaded)} of ${this.count(goal)}`
            : 'Writing the file…';
    }

    get progressPercent() {
        const goal = this.progressGoal;
        if (!goal) return 100;
        return Math.min(100, Math.round(((Number(this.loaded) || 0) / goal) * 100));
    }

    get progressStyle() {
        return `width: ${this.progressPercent}%`;
    }

    handleView(event) {
        this.view = event.target.value;
    }

    handleViewFocus(event) {
        this.focusedView = event.target.value;
    }

    handleViewBlur() {
        this.focusedView = null;
    }

    handleFormat(event) {
        if (this.view === 'details') this.detailsFormat = event.detail.value === CSV.value ? CSV.value : XLSX.value;
    }

    handleExport() {
        if (this.busy) return;
        this.dispatchEvent(new CustomEvent('export', { detail: { view: this.view, format: this.format } }));
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.handleCancel();
        }
    }

    /** Shift+Tab from the first control: round to the last enabled button. */
    handleGuardStart() {
        const last = this.busy
            ? this.template.querySelector('.rh-export-cancel')
            : this.template.querySelector('.rh-export-go');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-export-close');
        if (close) close.focus();
    }
}
