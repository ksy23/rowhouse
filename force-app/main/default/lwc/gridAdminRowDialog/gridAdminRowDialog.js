/**
 * gridAdminRowDialog — what a grid's row menu on the Grid Admin tab does
 * besides Edit: clone the grid, archive it, restore it, or list what
 * to delete in Setup to delete it for good.
 *
 * CLONE, ARCHIVE, RESTORE
 * Each is a deploy, like a save: the dialog sends it, then asks
 * saveStatus until it has succeeded or failed, and says what happened. A
 * clone is given a title and an API name here, before it exists: its records
 * are named after the API name when they are deployed.
 *
 * DELETE IN SETUP
 * Deploys nothing. Apex cannot delete Custom Metadata, so the dialog lists the
 * grid's records in the order to delete them, each a link to its page in
 * Setup (a new browser tab), the grid itself last.
 *
 * The SLDS modal blueprint, as the delete dialog: focus starts on the
 * title (clone) or Cancel; a guard at each end keeps it in the dialog; Escape
 * cancels, except while a deploy is under way.
 *
 * INPUTS (plain values, HR-28)
 *   action  'clone' | 'archive' | 'restore' | 'setup'
 *   grid    { name, label, usedBy: titles of the grids that show it as a child table }
 *   names   every grid's API name, so a clone's suggested API name is free
 * EVENTS OUT
 *   done    { action, configName }: it went through (configName is the clone's)
 *   cancel
 */
import { LightningElement, api } from 'lwc';
import archiveConfig from '@salesforce/apex/GridAdminController.archiveConfig';
import cloneConfig from '@salesforce/apex/GridAdminController.cloneConfig';
import setupRecords from '@salesforce/apex/GridAdminController.setupRecords';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import { MAX_NAME, apiNameFrom, nameProblem } from 'c/gridAdminDraft';

/** Between deploy-status checks: a deploy takes a few seconds. */
export const POLL_DELAYS_MS = [1000, 1500, 2000, 3000];
/** After this, the dialog stops waiting and says it may still go through. */
export const SAVE_TIMEOUT_MS = 90000;

const delay = ms =>
    new Promise(resolve => {
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- back-off between deploy-status checks
        setTimeout(resolve, ms);
    });

/** An Apex error's message, whatever shape it arrived in. */
function messageOf(error) {
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

/** "Copy of" the title, cut to what a title holds. */
export function copyTitle(label) {
    return `Copy of ${label || ''}`.trim().slice(0, MAX_NAME).trim();
}

/** The API name made from a title, numbered when another grid has it. */
export function freeName(title, names) {
    const taken = new Set((Array.isArray(names) ? names : []).map(n => String(n).toLowerCase()));
    const base = apiNameFrom(title);
    if (!base || !taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
        const suffix = `_${n}`;
        const candidate = base.slice(0, MAX_NAME - suffix.length).replace(/_+$/, '') + suffix;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

/** "A", "A and B", "A, B and C". */
function listed(items) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const HEADINGS = {
    clone: label => `Clone ${label}`,
    archive: label => `Archive ${label}?`,
    restore: label => `Restore ${label}?`,
    setup: label => `Delete ${label} in Setup`
};
const CONFIRM = { clone: 'Clone', archive: 'Archive', restore: 'Restore' };
const WORKING = {
    clone: 'Cloning. This takes a few seconds.',
    archive: 'Archiving. This takes a few seconds.',
    restore: 'Restoring. This takes a few seconds.'
};

export default class GridAdminRowDialog extends LightningElement {
    @api action = 'clone';
    @api grid;
    @api names = [];

    title = '';
    apiName = '';
    working = false;
    error = '';
    records = null;
    loadingRecords = false;

    // Non-reactive (HR-20).
    _runtime = { token: 0, nameEdited: false };
    _layout = { focused: false };

    connectedCallback() {
        if (this.isClone) {
            this.title = copyTitle(this.gridLabel);
            this.apiName = freeName(this.title, this.names);
        }
        if (this.isSetup) this.loadRecords();
    }

    disconnectedCallback() {
        this._runtime.token++;
    }

    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector(this.isClone ? '.rh-row-dialog-title' : '.rh-row-dialog-cancel');
        if (first) {
            this._layout.focused = true;
            first.focus();
        }
    }

    // ============================================================ what it shows

    get isClone() {
        return this.action === 'clone';
    }

    get isArchive() {
        return this.action === 'archive';
    }

    get isSetup() {
        return this.action === 'setup';
    }

    get gridLabel() {
        return (this.grid && this.grid.label) || (this.grid && this.grid.name) || 'this grid';
    }

    get heading() {
        return (HEADINGS[this.action] || HEADINGS.clone)(this.gridLabel);
    }

    get maxName() {
        return MAX_NAME;
    }

    get cloneText() {
        return `A new grid of the same object, with copies of its columns, display rules, filters, actions and child tables. ${this.gridLabel} stays as it is.`;
    }

    get nameError() {
        return nameProblem(this.apiName);
    }

    get confirmText() {
        const label = this.gridLabel;
        return this.isArchive
            ? `${label} leaves Available grids and goes to Archived grids, where you can restore it. Pages that show it say it is archived, and nobody can work in it there.`
            : `${label} goes back under Available grids, and pages that show it work again.`;
    }

    /** Archive only: the grids whose child table tab goes while it is archived. */
    get usedByText() {
        const usedBy = (this.grid && Array.isArray(this.grid.usedBy) ? this.grid.usedBy : []).filter(Boolean);
        if (!this.isArchive || !usedBy.length) return '';
        return `${listed(usedBy)} ${usedBy.length === 1 ? 'shows' : 'show'} it as a child table: that tab is hidden while it is archived.`;
    }

    get setupText() {
        return `Rowhouse cannot delete a grid: only Setup can delete Custom Metadata records. To delete ${this.gridLabel} for good, open each record below and click Delete on its page in Setup, from the top down, so the grid itself goes last.`;
    }

    get afterSetupText() {
        return 'Once they are deleted, they cannot be restored here.';
    }

    get confirmLabel() {
        return CONFIRM[this.action] || 'OK';
    }

    get confirmDisabled() {
        if (this.working) return true;
        if (this.isClone) return !this.title.trim() || Boolean(this.nameError);
        return false;
    }

    get workingText() {
        return WORKING[this.action] || '';
    }

    // ============================================================ the clone's names

    handleTitle(event) {
        this.title = event.detail.value || '';
        // The API name follows the title until it is typed by hand, as on a new grid.
        if (!this._runtime.nameEdited) this.apiName = freeName(this.title, this.names);
        this.error = '';
    }

    handleName(event) {
        this._runtime.nameEdited = true;
        this.apiName = (event.detail.value || '').trim();
        this.error = '';
    }

    // ============================================================ Delete in Setup

    async loadRecords() {
        const token = ++this._runtime.token;
        this.loadingRecords = true;
        try {
            const items = await setupRecords({ configName: this.grid.name });
            if (token !== this._runtime.token) return;
            this.records = (items || []).map((r, i) => ({
                key: `${i}-${r.name}`,
                kind: r.kind,
                label: r.label,
                name: r.name,
                url: r.url,
                note: r.note || '',
                linkLabel: `${r.kind}: ${r.label}, in Setup (opens in a new browser tab)`
            }));
        } catch (e) {
            if (token === this._runtime.token) this.error = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.loadingRecords = false;
        }
    }

    // ============================================================ clone, archive, restore

    async handleConfirm() {
        if (this.confirmDisabled) return;
        const token = ++this._runtime.token;
        this.working = true;
        this.error = '';
        try {
            const name = this.grid.name;
            let configName = name;
            let jobId;
            if (this.isClone) {
                configName = this.apiName.trim();
                jobId = await cloneConfig({ sourceName: name, label: this.title.trim(), name: configName });
            } else {
                jobId = await archiveConfig({ configName: name, archived: this.isArchive });
            }
            if (token !== this._runtime.token) return;
            const outcome = await this.waitForDeploy(jobId, token);
            if (!outcome) return;
            if (outcome.status === 'Succeeded') {
                this.dispatchEvent(new CustomEvent('done', { detail: { action: this.action, configName } }));
                return;
            }
            this.error =
                outcome.status === 'timeout'
                    ? 'This is taking longer than usual. Close the dialog, and reload the page in a minute to see whether it went through.'
                    : `It did not go through. ${outcome.messages.join(' ')}`.trim();
        } catch (e) {
            if (token === this._runtime.token) this.error = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.working = false;
        }
    }

    /** Ask until the deploy has succeeded or failed: its outcome, { status: 'timeout' }, or null if the dialog closed. */
    async waitForDeploy(jobId, token) {
        const started = Date.now();
        for (let i = 0; ; i++) {
            // eslint-disable-next-line no-await-in-loop
            await delay(POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)]);
            if (token !== this._runtime.token) return null;
            // eslint-disable-next-line no-await-in-loop
            const result = await saveStatus({ jobId });
            if (token !== this._runtime.token) return null;
            if (result && result.status && result.status !== 'pending') {
                return { status: result.status, messages: result.messages || [] };
            }
            if (Date.now() - started >= SAVE_TIMEOUT_MS) return { status: 'timeout', messages: [] };
        }
    }

    // ============================================================ closing and focus

    handleCancel() {
        if (this.working) return;
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.handleCancel();
        }
    }

    /** Shift+Tab from the first control: round to the last. */
    handleGuardStart() {
        const buttons = [...this.template.querySelectorAll('.slds-modal__footer button')];
        const last = buttons.reverse().find(b => !b.disabled);
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const first = this.template.querySelector('.rh-row-dialog-close');
        if (first && !first.disabled) first.focus();
    }
}
