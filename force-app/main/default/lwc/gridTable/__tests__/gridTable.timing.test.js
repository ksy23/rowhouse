/**
 * Benchmark timings from the table: only with diagnostics on, and each measure
 * taken from the right mark after the change has painted.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const painted = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 5)));

describe('benchmark timings', () => {
    let measureSpy;
    let markSpy;
    beforeEach(() => {
        markSpy = jest.fn();
        measureSpy = jest.fn();
        performance.mark = markSpy;
        performance.measure = measureSpy;
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    const mount = async diagnostics => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 5), totalRows: 5, diagnostics };
        document.body.appendChild(el);
        await flush();
        await painted();
        return el;
    };
    const names = () => measureSpy.mock.calls.map(c => c[0]);

    it('records nothing without diagnostics', async () => {
        const el = await mount(false);
        el.shadowRoot.querySelector('th[data-field="Number_Field__c"] .slds-th__action').click();
        await flush();
        await painted();
        expect(markSpy).not.toHaveBeenCalled();
        expect(measureSpy).not.toHaveBeenCalled();
    });

    it("measures an arrow key's move, which is done without a redraw", async () => {
        const el = await mount(true);
        const cell = el.shadowRoot.querySelector('td[data-field="Name"]');
        cell.focus();
        await flush();
        markSpy.mockClear();
        measureSpy.mockClear();
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
        expect(markSpy).toHaveBeenCalledWith('rowhouse:key-start');
        await flush();
        expect(names()).toEqual(['rowhouse:key-render']);
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:key-render', 'rowhouse:key-start');
    });

    it('measures a key that redraws the table, and the part spent building the rows', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 5), totalRows: 5, diagnostics: true, selection: 'multi' };
        document.body.appendChild(el);
        await flush();
        await painted();
        const cell = el.shadowRoot.querySelector('td[data-field="Name"]');
        cell.focus();
        await flush();
        markSpy.mockClear();
        measureSpy.mockClear();
        // Space selects the row: a change the whole row shows, so a redraw.
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }));
        await flush();
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:key-render', 'rowhouse:key-start');
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:rows', 'rowhouse:rows-start');
        expect(names().filter(n => n === 'rowhouse:key-render')).toHaveLength(1);
    });

    it('closes the measure of a key that changed nothing, so the next redraw is not charged to it', async () => {
        const el = await mount(true);
        const cell = el.shadowRoot.querySelector('td[data-field="Name"]');
        cell.focus();
        await flush();
        measureSpy.mockClear();
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, composed: true }));
        await flush();
        el.config = { ...el.config, rows: seedRows.slice(0, 4) };
        await flush();
        expect(names()).not.toContain('rowhouse:key-render');
    });

    it('measures no key press without diagnostics', async () => {
        const el = await mount(false);
        const cell = el.shadowRoot.querySelector('td[data-field="Name"]');
        cell.focus();
        await flush();
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
        await flush();
        expect(markSpy).not.toHaveBeenCalled();
        expect(measureSpy).not.toHaveBeenCalled();
    });

    it('measures the first row and the full render from the load start', async () => {
        await mount(true);
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:first-row', 'rowhouse:start');
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:full-render', 'rowhouse:start');
    });

    it('measures a sort from its activation to the repaint', async () => {
        const el = await mount(true);
        measureSpy.mockClear();
        el.shadowRoot.querySelector('th[data-field="Number_Field__c"] .slds-th__action').click();
        expect(markSpy).toHaveBeenCalledWith('rowhouse:sort-start');
        await flush();
        await painted();
        expect(names()).toEqual(['rowhouse:sort']);
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:sort', 'rowhouse:sort-start');
    });

    it('measures an edit from its commit to the repaint', async () => {
        const el = await mount(true);
        measureSpy.mockClear();
        const id = seedRows[0].Id;
        el.shadowRoot.querySelector(`td[data-row-id="${id}"][data-field="Text_Field__c"] button`).click();
        await flush();
        el.shadowRoot
            .querySelector('c-cell-text[data-editor]')
            .dispatchEvent(new CustomEvent('commit', { detail: { value: 'changed' } }));
        expect(markSpy).toHaveBeenCalledWith('rowhouse:commit-start');
        await flush();
        await painted();
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:commit', 'rowhouse:commit-start');
    });

    it('does not measure the load again when a new page of rows arrives', async () => {
        const el = await mount(true);
        measureSpy.mockClear();
        el.config = { columns, rows: seedRows.slice(0, 8), totalRows: 8, diagnostics: true };
        await flush();
        await painted();
        expect(names()).toEqual([]);
    });
});
