/**
 * gridAdminViews — the Grid Admin tab's Views tab: the views people saved
 * of a grid, private ones too (Rowhouse Grid Admin reads them all), each with
 * its owner, who sees it and when it last changed, and Delete, which asks
 * first. Only a view's owner can change it; an admin can remove one, after
 * someone leaves, say. What a view keeps is not shown here.
 *
 * INPUTS (plain values, HR-28)
 *   views    [{ id, name, ownerName, sharing, groups, lastModified }]
 *            (GridAdminController.gridViews), or null while they load
 *   error    why they could not be read, or ''
 *   busy     a delete is under way
 * EVENTS OUT
 *   remove  { id, name }  the admin confirmed Delete
 */
import { LightningElement, api } from 'lwc';
import { whoSees } from 'c/gridSavedViews';

export default class GridAdminViews extends LightningElement {
    @api views = null;
    @api error = '';
    @api busy = false;

    /** The view Delete asks about: { id, name }, or null. */
    confirming = null;

    get loading() {
        return !this.views && !this.error;
    }

    get rows() {
        return (Array.isArray(this.views) ? this.views : []).map(v => ({
            key: v.id,
            id: v.id,
            name: v.name,
            owner: v.ownerName || '',
            who: whoSees(v),
            lastModified: v.lastModified || null,
            deleteLabel: `Delete ${v.name}`
        }));
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    get isEmpty() {
        return Array.isArray(this.views) && !this.views.length;
    }

    handleDelete(event) {
        const id = event.currentTarget.dataset.id;
        const row = this.rows.find(r => r.id === id);
        if (row) this.confirming = { id: row.id, name: row.name };
    }

    handleCancel() {
        const id = this.confirming && this.confirming.id;
        this.confirming = null;
        Promise.resolve().then(() => {
            const button = this.template.querySelector(`button[data-id="${id}"]`);
            if (button) button.focus();
        });
    }

    handleConfirm() {
        const view = this.confirming;
        this.confirming = null;
        if (view) this.dispatchEvent(new CustomEvent('remove', { detail: { id: view.id, name: view.name } }));
    }
}
