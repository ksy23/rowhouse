/**
 * A paste of more than MAX_PASTE_CELLS cells is refused from its size alone,
 * worked out from the block's and the range's dimensions, before a cell of it
 * is listed (pastePlan is never called) and without a stack overflow on a
 * very long paste.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { pastePlan } from 'c/gridClipboard';
import { columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

jest.mock('c/gridClipboard', () => {
    const actual = jest.requireActual('c/gridClipboard');
    return { ...actual, pastePlan: jest.fn(actual.pastePlan) };
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ROW_COUNT = 2600;
const ROWS = Array.from({ length: ROW_COUNT }, (_, i) => ({
    Id: 'a0' + String(i).padStart(16, '0'),
    Name: 'Row ' + (i + 1),
    Test_Case__c: 'BENCH',
    Text_Field__c: 'text ' + (i + 1),
    Number_Field__c: i + 1
}));
/** Tab-separated text: `lines` lines of `width` values. */
const tsv = (lines, width) => Array.from({ length: lines }, () => new Array(width).fill('v').join('\t')).join('\n');

describe('the paste limit', () => {
    let el;
    let changes;
    const cell = (i, field) => el.shadowRoot.querySelector(`td[data-row-id="${ROWS[i].Id}"][data-field="${field}"]`);
    const announcement = () => el.shadowRoot.querySelector('[aria-live="polite"][aria-atomic="true"]').textContent;
    const paste = async text => {
        const target = cell(0, 'Text_Field__c');
        target.focus();
        await flush();
        const event = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
        event.clipboardData = { getData: () => text };
        target.dispatchEvent(event);
        await flush();
    };

    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: ROWS, totalRows: ROWS.length };
        changes = [];
        el.addEventListener('cellschange', e => changes.push(e.detail));
        document.body.appendChild(el);
        await flush();
        pastePlan.mockClear();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('refuses more than 10000 cells from the size alone, before listing them', async () => {
        await paste(tsv(ROW_COUNT, 4)); // 2,600 rows by 4 columns, all inside the grid
        expect(announcement()).toBe('Nothing was pasted: 10400 cells is more than 10000 at once.');
        expect(pastePlan).not.toHaveBeenCalled();
        expect(changes).toEqual([]);
    });

    it('counts only the cells inside the grid, and refuses 300,000 lines without a stack overflow', async () => {
        await paste(tsv(300000, 4)); // the grid has 2,600 rows: 10,400 of these cells land in it
        expect(announcement()).toBe('Nothing was pasted: 10400 cells is more than 10000 at once.');
        expect(pastePlan).not.toHaveBeenCalled();
        expect(changes).toEqual([]);
    });

    it('pastes up to the limit', async () => {
        await paste(tsv(2500, 4)); // exactly 10,000 cells
        expect(pastePlan).toHaveBeenCalledTimes(1);
        expect(changes).toHaveLength(1);
        expect(announcement()).not.toMatch(/^Nothing was pasted/);
    });
});
