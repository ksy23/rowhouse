/**
 * The benchmark's timing hooks: silent without diagnostics, "rowhouse:"
 * names with it, and never able to break the grid.
 */
import { mark, measure, afterPaint, runtimeMode } from 'c/gridTiming';

describe('gridTiming', () => {
    let markSpy;
    let measureSpy;
    beforeEach(() => {
        markSpy = jest.fn();
        measureSpy = jest.fn();
        performance.mark = markSpy;
        performance.measure = measureSpy;
    });

    it('records nothing when diagnostics are off', () => {
        mark(false, 'start');
        measure(false, 'first-row', 'start');
        expect(markSpy).not.toHaveBeenCalled();
        expect(measureSpy).not.toHaveBeenCalled();
    });

    it('prefixes every name, and back-dates a mark when given a start time', () => {
        mark(true, 'sort-start');
        mark(true, 'start', 12.5);
        measure(true, 'sort', 'sort-start');
        expect(markSpy).toHaveBeenNthCalledWith(1, 'rowhouse:sort-start');
        expect(markSpy).toHaveBeenNthCalledWith(2, 'rowhouse:start', { startTime: 12.5 });
        expect(measureSpy).toHaveBeenCalledWith('rowhouse:sort', 'rowhouse:sort-start');
    });

    it('says which security layer the grid ran under, with the start mark only', () => {
        mark(true, 'sort-start');
        expect(markSpy).toHaveBeenCalledTimes(1);
        mark(true, 'start', 3);
        // Jest's window is the page's own, as under Lightning Web Security.
        expect(markSpy).toHaveBeenLastCalledWith('rowhouse:runtime-lws', {
            detail: { window: '[object Window]', document: '[object Document]' }
        });
        mark(false, 'start');
        expect(markSpy).toHaveBeenCalledTimes(3);
    });

    it('recognises Locker by the names of its wrappers', () => {
        const realWindow = window.toString;
        window.toString = () => 'SecureWindow: [object Window]{ key: {"namespace":"c"} }';
        try {
            expect(runtimeMode()).toBe('locker');
        } finally {
            window.toString = realWindow;
        }
        expect(runtimeMode()).toBe('lws');
    });

    it('swallows a missing mark rather than throwing into the grid', () => {
        measureSpy.mockImplementation(() => {
            throw new DOMException('No mark named rowhouse:start', 'SyntaxError');
        });
        expect(() => measure(true, 'first-row', 'start')).not.toThrow();
    });

    it('runs the callback after the next frame, not before', async () => {
        const done = jest.fn();
        afterPaint(done);
        expect(done).not.toHaveBeenCalled();
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 5)));
        expect(done).toHaveBeenCalledTimes(1);
    });
});
