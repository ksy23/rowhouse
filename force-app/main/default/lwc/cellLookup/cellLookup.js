/**
 * cellLookup — edit a lookup or owner field by searching for the record.
 *
 * An SLDS lookup: a text box that searches as the user types, and a listbox of
 * matches (ARIA 1.2 combobox with aria-activedescendant, so focus stays in the
 * box while arrows move through the matches). The search runs on the server
 * (GridController.searchLookup), in user mode, against the named grid's
 * column: only records the user can see, never another object (HR-6).
 *
 * Keys: Arrow Down / Up move through the matches, Enter chooses one, Escape
 * cancels. Clearing the box and pressing Enter clears the lookup. Leaving
 * without choosing keeps the value it had.
 *
 * Commits { value: recordId, label: name } so the grid can show the name at
 * once, before the row is saved and read back.
 *
 * In the grid, Tab commits and the grid moves focus to the next cell. In a
 * form, such as the mass update dialog, `tabLeaves` lets Tab commit and
 * move focus on as a form field does, and the box then shows the name chosen.
 *
 * LOOKUP FILTERS AND NEW RECORDS
 * - A field with a lookup filter (`filtered`) is edited with Salesforce's own
 *   lookup (lightning-input-field in a lightning-record-edit-form on the row's
 *   record), which applies the filter: Apex can tell that a field has a
 *   filter but not what it says. The record's name comes from
 *   GridController.lookupName once one is chosen.
 * - With `newTargets` (objects the user may create), the list ends with a
 *   "New Account" item for each, after the matches, as Salesforce's lookups
 *   do. Choosing it fires `newrecord` { object, label, term }: the grid opens
 *   the record form and puts the new record in the cell.
 */
import { LightningElement, api } from 'lwc';
import searchLookup from '@salesforce/apex/GridController.searchLookup';
import lookupName from '@salesforce/apex/GridController.lookupName';

export const SEARCH_DELAY_MS = 250;
export const REQUIRED_MESSAGE = 'Complete this field.';
/**
 * ms the grid's commit on a focus-out waits, with Salesforce's own lookup, for
 * the lookup to say what was chosen.
 */
export const SETTLE_MS = 400;
const ICONS = { User: 'standard:user', Queue: 'standard:queue' };

let idCounter = 0;

export default class CellLookup extends LightningElement {
    @api value;
    /** The current record's name, shown in the box when editing starts. */
    @api valueLabel;
    @api mode = 'display';
    @api label = '';
    @api required = false;
    /** The grid configuration and column the search is run for. */
    @api configName;
    @api field;
    /** In a form: Tab commits and focus moves on. */
    @api tabLeaves = false;
    /** The character the user typed on the cell to start editing: the search so far. */
    @api seed;
    /** Each target object's icon, by local name: { Account: 'standard:account' }. */
    @api icons;
    /**
     * 'left' (the default) or 'right': which edge of the box the matches hang
     * from. The box is the cell's width; the matches keep a readable width and
     * open leftwards when the table says there is no room to the right.
     */
    @api dropdownAlign = 'left';
    /** true: the matches open above the box, when the table says there is no room below it. */
    @api dropdownUp = false;
    /** The field has a lookup filter: edit it with Salesforce's own lookup. */
    @api filtered = false;
    /** For Salesforce's own lookup: the field's and the object's API names, and the row's record. */
    @api fieldApiName;
    @api objectApiName;
    @api recordId;
    /** Objects a record can be created of from the list, [{ object, label }]. */
    @api newTargets;

    term;
    results = [];
    activeIndex = -1;
    status = '';
    picked;
    error = '';
    /** A search has answered, so the list (with its New items) shows. */
    searched = false;
    /** Salesforce's own lookup: the record chosen, while its name is read. */
    chosen;

    // Non-reactive (HR-20).
    _search = { timer: null, token: 0 };
    _layout = { reveal: false, seeded: false, settle: null, settled: false };
    _id = 'rh-lookup-' + ++idCounter;

    connectedCallback() {
        this.term = this.valueLabel || '';
        if (this.seed !== undefined && this.seed !== null && String(this.seed)) {
            this.term = String(this.seed);
            this.picked = undefined;
            this._layout.seeded = true;
            const term = this.term;
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- the typed letter starts a search, as typing does
            this._search.timer = setTimeout(() => this.runSearch(term), SEARCH_DELAY_MS);
        }
    }

    /** New matches below the bottom of the grid's box are scrolled into view. */
    renderedCallback() {
        if (!this._layout.reveal) return;
        this._layout.reveal = false;
        const list = this.template.querySelector('[role="listbox"]');
        if (list && typeof list.scrollIntoView === 'function') list.scrollIntoView({ block: 'nearest' });
    }

    disconnectedCallback() {
        clearTimeout(this._search.timer);
        clearTimeout(this._layout.settle);
        this._search.token++;
    }

    /**
     * Focus the box. Its name is selected, so typing replaces it; but after a
     * typed first letter (seed) the caret goes after it, so the next letter
     * follows it instead of replacing it.
     */
    @api
    focus() {
        if (this.useSalesforceLookup) {
            const field = this.template.querySelector('lightning-input-field');
            if (field && typeof field.focus === 'function') field.focus();
            return;
        }
        const input = this.template.querySelector('input');
        if (!input) return;
        input.focus();
        if (this._layout.seeded) {
            this._layout.seeded = false;
            const end = String(input.value || '').length;
            if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
        } else {
            input.select();
        }
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    /** Edited with Salesforce's own lookup, which applies the field's lookup filter. */
    get useSalesforceLookup() {
        return this.isEdit && this.filtered === true && Boolean(this.fieldApiName) && Boolean(this.objectApiName);
    }

    get useOwnLookup() {
        return this.isEdit && !this.useSalesforceLookup;
    }

    /** The row's record, for Salesforce's own lookup; none for a row not saved yet. */
    get formRecordId() {
        return this.recordId && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(this.recordId) ? this.recordId : null;
    }

    get text() {
        return this.valueLabel || this.value || '';
    }

    get isOpen() {
        return this.entries.length > 0;
    }

    /** "New Account" for each object the user may create a record of, after the matches. */
    get newItems() {
        if (!this.searched || !Array.isArray(this.newTargets)) return [];
        return this.newTargets.map(t => ({ isNew: true, object: t.object, kind: t.label, name: 'New ' + t.label, id: 'new-' + t.object }));
    }

    /** What the list offers, in order: the matches, then the New items. */
    get entries() {
        return this.results.concat(this.newItems);
    }

    get expanded() {
        return this.isOpen ? 'true' : 'false';
    }

    get comboboxClass() {
        return 'slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click' + (this.isOpen ? ' slds-is-open' : '');
    }

    get listboxClass() {
        return 'slds-dropdown slds-dropdown_length-with-icon-7 slds-dropdown_fluid rh-lookup-list '
            + (this.dropdownAlign === 'right' ? 'slds-dropdown_right' : 'slds-dropdown_left')
            + (this.dropdownUp ? ' slds-dropdown_bottom' : '');
    }

    get listboxId() {
        return this._id + '-listbox';
    }

    get options() {
        return this.entries.map((r, i) => ({
            ...r,
            key: r.id,
            index: i,
            domId: `${this._id}-option-${i}`,
            // The object's own icon, as Lightning's lookups show it; New is an add icon.
            icon: r.isNew ? 'utility:add' : (this.icons && r.object && this.icons[r.object]) || ICONS[r.kind] || 'standard:record',
            iconSize: r.isNew ? 'x-small' : 'small',
            showKind: !r.isNew,
            selected: i === this.activeIndex ? 'true' : 'false',
            cls: 'slds-media slds-listbox__option slds-listbox__option_entity'
                + (r.isNew ? ' rh-lookup-new' : ' slds-listbox__option_has-meta')
                + (i === this.activeIndex ? ' slds-has-focus' : '')
        }));
    }

    get activeDescendant() {
        return this.activeIndex >= 0 ? `${this._id}-option-${this.activeIndex}` : null;
    }

    get ariaRequired() {
        return this.required ? 'true' : null;
    }

    get ariaInvalid() {
        return this.error ? 'true' : null;
    }

    get formElementClass() {
        return 'slds-form-element rh-lookup' + (this.error ? ' slds-has-error' : '');
    }

    get placeholder() {
        return 'Search ' + (this.label || '') + '…';
    }

    handleInput(event) {
        this.term = event.target.value;
        this.picked = undefined;
        this.error = '';
        clearTimeout(this._search.timer);
        const term = this.term;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- debounce typing; cleared on disconnect
        this._search.timer = setTimeout(() => this.runSearch(term), SEARCH_DELAY_MS);
    }

    /** Only the newest search's answer is shown; an older one arriving late is dropped. */
    runSearch(term) {
        const token = ++this._search.token;
        if (!term.trim()) {
            this.results = [];
            this.searched = false;
            this.activeIndex = -1;
            this.status = '';
            return Promise.resolve();
        }
        this.status = 'Searching…';
        return searchLookup({ configName: this.configName, field: this.field, term })
            .then(found => {
                if (token !== this._search.token) return;
                this.results = Array.isArray(found) ? found : [];
                this.searched = true;
                this.activeIndex = this.entries.length ? 0 : -1;
                const n = this.results.length;
                this._layout.reveal = this.entries.length > 0;
                const more = this.newItems.length ? ' Or create a record.' : '';
                this.status = (n ? `${n} ${n === 1 ? 'match' : 'matches'}. Arrow down to choose.` : 'No matches.') + more;
            })
            .catch(error => {
                if (token !== this._search.token) return;
                this.results = [];
                this.searched = false;
                this.activeIndex = -1;
                this.status = 'Search failed: ' + ((error && error.body && error.body.message) || 'unknown error');
            });
    }

    handleKeyDown(event) {
        const n = this.entries.length;
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
                event.preventDefault();
                event.stopPropagation();
                if (n) this.activeIndex = (this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
                break;
            case 'Enter':
                event.preventDefault();
                event.stopPropagation();
                if (this.activeIndex >= 0 && n) {
                    const entry = this.entries[this.activeIndex];
                    if (entry.isNew) {
                        this.chooseNew(entry);
                        break;
                    }
                    this.picked = entry;
                }
                this.commit();
                break;
            case 'Tab':
                if (!this.tabLeaves) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                this.commit();
                break;
            case 'Escape': {
                event.preventDefault();
                event.stopPropagation();
                // A form closes its dialog on Escape only when no list was open.
                const listOpen = n > 0;
                this.reset();
                this.dispatchEvent(new CustomEvent('cancel', { detail: { listOpen } }));
                break;
            }
            default:
        }
    }

    /** Keep focus in the box while a match is clicked. */
    handleOptionMouseDown(event) {
        event.preventDefault();
    }

    handleOptionClick(event) {
        const entry = this.entries[Number(event.currentTarget.dataset.index)];
        if (entry && entry.isNew) {
            this.chooseNew(entry);
            return;
        }
        this.picked = entry;
        this.commit();
    }

    /** The New item: the grid opens the record form; this editor's work is done. */
    chooseNew(entry) {
        const term = this.term;
        this.reset();
        this.dispatchEvent(new CustomEvent('newrecord', { detail: { object: entry.object, label: entry.kind, term } }));
    }

    reset() {
        clearTimeout(this._search.timer);
        this._search.token++;
        this.results = [];
        this.searched = false;
        this.activeIndex = -1;
        this.picked = undefined;
    }

    // ------------------------------------------------------------ Salesforce's own lookup

    /** A record chosen (or the box cleared) in Salesforce's own lookup: read its name, then commit. */
    handleFormChange(event) {
        let value = event.detail ? event.detail.value : null;
        if (Array.isArray(value)) value = value[0];
        value = value || null;
        clearTimeout(this._layout.settle);
        this.chosen = { value, label: null };
        this.error = '';
        if (!value) {
            this.commit();
            return Promise.resolve();
        }
        this.status = 'Reading the name…';
        return lookupName({ configName: this.configName, field: this.field, recordId: value })
            .then(name => {
                if (!this.chosen || this.chosen.value !== value) return;
                this.chosen = { value, label: name || null };
                this.commit();
            })
            .catch(() => {
                // The name is shown once the row is saved and read back.
                if (this.chosen && this.chosen.value === value) this.commit();
            });
    }

    /** Escape cancels, Tab commits, as in the grid's other editors; the lookup keeps its own keys. */
    handleFormKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.chosen = undefined;
            this.dispatchEvent(new CustomEvent('cancel', { detail: { listOpen: false } }));
        } else if (event.key === 'Tab') {
            if (!this.tabLeaves) {
                event.preventDefault();
                event.stopPropagation();
            }
            this._layout.settled = true; // a key, not a click on the list: nothing to wait for
            this.commit();
        }
    }

    /**
     * A required field left blank is refused here, in the editor, with the
     * message a record form gives: the editor stays open. Returns
     * whether the value was committed.
     */
    @api
    commit() {
        let value = this.value === undefined ? null : this.value;
        let label = this.valueLabel || null;
        if (this.useSalesforceLookup && !this.chosen && !this._layout.settled) {
            // A click on one of Salesforce's matches moves focus out of the
            // editor before the lookup says which was chosen, and its list is
            // not inside the editor: the grid's commit on that focus-out waits
            // SETTLE_MS for the lookup's change (without it, the editor closed with
            // the old value).
            clearTimeout(this._layout.settle);
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- cleared on change and on disconnect
            this._layout.settle = setTimeout(() => {
                this._layout.settled = true;
                this.commit();
            }, SETTLE_MS);
            return true;
        }
        this._layout.settled = false;
        if (this.useSalesforceLookup) {
            if (this.chosen) {
                value = this.chosen.value;
                label = this.chosen.label;
            }
        } else if (this.picked) {
            value = this.picked.id;
            label = this.picked.name;
        } else if (!String(this.term || '').trim()) {
            value = null; // an emptied box clears the lookup
            label = null;
        }
        if (this.required && !value) {
            this.error = REQUIRED_MESSAGE;
            return false;
        }
        this.error = '';
        this.reset();
        this.chosen = undefined;
        // The box shows what was committed; in the grid the editor closes anyway.
        this.term = label || '';
        this.dispatchEvent(new CustomEvent('commit', { detail: { value, label } }));
        return true;
    }
}
