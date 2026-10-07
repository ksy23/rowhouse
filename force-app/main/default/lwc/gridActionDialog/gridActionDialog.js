/**
 * gridActionDialog — asks before a grid action runs on the server: the
 * admin's question (the Grid Action's Confirmation), or "Run X?", then which
 * rows, by name, and whether any has unsaved changes the action will not see.
 * The confirm button says what it does: the action's label.
 *
 * Screen flows no longer run here: lightning-flow brought Salesforce's
 * whole flow engine, 1.9 MB of the grid's 2.4 MB, into every grid's first
 * load. They run on their own page, c/rowhouseFlow.
 *
 * The SLDS modal blueprint, as the delete dialog: focus stays in the
 * dialog (a guard at each end sends it round); Escape cancels; focus starts
 * on Cancel.
 *
 * INPUTS (plain values, HR-28)
 *   label       the action's label
 *   question    the admin's question, or empty
 *   names       the rows' names, in order; the first NAMED are shown
 *   count       how many rows it runs on
 *   hasDrafts   some of them have unsaved changes
 * EVENTS OUT
 *   confirm     run it
 *   cancel      not run
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';

/** Rows named before "and N more". */
export const NAMED = 5;

export default class GridActionDialog extends LightningElement {
    @api label = '';
    @api question = '';
    @api names = [];
    @api count = 0;
    @api hasDrafts = false;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector('.rh-action-cancel');
        if (first) {
            this._layout.focused = true;
            first.focus();
        }
    }

    get heading() {
        return this.question || `${this.label}?`;
    }

    get noun() {
        const n = Number(this.count) || 0;
        return `${new Intl.NumberFormat(LOCALE).format(n)} ${n === 1 ? 'record' : 'records'}`;
    }

    get runsOnText() {
        return `It runs on ${this.noun}:`;
    }

    /** The first NAMED names, then how many more. */
    get namedList() {
        const names = (Array.isArray(this.names) ? this.names : []).map(n => (n ? String(n) : 'A record with no name'));
        const shown = names.slice(0, NAMED);
        const more = Math.max(0, (Number(this.count) || names.length) - shown.length);
        return { shown: shown.map((name, i) => ({ key: i, name })), more };
    }

    get shownNames() {
        return this.namedList.shown;
    }

    get moreText() {
        const more = this.namedList.more;
        return more ? `and ${new Intl.NumberFormat(LOCALE).format(more)} more` : '';
    }

    get draftsText() {
        const one = (Number(this.count) || 0) === 1;
        return this.hasDrafts
            ? `Unsaved changes on ${one ? 'this row are' : 'these rows are'} not part of it: it works on the saved ${one ? 'record' : 'records'}. Save first to include them.`
            : '';
    }

    get confirmLabel() {
        return this.label || 'Run';
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleConfirm() {
        this.dispatchEvent(new CustomEvent('confirm'));
    }

    /** Shift+Tab from the first control: round to the last. */
    handleGuardStart() {
        const controls = this.template.querySelectorAll('[data-control]');
        const last = controls[controls.length - 1];
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const first = this.template.querySelector('.rh-action-close');
        if (first) first.focus();
    }
}
