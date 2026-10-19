/**
 * A layout change held in the browser until the server has kept it, and
 * which one wins when the grid opens again.
 */
import { pendingKey, holdLayout, heldLayout, releaseLayout, confirmLayout, decide } from 'c/gridPendingLayout';

const KEY = pendingKey('005000000000001AAA', 'Consignments', null);
const OLD = '{"v":1,"sort":[]}';
const MINE = '{"v":1,"sort":[],"columns":["Name"]}';
const OTHER = '{"v":1,"sort":[{"field":"Name","direction":"desc"}]}';

describe('gridPendingLayout', () => {
    it('keys a layout by user, grid and child table tab', () => {
        expect(pendingKey('005A', 'Grid', null)).toBe('rowhouse.layout.005A.Grid.');
        expect(pendingKey('005A', 'Grid', 'Parent_Child')).toBe('rowhouse.layout.005A.Grid.Parent_Child');
        expect(pendingKey('005B', 'Grid', null)).not.toBe(pendingKey('005A', 'Grid', null));
    });

    it('holds a change with the layout the server had, and reads it back', () => {
        expect(holdLayout(KEY, MINE, OLD)).toBe(true);
        expect(heldLayout(KEY)).toEqual({ json: MINE, base: OLD });
        expect(holdLayout(KEY, MINE, null)).toBe(true);
        expect(heldLayout(KEY)).toEqual({ json: MINE, base: null });
    });

    it('holds nothing without a key or a layout, and reads nothing it cannot parse', () => {
        expect(holdLayout('', MINE, OLD)).toBe(false);
        expect(holdLayout(KEY, null, OLD)).toBe(false);
        localStorage.setItem(KEY, 'not json');
        expect(heldLayout(KEY)).toBeNull();
        localStorage.setItem(KEY, JSON.stringify({ base: OLD }));
        expect(heldLayout(KEY)).toBeNull();
    });

    it('lets go of exactly the change it is told of, and of anything without one', () => {
        holdLayout(KEY, MINE, OLD);
        releaseLayout(KEY, OTHER);
        expect(heldLayout(KEY)).not.toBeNull();
        releaseLayout(KEY, MINE);
        expect(heldLayout(KEY)).toBeNull();
        holdLayout(KEY, MINE, OLD);
        releaseLayout(KEY);
        expect(heldLayout(KEY)).toBeNull();
    });

    it('once the server keeps a change, lets it go, or rests a newer one on it', () => {
        holdLayout(KEY, MINE, OLD);
        confirmLayout(KEY, MINE);
        expect(heldLayout(KEY)).toBeNull();
        // A newer change was held while an older one was on its way.
        holdLayout(KEY, OTHER, OLD);
        confirmLayout(KEY, MINE);
        expect(heldLayout(KEY)).toEqual({ json: OTHER, base: MINE });
    });

    it('uses a held change only when the server still has what it had then', () => {
        expect(decide(null, OLD)).toBe('none');
        expect(decide({ json: MINE, base: OLD }, OLD)).toBe('use');
        expect(decide({ json: MINE, base: null }, null)).toBe('use');
        expect(decide({ json: MINE, base: null }, '')).toBe('use');
        // The request did arrive.
        expect(decide({ json: MINE, base: OLD }, MINE)).toBe('release');
        // Kept since, elsewhere, or reset: newer than the held change.
        expect(decide({ json: MINE, base: OLD }, OTHER)).toBe('release');
        expect(decide({ json: MINE, base: OLD }, null)).toBe('release');
    });

    it('holds nothing, and fails nothing, where the browser keeps nothing', () => {
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(holdLayout(KEY, MINE, OLD)).toBe(false);
        spy.mockRestore();
        const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(heldLayout(KEY)).toBeNull();
        expect(() => releaseLayout(KEY)).not.toThrow();
        expect(() => confirmLayout(KEY, MINE)).not.toThrow();
        get.mockRestore();
    });
});
