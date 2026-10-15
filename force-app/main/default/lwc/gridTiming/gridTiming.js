/**
 * gridTiming — User Timing marks and measures for the published benchmark, and
 * for anyone profiling a slow grid in the browser's Performance panel.
 *
 * Only with the Rowhouse_Grid_Diagnostics permission: the grid passes that flag as
 * `on`, and without it every call returns at once and writes nothing. Names
 * all start "rowhouse:", so they are easy to find in the Timings track and to
 * read back with performance.getEntriesByName.
 *
 * The measures (docs/benchmarks.md says how each is used):
 *   rowhouse:first-row    grid connected -> first data row painted
 *   rowhouse:full-render  grid connected -> every row loaded and painted
 *                         (with windowing, the steady state of the window)
 *   rowhouse:sort         sort activated -> re-sorted rows painted
 *   rowhouse:commit       edit committed -> the edited cell painted
 *   rowhouse:key-render   key pressed in the table -> the table redrawn, or the
 *                         focus moved in place where no redraw is needed,
 *                         before the paint: what one key costs the browser
 *   rowhouse:rows         the part of a key's redraw spent building the rows'
 *                         models; the rest of key-render is LWC's diff and patch
 *                         (none when the key needed no redraw)
 *
 * "Painted" means the first moment after the browser has painted the frame
 * that shows the change: a requestAnimationFrame callback runs just before a
 * paint, and a zero-delay timeout queued from it runs just after.
 *
 * With the start mark, one more says which security layer the grid ran
 * under, for the benchmark's two passes (docs/benchmarks.md):
 *   rowhouse:runtime-locker  Lightning Locker
 *   rowhouse:runtime-lws     not Locker: Lightning Web Security in Lightning
 * The page itself cannot tell (Aura's $A.lockerService answers the same under
 * both, found); only code inside the component can. Under Locker
 * a component's `window` and `document` are Locker's wrappers, whose names
 * say so ("SecureWindow: [object Window]{ key: ... }"); under Lightning Web
 * Security they are the page's own. The mark's detail keeps what was seen.
 */
const PREFIX = 'rowhouse:';

/** 'locker' when this code runs inside Lightning Locker, else 'lws'. */
export function runtimeMode() {
    const seen = runtimeEvidence();
    return /^Secure(Window|Document)\b/.test(seen.window) || /^Secure(Window|Document)\b/.test(seen.document)
        ? 'locker'
        : 'lws';
}

/** What `window` and `document` call themselves here, cut short. */
function runtimeEvidence() {
    const name = value => {
        try {
            return String(value).slice(0, 40);
        } catch {
            return '';
        }
    };
    return {
        window: typeof window === 'undefined' ? '' : name(window),
        document: typeof document === 'undefined' ? '' : name(document)
    };
}

function timeline() {
    return typeof performance !== 'undefined' && typeof performance.mark === 'function' ? performance : null;
}

/** Record a mark now, or at an earlier performance.now() reading. */
export function mark(on, name, startTime) {
    const perf = on ? timeline() : null;
    if (!perf) return;
    try {
        if (typeof startTime === 'number') perf.mark(PREFIX + name, { startTime });
        else perf.mark(PREFIX + name);
        if (name === 'start') perf.mark(PREFIX + 'runtime-' + runtimeMode(), { detail: runtimeEvidence() });
    } catch {
        // Timing must never break the grid (an old browser without the
        // startTime option, say). The benchmark simply has one fewer number.
    }
}

/** Record a measure from a mark to now. Does nothing if the mark is missing. */
export function measure(on, name, fromMark) {
    const perf = on ? timeline() : null;
    if (!perf || typeof perf.measure !== 'function') return;
    try {
        perf.measure(PREFIX + name, PREFIX + fromMark);
    } catch {
        // No such mark: the start happened before diagnostics were known.
    }
}

/** Run `callback` once the current changes have been painted. */
export function afterPaint(callback) {
    if (typeof requestAnimationFrame !== 'function') {
        callback();
        return;
    }
    // eslint-disable-next-line @lwc/lwc/no-async-operation -- measurement only: nothing reactive is changed
    requestAnimationFrame(() => setTimeout(callback, 0));
}
