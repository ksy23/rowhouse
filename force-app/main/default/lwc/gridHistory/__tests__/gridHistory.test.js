/**
 * Undo and redo of uncommitted edits: one action is one step, a new
 * action clears redo, and undo puts back exactly the drafts that were there.
 */
import { emptyHistory, stepBetween, record, undo, redo, describe as name, draftState, withoutRecords, MAX_STEPS } from 'c/gridHistory';

const A = 'a0000000000000AAA';
const B = 'a0000000000000BBB';

describe('gridHistory', () => {
    it('records only the cells whose draft changed', () => {
        const before = { [A]: { Text: 'x' } };
        const after = { [A]: { Text: 'x', Number: 5 }, [B]: { Text: 'y' } };
        const step = stepBetween('paste', before, after, [
            { recordId: A, field: 'Text' },
            { recordId: A, field: 'Number' },
            { recordId: B, field: 'Text' },
            { recordId: B, field: 'Text' }
        ]);
        expect(step.cells).toEqual([
            { recordId: A, field: 'Number', before: { has: false }, after: { has: true, value: 5 } },
            { recordId: B, field: 'Text', before: { has: false }, after: { has: true, value: 'y' } }
        ]);
        expect(stepBetween('edit', before, before, [{ recordId: A, field: 'Text' }])).toBeNull();
    });

    it('undo restores the drafts before the step, redo the drafts after it', () => {
        const before = { [A]: { Text: 'old draft' } };
        const after = { [A]: { Text: 'new' }, [B]: { Number: 1 } };
        const cells = [{ recordId: A, field: 'Text' }, { recordId: B, field: 'Number' }];
        let history = record(emptyHistory(), stepBetween('paste', before, after, cells));

        const undone = undo(history, after);
        expect(undone.drafts).toEqual(before);
        expect(undone.history.undo).toHaveLength(0);
        expect(undone.history.redo).toHaveLength(1);
        history = undone.history;

        const redone = redo(history, undone.drafts);
        expect(redone.drafts).toEqual(after);
        expect(redone.history.redo).toHaveLength(0);
    });

    it('a new step empties the redo stack', () => {
        const one = { [A]: { Text: '1' } };
        let history = record(emptyHistory(), stepBetween('edit', {}, one, [{ recordId: A, field: 'Text' }]));
        history = undo(history, one).history;
        expect(history.redo).toHaveLength(1);
        history = record(history, stepBetween('edit', {}, { [B]: { Text: '2' } }, [{ recordId: B, field: 'Text' }]));
        expect(history.redo).toHaveLength(0);
    });

    it('keeps only the last MAX_STEPS steps', () => {
        let history = emptyHistory();
        for (let i = 0; i < MAX_STEPS + 5; i++) {
            history = record(history, { label: 'edit', cells: [{ recordId: A, field: 'F' + i, before: { has: false }, after: { has: true, value: i } }] });
        }
        expect(history.undo).toHaveLength(MAX_STEPS);
        expect(history.undo[0].cells[0].field).toBe('F5');
    });

    it('returns null when there is nothing to undo or redo, and never mutates its input', () => {
        const history = emptyHistory();
        expect(undo(history, {})).toBeNull();
        expect(redo(history, {})).toBeNull();
        const drafts = { [A]: { Text: 'x' } };
        const frozen = JSON.stringify(drafts);
        const h = record(history, stepBetween('edit', {}, drafts, [{ recordId: A, field: 'Text' }]));
        undo(h, drafts);
        expect(JSON.stringify(drafts)).toBe(frozen);
    });

    it('forgets deleted records, keeping the rest of each step undoable', () => {
        let h = emptyHistory();
        h = record(h, stepBetween('edit', {}, { [A]: { Text: 'a' } }, [{ recordId: A, field: 'Text' }]));
        const both = { [A]: { Text: 'a', Number: 1 }, [B]: { Number: 1 } };
        h = record(h, stepBetween('mass update', { [A]: { Text: 'a' } }, both, [{ recordId: A, field: 'Number' }, { recordId: B, field: 'Number' }]));
        const pruned = withoutRecords(h, [A]);
        expect(pruned.undo).toHaveLength(1);
        expect(pruned.undo[0].label).toBe('mass update');
        expect(pruned.undo[0].cells.map(c => c.recordId)).toEqual([B]);
        expect(h.undo).toHaveLength(2); // the history it was given is unchanged
        const back = undo(pruned, { [B]: { Number: 1 } });
        expect(back.drafts).toEqual({});
    });

    it('names steps for announcements', () => {
        expect(name({ label: 'paste', cells: [{}, {}, {}] })).toBe('paste of 3 cells');
        expect(name({ label: 'edit', cells: [{}] })).toBe('edit');
        expect(draftState({}, A, 'Text')).toEqual({ has: false });
    });
});
