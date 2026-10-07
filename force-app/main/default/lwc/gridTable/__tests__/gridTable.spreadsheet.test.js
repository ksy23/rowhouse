/**
 * The spreadsheet feel in the table (docs/spreadsheet.md): ranges, copy,
 * paste, fill-down, clear, undo/redo requests and frozen columns. The table
 * never writes: each action must come out as ONE cellschange event.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const ROWS = seedRows.slice(0, 6);

describe('spreadsheet feel', () => {
    let el;
    let changes;
    const cell = (i, field) => el.shadowRoot.querySelector(`td[data-row-id="${ROWS[i].Id}"][data-field="${field}"]`);
    const key = async (target, k, mods = {}) => {
        const event = new KeyboardEvent('keydown', {
            key: k,
            bubbles: true,
            composed: true,
            cancelable: true,
            ...mods
        });
        target.dispatchEvent(event);
        await flush();
        return event;
    };
    const focusOn = async (i, field) => {
        const c = cell(i, field);
        c.focus();
        await flush();
        return c;
    };
    const selectedFields = () =>
        [...el.shadowRoot.querySelectorAll('td[aria-selected="true"]')].map(
            td => `${ROWS.findIndex(r => r.Id === td.dataset.rowId)}:${td.dataset.field}`
        );
    const announcement = () => el.shadowRoot.querySelector('[aria-live="polite"][aria-atomic="true"]').textContent;

    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: ROWS, totalRows: ROWS.length };
        changes = [];
        el.addEventListener('cellschange', e => changes.push(e.detail));
        document.body.appendChild(el);
        await flush();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    describe('ranges', () => {
        it('Shift+arrows extend a range; a plain arrow collapses it', async () => {
            await focusOn(0, 'Text_Field__c');
            await key(cell(0, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            await key(cell(1, 'Text_Field__c'), 'ArrowRight', { shiftKey: true });
            expect(selectedFields().sort()).toEqual([
                '0:Number_Field__c',
                '0:Text_Field__c',
                '1:Number_Field__c',
                '1:Text_Field__c'
            ]);
            expect(cell(1, 'Number_Field__c').classList).toContain('rh-in-range');
            expect(announcement()).toBe('2 rows by 2 columns selected');
            expect(el.shadowRoot.querySelector('table').getAttribute('aria-multiselectable')).toBe('true');

            await key(cell(1, 'Number_Field__c'), 'ArrowDown');
            expect(selectedFields()).toEqual([]);
        });

        it('never reaches into the header', async () => {
            await focusOn(0, 'Text_Field__c');
            await key(cell(0, 'Text_Field__c'), 'ArrowUp', { shiftKey: true });
            expect(el.shadowRoot.activeElement).toBe(cell(0, 'Text_Field__c'));
        });

        it('Shift+click extends the range to the clicked cell', async () => {
            await focusOn(0, 'Name');
            cell(2, 'Text_Field__c').dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true })
            );
            await flush();
            expect(selectedFields()).toHaveLength(9); // rows 0-2 x Name, Test Case, Text
        });

        it('ends the range when focus reaches another cell some other way', async () => {
            // Tab back into the grid, a screen reader moving focus, a script:
            // the old anchor no longer means anything.
            await focusOn(0, 'Text_Field__c');
            await key(cell(0, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            expect(selectedFields()).toHaveLength(2);

            await focusOn(4, 'Number_Field__c');
            expect(selectedFields()).toEqual([]);

            await key(cell(4, 'Number_Field__c'), 'ArrowDown', { shiftKey: true });
            expect(selectedFields().sort()).toEqual(['4:Number_Field__c', '5:Number_Field__c']);
        });

        it('Escape clears the range, and so does a sort', async () => {
            await focusOn(0, 'Text_Field__c');
            await key(cell(0, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            await key(cell(1, 'Text_Field__c'), 'Escape');
            expect(selectedFields()).toEqual([]);

            await key(cell(1, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            expect(selectedFields()).toHaveLength(2);
            el.shadowRoot.querySelector('th[data-field="Number_Field__c"] .slds-th__action').click();
            await flush();
            expect(selectedFields()).toEqual([]);
        });
    });

    describe('copy', () => {
        it('writes the range as tab-separated text through the copy event', async () => {
            await focusOn(0, 'Name');
            await key(cell(0, 'Name'), 'ArrowRight', { shiftKey: true });
            await key(cell(0, 'Test_Case__c'), 'ArrowDown', { shiftKey: true });
            // The browser fires the copy event straight after the keydown, in the
            // same task, so nothing is awaited in between.
            cell(1, 'Test_Case__c').dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'c',
                    metaKey: true,
                    bubbles: true,
                    composed: true,
                    cancelable: true
                })
            );
            const setData = jest.fn();
            const copy = new CustomEvent('copy', { bubbles: true, composed: true, cancelable: true });
            copy.clipboardData = { setData };
            cell(1, 'Test_Case__c').dispatchEvent(copy);
            expect(copy.defaultPrevented).toBe(true);
            expect(setData).toHaveBeenCalledWith(
                'text/plain',
                [[ROWS[0].Name, ROWS[0].Test_Case__c].join('\t'), [ROWS[1].Name, ROWS[1].Test_Case__c].join('\t')].join(
                    '\n'
                )
            );
            await flush();
            expect(announcement()).toBe('Copied 4 cells');
        });

        it('falls back to navigator.clipboard when the copy event never arrives', async () => {
            const writeText = jest.fn(() => Promise.resolve());
            Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
            await focusOn(2, 'Name');
            await key(cell(2, 'Name'), 'c', { ctrlKey: true });
            await flush();
            expect(writeText).toHaveBeenCalledWith(ROWS[2].Name);
            delete navigator.clipboard;
        });
    });

    describe('paste', () => {
        const paste = async (target, text) => {
            const event = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
            event.clipboardData = { getData: () => text };
            target.dispatchEvent(event);
            await flush();
            return event;
        };

        it('pastes a block from the focused cell as one cellschange, read by column type', async () => {
            const target = await focusOn(0, 'Text_Field__c');
            const event = await paste(target, 'first\t1,234\r\nsecond\t5\r\n');
            expect(event.defaultPrevented).toBe(true);
            expect(changes).toHaveLength(1);
            expect(changes[0].label).toBe('paste');
            expect(changes[0].changes.map(c => [c.recordId, c.field, c.value])).toEqual([
                [ROWS[0].Id, 'Text_Field__c', 'first'],
                [ROWS[0].Id, 'Number_Field__c', 1234],
                [ROWS[1].Id, 'Text_Field__c', 'second'],
                [ROWS[1].Id, 'Number_Field__c', 5]
            ]);
            expect(selectedFields()).toHaveLength(4); // what was pasted becomes the range
        });

        it('skips read-only cells and reports values it cannot read', async () => {
            const target = await focusOn(0, 'Name');
            await paste(target, 'n\tread only\ttext\tnot a number');
            const detail = changes[0];
            expect(detail.changes.map(c => c.field)).toEqual(['Name', 'Text_Field__c']);
            expect(detail.errors).toEqual([
                { recordId: ROWS[0].Id, field: 'Number_Field__c', message: 'Not a number: not a number' }
            ]);
            expect(announcement()).toBe('Pasted 2 cells. 1 read-only cell skipped. 1 value could not be used.');
        });

        it('fills a whole range with one value', async () => {
            await focusOn(0, 'Text_Field__c');
            await key(cell(0, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            await key(cell(1, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            await paste(cell(2, 'Text_Field__c'), 'same');
            expect(changes[0].changes.map(c => c.value)).toEqual(['same', 'same', 'same']);
        });

        it('leaves paste to the editor while a cell is being edited', async () => {
            await focusOn(0, 'Text_Field__c');
            cell(0, 'Text_Field__c').querySelector('button').click();
            await flush();
            const event = await paste(el.shadowRoot.querySelector('c-cell-text[data-editor]'), 'typed');
            expect(event.defaultPrevented).toBe(false);
            expect(changes).toHaveLength(0);
        });
    });

    describe('fill down and clear', () => {
        it('Cmd+D copies the top row of the range into the rows below', async () => {
            await focusOn(0, 'Text_Field__c');
            await key(cell(0, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            await key(cell(1, 'Text_Field__c'), 'ArrowDown', { shiftKey: true });
            const event = await key(cell(2, 'Text_Field__c'), 'd', { metaKey: true });
            expect(event.defaultPrevented).toBe(true);
            expect(changes[0].label).toBe('fill down');
            expect(changes[0].changes).toEqual([
                {
                    recordId: ROWS[1].Id,
                    field: 'Text_Field__c',
                    value: ROWS[0].Text_Field__c,
                    originalValue: ROWS[1].Text_Field__c
                },
                {
                    recordId: ROWS[2].Id,
                    field: 'Text_Field__c',
                    value: ROWS[0].Text_Field__c,
                    originalValue: ROWS[2].Text_Field__c
                }
            ]);
        });

        it('on one cell, Cmd+D fills from the cell above', async () => {
            await focusOn(3, 'Name');
            await key(cell(3, 'Name'), 'd', { ctrlKey: true });
            expect(changes[0].changes).toEqual([
                { recordId: ROWS[3].Id, field: 'Name', value: ROWS[2].Name, originalValue: ROWS[3].Name }
            ]);
        });

        it('Delete clears the editable cells of the range and skips the rest', async () => {
            await focusOn(0, 'Name');
            await key(cell(0, 'Name'), 'ArrowRight', { shiftKey: true });
            await key(cell(0, 'Test_Case__c'), 'Delete');
            expect(changes[0].label).toBe('clear');
            expect(changes[0].changes).toEqual([
                { recordId: ROWS[0].Id, field: 'Name', value: null, originalValue: ROWS[0].Name }
            ]);
            expect(announcement()).toBe('Cleared 1 cell. 1 read-only cell skipped.');
        });
    });

    describe('undo and redo', () => {
        it('asks the parent to undo and redo, with the spreadsheet keys', async () => {
            const heard = [];
            el.addEventListener('undo', () => heard.push('undo'));
            el.addEventListener('redo', () => heard.push('redo'));
            await focusOn(0, 'Name');
            await key(cell(0, 'Name'), 'z', { metaKey: true });
            await key(cell(0, 'Name'), 'Z', { metaKey: true, shiftKey: true });
            await key(cell(0, 'Name'), 'y', { ctrlKey: true });
            expect(heard).toEqual(['undo', 'redo', 'redo']);
        });
    });
});

describe('frozen columns', () => {
    let spy;
    beforeEach(() => {
        spy = jest
            .spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 150, height: 33, top: 0, left: 0, right: 150, bottom: 33, x: 0, y: 0 });
    });
    afterEach(() => {
        spy.mockRestore();
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('sticks the first N columns at their pinned offsets, header above body', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: ROWS, totalRows: ROWS.length, frozenColumns: 2, selection: 'multi' };
        document.body.appendChild(el);
        await flush();
        await frame();
        await flush();
        const th = f => el.shadowRoot.querySelector(`th[data-field="${f}"]`);
        const td = f => el.shadowRoot.querySelector(`td[data-row-id="${ROWS[0].Id}"][data-field="${f}"]`);
        // The selection column (32px) is frozen with them, first.
        expect(th('__select').classList).toContain('rh-frozen');
        expect(th('Name').style.left).toBe('32px');
        expect(th('Test_Case__c').style.left).toBe('182px');
        expect(th('Test_Case__c').classList).toContain('rh-frozen_last');
        expect(Number(th('Name').style.zIndex)).toBeGreaterThan(Number(th('Test_Case__c').style.zIndex));
        expect(td('Name').style.left).toBe('32px');
        expect(td('Name').classList).toContain('rh-frozen');
        expect(th('Text_Field__c').classList).not.toContain('rh-frozen');
        expect(td('Text_Field__c').style.left).toBe('');
    });
});
