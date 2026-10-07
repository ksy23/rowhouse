/*
 * Rowhouse benchmark runner. Paste into the browser console on a page showing
 * one Rowhouse grid, as a user with the Rowhouse_Diagnostics permission set,
 * straight after a hard reload (Cmd+Shift+R). It prints one line of JSON.
 *
 * It reads the User Timing measures the grid records (c/gridTiming), then:
 *   - sorts the Number column SORTS times, alternating direction, waiting
 *     each time until the grid is no longer busy: with rows still on the
 *     server a sort reloads them (sortSettledMedianMs);
 *   - edits the first row's Text cell COMMITS times, then discards the edits
 *     with Cancel, so nothing is saved;
 *   - reads the JS heap in use (Chrome only; performance.memory is coarse).
 *
 * Nothing here changes data: every edit is cancelled before the script ends.
 * docs/benchmarks.md gives the protocol this runner is one step of.
 */
(async () => {
    const SORTS = 10;
    const COMMITS = 5;
    const TIMEOUT_MS = 180000;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (test, what) => {
        const deadline = Date.now() + TIMEOUT_MS;
        while (!test()) {
            if (Date.now() > deadline) throw new Error('Timed out waiting for ' + what);
            // eslint-disable-next-line no-await-in-loop
            await sleep(25);
        }
    };
    // Lightning pages nest shadow roots; search through all of them.
    const deep = (selector, root = document) => {
        const hit = root.querySelector(selector);
        if (hit) return hit;
        for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) {
                const found = deep(selector, el.shadowRoot);
                if (found) return found;
            }
        }
        return null;
    };
    const measures = name => performance.getEntriesByName('rowhouse:' + name, 'measure');
    const last = name => {
        const list = measures(name);
        return list.length ? list[list.length - 1].duration : null;
    };
    const median = values => {
        const s = values.slice().sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const round = v => (v === null ? null : Math.round(v));

    await until(() => measures('full-render').length > 0, 'the grid to finish loading');
    const table = deep('table[role="grid"]');
    const result = {
        rows: table ? Number(table.getAttribute('aria-rowcount')) - 1 : null,
        columns: table ? Number(table.getAttribute('aria-colcount')) : null,
        renderedRows: table ? table.querySelectorAll('tbody tr[data-row-id]').length : null,
        firstRowMs: round(last('first-row')),
        fullRenderMs: round(last('full-render'))
    };
    // Which security layer the grid ran under, as the grid itself saw it
    // (c/gridTiming runtimeMode): "locker" or "lws".
    const runtimeMarks = performance.getEntriesByType('mark').filter(m => m.name.indexOf('rowhouse:runtime-') === 0);
    const runtimeMark = runtimeMarks[runtimeMarks.length - 1];
    result.runtime = runtimeMark ? runtimeMark.name.slice('rowhouse:runtime-'.length) : null;
    result.runtimeEvidence = runtimeMark ? runtimeMark.detail : null;

    const sorts = [];
    const settled = [];
    const busy = () => {
        const grid = deep('table[role="grid"]');
        return Boolean(grid) && grid.getAttribute('aria-busy') === 'true';
    };
    for (let i = 0; i < SORTS; i++) {
        const header = deep('th[data-field="Number_Field__c"] a.slds-th__action');
        const before = measures('sort').length;
        const clicked = performance.now();
        header.click();
        // eslint-disable-next-line no-await-in-loop
        await until(() => measures('sort').length > before, 'a sort to paint');
        sorts.push(last('sort'));
        // With rows still on the server, a sort asks the server for the rows
        // in the new order and they load again; the table is busy
        // until they have. Editing before then races the reload.
        // eslint-disable-next-line no-await-in-loop
        await until(() => !busy(), 'the sorted rows to load');
        settled.push(performance.now() - clicked);
        // eslint-disable-next-line no-await-in-loop
        await sleep(300);
    }
    result.sortMedianMs = round(median(sorts));
    result.sortMaxMs = round(Math.max(...sorts));
    result.sortSettledMedianMs = round(median(settled));

    const commits = [];
    for (let i = 0; i < COMMITS; i++) {
        const button = deep('tbody tr[data-row-id] td[data-field="Text_Field__c"] button');
        button.click();
        // eslint-disable-next-line no-await-in-loop
        await until(() => deep('c-cell-text[data-editor] input'), 'the editor to open');
        const input = deep('c-cell-text[data-editor] input');
        input.value = 'Benchmark edit ' + (i + 1);
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        const before = measures('commit').length;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
        // eslint-disable-next-line no-await-in-loop
        await until(() => measures('commit').length > before, 'an edit to paint');
        commits.push(last('commit'));
        // eslint-disable-next-line no-await-in-loop
        await sleep(300);
    }
    result.commitMedianMs = round(median(commits));
    // The Save bar also holds Undo and Redo: find Cancel by its label.
    const bar = deep('[role="region"][aria-label="Unsaved changes"]');
    const cancel = bar ? [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel') : null;
    if (!cancel) throw new Error('Cancel was not found: the benchmark edits are still unsaved drafts');
    cancel.click();
    await until(() => !deep('[role="region"][aria-label="Unsaved changes"]'), 'the edits to be discarded');

    result.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    result.userAgent = navigator.userAgent;
    console.log('[rowhouse-bench]', JSON.stringify(result));
    return result;
})();
