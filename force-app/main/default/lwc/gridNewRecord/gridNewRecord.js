/**
 * gridNewRecord — Salesforce's own New form, over the grid.
 *
 * Two doors lead here:
 *   - a lookup's list ends with "New Account" (c/cellLookup) for each target
 *     object the user may create; the record made goes in the cell as an
 *     unsaved change, which Save keeps and Undo takes back (the record itself
 *     stays, as one made from a Salesforce lookup does);
 *   - the grid's New button, when a new record cannot be a row of the grid
 *     (a choice of record type, a required field that is not a column); the
 *     record made is added at the top of the grid.
 *
 * It is the form Salesforce shows for New, built from Salesforce's own
 * description of it (lightning/uiRecordApi getRecordCreateDefaults): the
 * object's page layout for new records, section by section, its defaults,
 * and its required fields, with lightning-input-field for every field, so
 * lookups, picklists by record type, compound names and addresses behave as
 * on the object's own New page. Validation rules and duplicate rules run when
 * it saves (lightning-record-edit-form). As on Salesforce's New:
 *   - with more than one record type available to the user, the first step
 *     asks which, the user's default chosen (lightning/uiObjectInfoApi);
 *   - fields the grid fills in itself (`presets`: the parent of a child
 *     table, the record of a record page) start filled in.
 * If Salesforce cannot describe the form (an object its UI API does not
 * support), lightning-record-form shows the object's full layout instead.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus stays inside (a
 * guard at each end sends it round) and Escape cancels.
 *
 * INPUTS (plain values, HR-28)
 *   objectApiName  the object to create a record of
 *   objectLabel    its label, for the heading
 *   fieldLabel     the grid column the record is for (a lookup's New); empty
 *                  for the grid's New button
 *   presets        { field: value } the form starts with; may be null
 * EVENTS OUT
 *   created { id }, cancel
 */
import { LightningElement, api, wire } from 'lwc';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { getRecordCreateDefaults } from 'lightning/uiRecordApi';

/** The record types this user may create, the master one aside: [{ value, label }], by name. */
export function availableRecordTypes(objectInfo) {
    const infos = (objectInfo && objectInfo.recordTypeInfos) || {};
    return Object.keys(infos)
        .map(id => infos[id])
        .filter(rt => rt && rt.available && !rt.master)
        .map(rt => ({ value: rt.recordTypeId, label: rt.name, isDefault: Boolean(rt.defaultRecordTypeMapping) }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The form's sections from getRecordCreateDefaults' layout: only sections
 * with a field a new record can be given; each row's items in order, so the
 * columns line up as on Salesforce's form. An item holds its fields, [{ name,
 * required, value }]: one, or several for an address (street, city, state,
 * postal code, country); a gap, or a field a new record is not given (the
 * owner, shown on Salesforce's form as the user), holds none.
 *
 * @param {object} defaults  the adapter's data: { layout, record }
 * @param {object} presets   { field: value } that win over the defaults
 */
export function formSections(defaults, presets) {
    const layout = defaults && defaults.layout;
    const fields = (defaults && defaults.record && defaults.record.fields) || {};
    const preset = presets || {};
    const sections = [];
    ((layout && layout.sections) || []).forEach((section, s) => {
        const columns = Number(section.columns) === 1 ? 1 : 2;
        const items = [];
        let editable = 0;
        (section.layoutRows || []).forEach((row, r) => {
            (row.layoutItems || []).forEach((item, i) => {
                const key = `${s}-${r}-${i}`;
                const names = item.editableForNew
                    ? (item.layoutComponents || [])
                          .filter(c => c.componentType === 'Field' && c.apiName)
                          .map(c => c.apiName)
                    : [];
                const inputs = names.map(name => {
                    let value = null;
                    if (Object.prototype.hasOwnProperty.call(preset, name)) value = preset[name];
                    else if (fields[name] && fields[name].value !== undefined) value = fields[name].value;
                    // The layout's Required marks the item: the field, or an address's first line.
                    return { key: `${key}-${name}`, name, value, required: false };
                });
                if (inputs.length) {
                    inputs[0].required = Boolean(item.required);
                    editable++;
                }
                items.push({ key, fields: inputs, cls: cellClass(columns) });
            });
        });
        if (!editable) return;
        sections.push({
            key: section.id || 's' + s,
            heading: section.useHeading && section.heading ? section.heading : '',
            items
        });
    });
    return sections;
}

function cellClass(columns) {
    return columns === 1
        ? 'slds-col slds-size_1-of-1 rh-new-record-cell'
        : 'slds-col slds-size_1-of-1 slds-medium-size_1-of-2 rh-new-record-cell';
}

export default class GridNewRecord extends LightningElement {
    @api objectApiName;
    @api objectLabel = '';
    @api fieldLabel = '';
    @api presets = null;

    // ---- reactive state ----
    /** The record types to choose from; empty when there is no choice to make. */
    recordTypes = [];
    /** The record type chosen, or the one the form is for. */
    recordTypeId;
    /** The user is choosing the record type (the first step). */
    choosingType = false;
    /** Set once the record type is known: the form is read for it (wire parameters). */
    formObjectApiName;
    formRecordTypeId;
    sections = [];
    /** Salesforce could not describe the form: its full layout is shown instead. */
    fallback = false;
    saving = false;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    @wire(getObjectInfo, { objectApiName: '$objectApiName' })
    wiredObjectInfo({ data, error }) {
        if (error) {
            this.fallback = true;
            return;
        }
        if (!data) return;
        const types = availableRecordTypes(data);
        if (types.length > 1) {
            const chosen = types.find(t => t.isDefault) || types[0];
            this.recordTypes = types;
            this.recordTypeId = chosen.value;
            this.choosingType = true;
            return;
        }
        this.openForm(types.length === 1 ? types[0].value : data.defaultRecordTypeId);
    }

    @wire(getRecordCreateDefaults, {
        objectApiName: '$formObjectApiName',
        recordTypeId: '$formRecordTypeId',
        formFactor: 'Large'
    })
    wiredDefaults({ data, error }) {
        if (error) {
            this.fallback = true;
            return;
        }
        if (!data) return;
        const sections = formSections(data, this.presets);
        if (!sections.length) {
            this.fallback = true;
            return;
        }
        this.sections = sections;
    }

    openForm(recordTypeId) {
        this.choosingType = false;
        this.recordTypeId = recordTypeId || undefined;
        this.formRecordTypeId = recordTypeId || undefined;
        this.formObjectApiName = this.objectApiName;
    }

    renderedCallback() {
        if (this._layout.focused) return;
        const close = this.template.querySelector('.rh-new-record-close');
        if (close && typeof close.focus === 'function') {
            this._layout.focused = true;
            close.focus();
        }
    }

    get heading() {
        return `New ${this.objectLabel || 'record'}`;
    }

    get whereText() {
        return this.fieldLabel
            ? `When it is saved, it goes in ${this.fieldLabel} as an unsaved change.`
            : 'When it is saved, it is added to the grid.';
    }

    get typeOptions() {
        return this.recordTypes.map(t => ({ value: t.value, label: t.label }));
    }

    get loadingForm() {
        return !this.choosingType && !this.fallback && !this.sections.length;
    }

    get showForm() {
        return !this.choosingType && !this.fallback && this.sections.length > 0;
    }

    get showFallback() {
        return !this.choosingType && this.fallback;
    }

    get saveDisabled() {
        return this.saving || !this.showForm;
    }

    handleTypeChange(event) {
        this.recordTypeId = event.detail.value;
    }

    handleNext() {
        this.openForm(this.recordTypeId);
    }

    /** Save: check the fields first, as Salesforce's form does, then submit. */
    handleSave() {
        if (this.saveDisabled) return;
        const inputs = [...this.template.querySelectorAll('lightning-input-field')];
        const valid = inputs.reduce((ok, input) => {
            const fine = typeof input.reportValidity === 'function' ? input.reportValidity() : true;
            return ok && fine;
        }, true);
        if (!valid) return;
        const form = this.template.querySelector('.rh-new-record-form');
        if (form && typeof form.submit === 'function') {
            this.saving = true;
            form.submit();
        }
    }

    handleSuccess(event) {
        this.saving = false;
        const id = event.detail && event.detail.id;
        if (id) this.dispatchEvent(new CustomEvent('created', { detail: { id } }));
    }

    /** The form shows Salesforce's message (lightning-messages); the user corrects and saves again. */
    handleError() {
        this.saving = false;
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

    /** Shift+Tab from the first control: round to the last, the footer's main button (or the full form's). */
    handleGuardStart() {
        const last =
            this.template.querySelector('.rh-new-record-primary') ||
            this.template.querySelector('.rh-new-record-fallback');
        if (last && typeof last.focus === 'function') last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-new-record-close');
        if (close && typeof close.focus === 'function') close.focus();
    }
}
