/**
 * gridSettings — the dialog a grid's gear opens: this grid's settings
 * in c/gridConfigEditor, under the Rowhouse mark.
 *
 * Only users with the Rowhouse Grid Admin permission set see the gear; the
 * server checks the permission again on every call, and saving also needs
 * Customize Application. The SLDS modal blueprint, as the other dialogs:
 * focus stays in the dialog (a guard at each end sends it round), and
 * Escape and the close button ask the editor to close, which asks first when
 * there are unsaved changes.
 *
 * INPUTS (plain values, HR-28)
 *   configName  the grid's configuration
 *   gridTitle   the grid's title, for the heading
 * EVENTS OUT
 *   saved  { configName }: the grid reads its configuration again
 *   close
 */
import { LightningElement, api } from 'lwc';
import MARK from '@salesforce/resourceUrl/RowhouseMark';

export default class GridSettings extends LightningElement {
    @api configName = '';
    @api gridTitle = '';

    // Non-reactive (HR-20).
    _layout = { focused: false };

    get markUrl() {
        return MARK;
    }

    get heading() {
        return this.gridTitle ? `Grid settings: ${this.gridTitle}` : 'Grid settings';
    }

    renderedCallback() {
        if (this._layout.focused) return;
        const close = this.template.querySelector('.rh-settings-close');
        if (close) {
            this._layout.focused = true;
            close.focus();
        }
    }

    get editor() {
        return this.template.querySelector('c-grid-config-editor');
    }

    handleCloseRequest() {
        const editor = this.editor;
        if (editor) editor.requestClose();
        else this.dispatchEvent(new CustomEvent('close'));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.handleCloseRequest();
        }
    }

    handleEditorClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleSaved(event) {
        this.dispatchEvent(new CustomEvent('saved', { detail: { configName: event.detail.configName } }));
    }

    /** Focus comes round: from the end guard to the close button, from the start guard to the last button. */
    handleGuardStart() {
        const buttons = this.template.querySelectorAll('lightning-button, lightning-button-icon');
        const last = buttons[buttons.length - 1];
        if (last) last.focus();
    }

    handleGuardEnd() {
        const close = this.template.querySelector('.rh-settings-close');
        if (close) close.focus();
    }
}
