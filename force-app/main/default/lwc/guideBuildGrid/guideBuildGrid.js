/**
 * guideBuildGrid — a tutorial's "Build" button in the Grid Guide: builds the
 * tutorial's grids in this org in one click, so a grid admin can skip its
 * build steps and go straight to using the grid.
 *
 * WHO
 * Only someone who could save the grids on the Grid Admin tab (the Rowhouse
 * Grid Admin permission set and Customize Application) sees the button;
 * anyone else reads who can. The server checks again on every save.
 *
 * WHAT IT DOES
 * The button opens a dialog that names each grid the tutorial builds and
 * what it holds, and which of them the org already has (a grid of the same
 * name is used as it is, never changed; one of the same name on another
 * object stops the build). Build saves each missing grid in turn, as the
 * Grid Admin tab's Save does (GridAdminController.saveDraft, then
 * saveStatus until the deploy has succeeded or failed), a child table's grid
 * before the grid that shows it. If one fails, the ones before it stay built
 * and the dialog says which.
 *
 * The drafts are c/guideTutorialGrids'. The dialog is the SLDS modal, as
 * the Grid Admin tab's row dialog: focus starts on Cancel, stays inside,
 * Escape cancels except while building, and returns to the button.
 *
 * INPUT (plain value, HR-28)
 *   tutorial   the tutorial page's id, such as "tutorial-leads"
 */
import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import canSave from '@salesforce/apex/GridAdminController.canSave';
import listConfigs from '@salesforce/apex/GridAdminController.listConfigs';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import { contents, gridsFor } from 'c/guideTutorialGrids';

/** Between deploy-status checks: a deploy takes a few seconds. */
export const POLL_DELAYS_MS = [1000, 1500, 2000, 3000];
/** After this, it stops waiting for one grid and says it may still go through. */
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

/** "A", "A and B", "A, B and C". */
export function listed(items) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Each grid with what the org already has: { name, label, objectApiName,
 * contents, exists, archived, clash }, in the order to build them. `org` is
 * listConfigs' answer.
 */
export function planFor(drafts, org) {
    const byName = new Map((org || []).map(g => [String(g.name).toLowerCase(), g]));
    return drafts.map(d => {
        const found = byName.get(d.config.name.toLowerCase());
        const sameObject =
            found && String(found.objectApiName || '').toLowerCase() === d.config.objectApiName.toLowerCase();
        return {
            name: d.config.name,
            label: d.config.label,
            objectApiName: d.config.objectApiName,
            contents: contents(d),
            exists: Boolean(found) && sameObject,
            archived: Boolean(found && found.archived),
            clash: Boolean(found) && !sameObject,
            clashObject: found && !sameObject ? found.objectLabel || found.objectApiName : ''
        };
    });
}

export default class GuideBuildGrid extends LightningElement {
    @api tutorial;

    /** 'loading' until canSave answers, then 'ready' or 'cannot'. */
    access = 'loading';
    dialogOpen = false;
    checking = false;
    working = false;
    progress = '';
    error = '';
    plan = [];
    builtLabels = [];

    // Non-reactive (HR-20).
    _runtime = { token: 0 };
    _layout = { focusDialog: false, focusButton: false };

    connectedCallback() {
        this.loadAccess();
    }

    disconnectedCallback() {
        this._runtime.token++;
    }

    renderedCallback() {
        if (this._layout.focusDialog) {
            const cancel = this.template.querySelector('.rh-build-cancel');
            if (cancel) {
                this._layout.focusDialog = false;
                cancel.focus();
            }
        } else if (this._layout.focusButton) {
            const button = this.template.querySelector('.rh-build-open');
            if (button) {
                this._layout.focusButton = false;
                button.focus();
            }
        }
    }

    loadAccess() {
        return canSave()
            .then(ok => {
                this.access = ok === true ? 'ready' : 'cannot';
            })
            .catch(() => {
                this.access = 'cannot'; // not a grid admin: the class is not theirs to call
            });
    }

    // ============================================================ what it shows

    get drafts() {
        return gridsFor(this.tutorial);
    }

    get hasGrids() {
        return this.drafts.length > 0;
    }

    get canBuild() {
        return this.access === 'ready' && this.hasGrids;
    }

    get cannotBuild() {
        return this.access === 'cannot' && this.hasGrids;
    }

    get labels() {
        return this.drafts.map(d => d.config.label);
    }

    get buttonLabel() {
        const labels = this.labels;
        return labels.length === 1 ? `Build ${labels[0]}` : `Build the ${labels.length} grids`;
    }

    get cannotText() {
        const what = this.labels.length === 1 ? 'this grid' : 'these grids';
        return `To build ${what} here in one click, you need the Rowhouse Grid Admin permission set and Customize Application.`;
    }

    get builtText() {
        return this.builtLabels.length ? `Built: ${listed(this.builtLabels)}.` : '';
    }

    get heading() {
        const labels = this.labels;
        if (labels.length === 1) return this.allThere ? `${labels[0]} is already in this org` : `Build ${labels[0]}?`;
        return this.allThere
            ? `The ${labels.length} grids are already in this org`
            : `Build the ${labels.length} grids for this tutorial?`;
    }

    get items() {
        return this.plan.map(p => ({
            key: p.name,
            title: `${p.label} (${p.name})`,
            text: p.clash
                ? `A grid with this API name already shows ${p.clashObject}, so it cannot be built here.`
                : p.exists
                  ? `Already in this org${p.archived ? ', archived' : ''}${this.allThere ? '.' : ': used as it is, not changed.'}`
                  : `${p.objectApiName}: ${p.contents}.`,
            className: p.clash ? 'rh-build-item rh-build-item_clash' : 'rh-build-item'
        }));
    }

    get toBuild() {
        return this.plan.filter(p => !p.exists && !p.clash);
    }

    get hasClash() {
        return this.plan.some(p => p.clash);
    }

    get allThere() {
        return this.plan.length > 0 && !this.hasClash && this.toBuild.length === 0;
    }

    get ledeText() {
        if (this.allThere) {
            return 'This org already has every grid this tutorial builds. Open the Grid Admin tab to see or change them.';
        }
        return 'Rowhouse saves these grids in this org, as the build steps would, one after the other:';
    }

    get afterText() {
        if (this.hasClash) {
            return 'Build this tutorial on the Grid Admin tab instead, giving its grids other API names.';
        }
        if (this.allThere) return '';
        return 'Nothing else in the org changes: putting a grid on a page is still yours to do. You can change or archive the grids on the Grid Admin tab afterwards.';
    }

    get showBuild() {
        return !this.checking && !this.allThere && !this.hasClash && this.toBuild.length > 0;
    }

    get buildDisabled() {
        return this.working || this.checking;
    }

    get cancelLabel() {
        return this.allThere || this.hasClash ? 'Close' : 'Cancel';
    }

    // ============================================================ open and close

    async handleOpen() {
        const token = ++this._runtime.token;
        this.dialogOpen = true;
        this.checking = true;
        this.error = '';
        this.progress = '';
        this.plan = [];
        this._layout.focusDialog = true;
        try {
            const org = await listConfigs();
            if (token !== this._runtime.token) return;
            this.plan = planFor(this.drafts, org);
        } catch (e) {
            if (token === this._runtime.token) this.error = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.checking = false;
        }
    }

    handleCancel() {
        if (this.working) return;
        this._runtime.token++;
        this.dialogOpen = false;
        this._layout.focusButton = true;
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
        const first = this.template.querySelector('.rh-build-close');
        if (first && !first.disabled) first.focus();
    }

    // ============================================================ building

    async handleBuild() {
        if (this.buildDisabled || !this.showBuild) return;
        const token = ++this._runtime.token;
        const steps = this.toBuild;
        const drafts = new Map(this.drafts.map(d => [d.config.name, d]));
        const built = [];
        this.working = true;
        this.error = '';
        try {
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                this.progress = `Building ${step.label}${steps.length > 1 ? ` (${i + 1} of ${steps.length})` : ''}. This takes a few seconds.`;
                // eslint-disable-next-line no-await-in-loop
                const jobId = await saveDraft({ draftJson: JSON.stringify(drafts.get(step.name)) });
                if (token !== this._runtime.token) return;
                // eslint-disable-next-line no-await-in-loop
                const outcome = await this.waitForDeploy(jobId, token);
                if (!outcome) return;
                if (outcome.status !== 'Succeeded') {
                    this.error = this.failedText(step, built, outcome);
                    return;
                }
                built.push(step.label);
            }
            this.builtLabels = built;
            this.dialogOpen = false;
            this._layout.focusButton = true;
            this.dispatchEvent(
                new ShowToastEvent({
                    title: built.length === 1 ? `${built[0]} is built` : 'The grids are built',
                    message: `${listed(built)} ${built.length === 1 ? 'is' : 'are'} in this org now, on the Grid Admin tab.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            if (token === this._runtime.token) {
                const step = steps[built.length];
                this.error = this.failedText(step, built, { status: 'Failed', messages: [messageOf(e)] });
            }
        } finally {
            if (token === this._runtime.token) {
                this.working = false;
                this.progress = '';
            }
        }
    }

    failedText(step, built, outcome) {
        const done = built.length
            ? ` ${listed(built)} ${built.length === 1 ? 'was built and stays' : 'were built and stay'}.`
            : '';
        if (outcome.status === 'timeout') {
            return `${step.label} is taking longer than usual. It may still go through: close this and look on the Grid Admin tab in a minute.${done}`;
        }
        let why = (outcome.messages || []).join(' ').replace(/\s+/g, ' ').trim();
        if (why && !/[.!?]$/.test(why)) why += '.';
        return `${step.label} was not built.${why ? ' ' + why : ''}${done}`;
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
}
