/**
 * gridAdminImportDialog — imports grids from a file exported on a Grid Admin
 * tab, this org's or another's, without ever changing a grid this org has.
 *
 * WHAT IT DOES
 * Choose a file (c/gridConfigFile reads it). The server says, for each grid
 * in it, what importing would do here (GridAdminController.planImport):
 * new, already here (left as it is), or, when the admin chooses copies,
 * imported as a copy under a new title and API name. It also checks each grid
 * as the Grid Admin tab checks a save, so the dialog shows what keeps a grid
 * out (a field or object this org lacks) and what a grid would leave out,
 * before anything is saved. Import saves the grids one after the other, as
 * the Grid Admin tab's Save does (saveDraft, then saveStatus until the deploy
 * has succeeded or failed), child grids first. If one fails, the ones before
 * it stay imported and the dialog says which.
 *
 * Nothing in a file is trusted: saveDraft checks each grid again in full and
 * needs Customize Application, as every save does.
 *
 * The SLDS modal, as the Grid Admin tab's row dialog: focus starts on the
 * file chooser, stays inside, Escape cancels except while importing.
 *
 * EVENTS OUT
 *   done    { imported, skipped }: the titles imported, and those left as they were
 *   cancel  { imported }: closed; the titles imported before a failure, if any
 */
import { LightningElement } from 'lwc';
import planImport from '@salesforce/apex/GridAdminController.planImport';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import { contents, listed, readGridFile, readText } from 'c/gridConfigFile';

/** Between deploy-status checks: a deploy takes a few seconds. */
export const POLL_DELAYS_MS = [1000, 1500, 2000, 3000];
/** After this, it stops waiting for one grid and says it may still go through. */
export const SAVE_TIMEOUT_MS = 90000;

/** What happens to a grid this org already has. */
export const KEEP = 'keep';
export const COPIES = 'copies';
const EXISTING_OPTIONS = [
    { label: 'Leave them as they are', value: KEEP },
    { label: 'Import them as copies', value: COPIES }
];

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

/** Can this grid of the plan be imported? */
export function importable(item) {
    return Boolean(item && item.draft && item.action !== 'skip' && !(item.errors || []).length);
}

/**
 * One grid of the plan as the dialog lists it: { key, title, text, problems,
 * warnings, className }. `grid` is the file's grid, for what it holds.
 */
export function describeItem(item, grid, index) {
    const errors = item.errors || [];
    const warnings = item.warnings || [];
    const title = item.name ? `${item.label} (${item.name})` : item.label;
    const what = grid ? contents(grid) : '';
    const object = item.objectLabel || item.objectApiName || '';
    let text;
    if (errors.length) {
        text = 'Cannot be imported:';
    } else if (item.action === 'skip') {
        const other =
            item.existingObjectLabel && item.existingObjectLabel !== item.objectLabel
                ? `, for ${item.existingObjectLabel}`
                : '';
        text = `This org already has a grid named ${item.name}${other}: left as it is.`;
    } else if (item.action === 'copy') {
        text = `This org already has a grid named ${item.name}, so it is imported as ${item.importLabel} (${item.importName}). ${object}: ${what}.`;
    } else {
        text = `New: ${object}, ${what}.`;
    }
    let className = 'rh-import-grids-item';
    if (errors.length) className += ' rh-import-grids-item_error';
    else if (item.action === 'skip') className += ' rh-import-grids-item_skip';
    return {
        key: `${index}-${item.name || 'grid'}`,
        title,
        text,
        problems: errors.map((e, i) => ({ key: `e${i}`, text: e })),
        hasProblems: errors.length > 0,
        warnings: warnings.map((w, i) => ({ key: `w${i}`, text: w })),
        hasWarnings: !errors.length && warnings.length > 0,
        className
    };
}

export default class GridAdminImportDialog extends LightningElement {
    /** choose: pick a file · checking: reading it and asking the server · preview: the plan. */
    step = 'choose';
    fileName = '';
    error = '';
    existing = KEEP;
    items = [];
    working = false;
    progress = '';
    dragOver = false;
    imported = [];

    // Non-reactive (HR-20).
    _runtime = { token: 0, grids: [] };
    _layout = { focused: false };

    disconnectedCallback() {
        this._runtime.token++;
    }

    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector('.rh-import-grids-file');
        if (first) {
            this._layout.focused = true;
            first.focus();
        }
    }

    // ============================================================ what it shows

    get isChoose() {
        return this.step === 'choose';
    }

    get isChecking() {
        return this.step === 'checking';
    }

    get isPreview() {
        return this.step === 'preview';
    }

    get existingOptions() {
        return EXISTING_OPTIONS;
    }

    get dropzoneClass() {
        return this.dragOver
            ? 'slds-file-selector__dropzone slds-has-drag-over rh-import-grids-drop'
            : 'slds-file-selector__dropzone rh-import-grids-drop';
    }

    get rows() {
        const byName = new Map(
            this._runtime.grids
                .filter(g => g && g.config && g.config.name)
                .map(g => [String(g.config.name).trim().toLowerCase(), g])
        );
        return this.items.map((item, i) =>
            describeItem(item, item.name ? byName.get(String(item.name).toLowerCase()) : null, i)
        );
    }

    get toImport() {
        return this.items.filter(importable);
    }

    get skipped() {
        return this.items.filter(i => i.action === 'skip' && !(i.errors || []).length);
    }

    /** The choice for grids this org has: only when the file has some. */
    get showExisting() {
        return this.items.some(i => i.action === 'skip' || i.action === 'copy');
    }

    get countText() {
        const n = this.items.length;
        return `${this.fileName}: ${n} ${n === 1 ? 'grid' : 'grids'}`;
    }

    get ledeText() {
        const n = this.toImport.length;
        if (n === 0) {
            return this.items.length && this.skipped.length === this.items.length
                ? 'This org already has every grid in this file. Nothing is imported.'
                : 'Nothing in this file can be imported here.';
        }
        const saves =
            n === 1 ? 'saves this grid in this org' : `saves these ${n} grids in this org, one after the other`;
        return `Rowhouse ${saves}. A grid this org already has is never changed.`;
    }

    get afterText() {
        return "Grids come without the pages that show them: add the Rowhouse Grid component to a page and enter the grid's API name. An action needs its flow, Apex class or quick action in this org.";
    }

    get importLabel() {
        const n = this.toImport.length;
        if (n === 0) return 'Import';
        return n === 1 ? 'Import 1 grid' : `Import ${n} grids`;
    }

    get importDisabled() {
        return this.working || !this.isPreview || this.toImport.length === 0;
    }

    get choiceDisabled() {
        return this.working;
    }

    get cancelLabel() {
        return this.imported.length ? 'Close' : 'Cancel';
    }

    // ============================================================ choose a file

    handleDragOver(event) {
        event.preventDefault();
        if (!this.dragOver) this.dragOver = true;
    }

    handleDragLeave() {
        this.dragOver = false;
    }

    handleDrop(event) {
        event.preventDefault();
        this.dragOver = false;
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length && !this.isChecking && !this.working) this.readChosen(files[0]);
    }

    handleFile(event) {
        const files = (event.target && event.target.files) || [];
        if (files[0]) this.readChosen(files[0]);
    }

    /** Choose another file: back to the start. */
    handleAnother() {
        if (this.working) return;
        this._runtime.token++;
        this.step = 'choose';
        this.items = [];
        this.error = '';
        this.fileName = '';
        this._layout.focused = false;
    }

    async readChosen(file) {
        const token = ++this._runtime.token;
        this.fileName = file.name || '';
        this.error = '';
        this.step = 'checking';
        try {
            const grids = readGridFile(await readText(file));
            if (token !== this._runtime.token) return;
            this._runtime.grids = grids;
            await this.plan(token);
        } catch (e) {
            if (token !== this._runtime.token) return;
            this.error = messageOf(e);
            this.step = 'choose';
            this._layout.focused = false;
        }
    }

    /** Ask the server what importing would do, for the current choice. */
    async plan(token) {
        const items = await planImport({
            gridsJson: JSON.stringify(this._runtime.grids),
            asCopies: this.existing === COPIES
        });
        if (token !== this._runtime.token) return;
        this.items = items || [];
        this.step = 'preview';
    }

    async handleExisting(event) {
        const value = event.detail && event.detail.value;
        if (this.working || value === this.existing || ![KEEP, COPIES].includes(value)) return;
        this.existing = value;
        const token = ++this._runtime.token;
        this.error = '';
        this.step = 'checking';
        try {
            await this.plan(token);
        } catch (e) {
            if (token !== this._runtime.token) return;
            this.error = messageOf(e);
            this.step = 'preview';
        }
    }

    // ============================================================ import

    async handleImport() {
        if (this.importDisabled) return;
        const token = ++this._runtime.token;
        const steps = this.toImport;
        const skipped = this.skipped.map(i => i.label);
        const done = [];
        this.working = true;
        this.error = '';
        try {
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                this.progress = `Importing ${step.importLabel}${steps.length > 1 ? ` (${i + 1} of ${steps.length})` : ''}. This takes a few seconds.`;
                // eslint-disable-next-line no-await-in-loop
                const jobId = await saveDraft({ draftJson: JSON.stringify(step.draft) });
                if (token !== this._runtime.token) return;
                // eslint-disable-next-line no-await-in-loop
                const outcome = await this.waitForDeploy(jobId, token);
                if (!outcome) return;
                if (outcome.status !== 'Succeeded') {
                    this.imported = [...done];
                    this.error = this.failedText(step, done, outcome);
                    return;
                }
                done.push(step.importLabel);
            }
            this.imported = [...done];
            this.dispatchEvent(new CustomEvent('done', { detail: { imported: [...done], skipped } }));
        } catch (e) {
            if (token === this._runtime.token) {
                this.imported = [...done];
                this.error = this.failedText(steps[done.length], done, { status: 'Failed', messages: [messageOf(e)] });
            }
        } finally {
            if (token === this._runtime.token) {
                this.working = false;
                this.progress = '';
            }
        }
    }

    failedText(step, done, outcome) {
        const kept = done.length
            ? ` ${listed(done)} ${done.length === 1 ? 'was imported and stays' : 'were imported and stay'}.`
            : '';
        if (outcome.status === 'timeout') {
            return `${step.importLabel} is taking longer than usual. It may still go through: close this and look on the Grid Admin tab in a minute.${kept}`;
        }
        let why = (outcome.messages || []).join(' ').replace(/\s+/g, ' ').trim();
        if (why && !/[.!?]$/.test(why)) why += '.';
        return `${step.importLabel} was not imported.${why ? ' ' + why : ''}${kept}`;
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
        this._runtime.token++;
        this.dispatchEvent(new CustomEvent('cancel', { detail: { imported: [...this.imported] } }));
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
        const first = this.template.querySelector('.rh-import-grids-close');
        if (first && !first.disabled) first.focus();
    }
}
