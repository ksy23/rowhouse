# Benchmarks

How fast Rowhouse is at 1,000, 5,000 and 10,000 rows, with 5 and 20 columns,
at 50,000 rows, past the grid's 10,000-row ceiling, and at 110,000 rows, past
the 100,000 rows one Salesforce pagination cursor holds; and how anyone can
check.

> **Status: the pass with Lightning Web Security on is complete** (8 sizes,
> 5 runs each, all in a visible tab). **The pass with Lightning Web Security
> off (Locker) covers the 50,000-row lines only**: see "Locker" below.
>
> **A grid now opens with one call** that brings its setup, the user's layout
> and the first page together. The results below were measured before the grid
> worked this way, so first-row times are now shorter than shown: on a grid of
> 56 rows, the rows arrived about 1,050 ms after the grid started before, and
> 390–420 ms after. The next pass will measure it.

## What is measured

Every number is a User Timing measure the grid records itself, only for a user
with the `Rowhouse_Diagnostics` permission set (`c/gridTiming`).

| Measure | From | To |
| --- | --- | --- |
| `rowhouse:first-row` | the grid starts loading | the first data row is painted |
| `rowhouse:full-render` | the grid starts loading | every row is loaded and painted (with windowing above 150 rows, the rendered window) |
| `rowhouse:sort` | a header is activated | the loaded rows, re-sorted, are painted |
| sort settled | a header is activated | the grid is no longer busy: with rows still on the server, a sort asks the server for the rows in the new order and they load again |
| `rowhouse:commit` | an edit is committed | the edited cell is painted |
| `rowhouse:runtime-locker` or `rowhouse:runtime-lws` | | a mark, not a measure: which security layer the grid ran under, as the grid itself saw it (below) |
| heap | | `performance.memory.usedJSHeapSize` after the run (Chrome only, coarse) |

"Painted" is the first moment after the browser painted the frame that shows
the change. The same measures appear in the Timings track of Chrome's
Performance panel.

## The data

`Rowhouse_Bench__c`, a test-only object holding nothing but benchmark rows:
Name, 14 generated fields and 5 formula fields. `Bench_5` shows Name, Text,
Number, Date and Stage; `Bench_20` shows all twenty. Row N is the same row
whether it came from `test-data/scripts/generate-benchmark.py` (CSV) or
`RowhouseBenchData.insertRows` (Anonymous Apex). See `test-data/README.md`.

## Running it

1. Give the user running the benchmark the `Rowhouse_User`,
   `Rowhouse_Test_Full` and `Rowhouse_Diagnostics` permission sets.
2. Load rows 1–1,000:
   `RowhouseBenchData.insertRows(1, 1000);` in Anonymous Apex, or
   `benchmark-to-1k.csv` through the Bulk API.
3. Open a page with the grid (with the `dev/` metadata deployed:
   `/lightning/n/Rowhouse_Dev?c__grid=Bench_5`), reload it once to warm the
   cache, then hard-reload it (Cmd+Shift+R).
4. Paste `test-data/bench/run-benchmark.js` into the console. It waits for the
   load, sorts the Number column ten times (waiting after each sort until the
   grid is no longer busy), edits a cell five times and cancels the edits,
   and prints one line of JSON.
5. Repeat steps 3–4 five times and take the median of each number.
6. Do the same with `c__grid=Bench_20`.
7. Grow the object to 5,000 rows (`insertRows(1001, 3000)` then
   `insertRows(3001, 5000)`, or `benchmark-to-5k.csv`), and repeat from 3.
   Then to 10,000, then to 50,000 (`benchmark-to-50k.csv`, or `insertRows`
   2,000 rows at a time, its limit). Or go down instead: delete the rows
   above a size; row N is always named `BM-` and N in six digits, so for
   10,000: `delete [SELECT Id FROM Rowhouse_Bench__c WHERE Name > 'BM-010000' LIMIT 10000];`
   (repeat until nothing is left above it). The published runs went down
   from 50,000, then grew the object back. The 110,000-row runs added rows
   50,001 to 110,000 in one Bulk API load
   (`python3 test-data/scripts/generate-benchmark.py 50001 110000` writes
   them as one CSV) and deleted them again afterwards. 110,000 rows take
   about 220 MB of data storage at 2 KB a record.
8. Turn Lightning Web Security off (Setup, Session Settings) and run
   everything again. Turn it back on afterwards. **Hard-reload** every page
   (Cmd+Shift+R) and check the runner's `runtime` field: an ordinary reload
   kept the browser's cached Lightning Web Security framework, and the grid
   went on reporting `lws` for minutes after the switch.

**The tab must stay visible for the whole run.** A tab behind another window,
minimised or on another desktop paints nothing, so the paint-based measures
wait until something else forces a frame (a first-row time of 43 seconds was
one such frame). The published runs recorded whether the page was ever
hidden (`visibilitychange`) and threw away every run where it was.

Nothing in a run changes data: the script cancels every edit.

## Results

Lightning Web Security on. Median of 5 runs per line; the full runs, with
their ranges, are in `test-data/bench/results-2026-09-30.jsonl`.

| Rows | Columns | First row | Full render | Sort | Sort settled | Edit commit | Heap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 5 | 876 ms | 1,208 ms | 124 ms | 156 ms | 47 ms | 416 MB |
| 1,000 | 20 | 1,438 ms | 1,742 ms | 335 ms | 366 ms | 136 ms | 738 MB |
| 5,000 | 5 | 931 ms | 2,737 ms | 206 ms | 239 ms | 79 ms | 418 MB |
| 5,000 | 20 | 1,495 ms | 4,693 ms | 439 ms | 475 ms | 206 ms | 728 MB |
| 10,000 | 5 | 988 ms | 4,473 ms | 330 ms | 359 ms | 120 ms | 429 MB |
| 10,000 | 20 | 1,701 ms | 8,224 ms | 535 ms | 576 ms | 276 ms | 621 MB |
| 50,000 (10,000 loaded) | 5 | 965 ms | 4,511 ms | 232 ms | 4,358 ms | 147 ms | 465 MB |
| 50,000 (10,000 loaded) | 20 | 1,478 ms | 8,336 ms | 534 ms | 8,221 ms | 273 ms | 826 MB |

Reading the table:
- **Sort** is the loaded rows re-sorted in the browser and painted. Up to
  10,000 rows that is the whole sort. At 50,000 the grid then asks the server
  for the first 10,000 rows in the new order; **sort settled** is when they
  have all arrived, which is about as long as loading them the first time.
- **Full render** at 10,000 and 50,000 is mostly the server: the rows come
  2,000 at a time, and each page of 20 columns took about 0.9–1s of server
  time (the grid's own page telemetry, `"event":"page"`).
- **Heap** is Chrome's figure for the whole tab after the run. It includes
  memory from earlier page loads not yet collected: the five runs of Bench_20
  at 5,000 rows read from 320 MB to 1,179 MB. Read it as a rough size, not a
  measurement.
- The first row takes about 0.9s with 5 columns and 1.4–1.7s with 20 at every
  size: the first page is always 200 rows.

### Locker (Lightning Web Security off)

**50,000 rows only** (10,000 loaded); the 1,000, 5,000 and 10,000 lines were
not run. Median
of 5 runs for Bench_5 and of 3 for Bench_20; the runs are in
`test-data/bench/results-locker-2026-09-30.jsonl`. Every run reported
`runtime: "locker"` and none saw the tab hidden.

| Rows | Columns | Layer | First row | Full render | Sort | Sort settled | Edit commit | Heap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50,000 (10,000 loaded) | 5 | Locker | 799 ms | 4,179 ms | 113 ms | 3,953 ms | 43 ms | 250 MB |
| 50,000 (10,000 loaded) | 5 | LWS (above) | 965 ms | 4,511 ms | 232 ms | 4,358 ms | 147 ms | 465 MB |
| 50,000 (10,000 loaded) | 20 | Locker (3 runs) | 1,214 ms | 7,620 ms | 286 ms | 7,409 ms | 61 ms | 357 MB |
| 50,000 (10,000 loaded) | 20 | LWS (above) | 1,478 ms | 8,336 ms | 534 ms | 8,221 ms | 273 ms | 826 MB |

Reading it with care:
- **Locker was not slower here; the browser-side numbers were about half.**
  Sort (re-sorting 10,000 loaded rows) took 113 ms against 232 ms with 5
  columns and 286 ms against 534 ms with 20; an edit took 43 ms against 147 ms.
  The server-bound numbers (full render, sort settled) are within about 10%.
- **The two passes were not run side by side.** The LWS pass was taken earlier
  the same day, before two small changes to the grid (the floating Save bar, a
  windowing fix for a tall grid) and in a differently sized window, so part of
  the gap may be the grid and the page, not the security layer. Only a pass
  that alternates the two settings in one sitting would settle it.
- **Heap** is the coarse whole-tab figure, as above.

**How the runtime is confirmed.** Nothing on the page can tell the two layers
apart: Aura's `$A.lockerService.isEnabled()` answers the same under both, and
`isLockerNextEnabledForComponent()` returned false under Lightning Web
Security as well. Only code inside the component can: under Locker a
component's `window` and `document` are Locker's wrappers, which name
themselves ("SecureWindow: [object Window]{ key: ... }"), and under Lightning
Web Security they are the page's own ("[object Window]"). So, with
diagnostics on, the grid records a mark when it starts loading,
`rowhouse:runtime-locker` or `rowhouse:runtime-lws`, with what it saw in the
mark's detail (`c/gridTiming` runtimeMode), and the runner reports it as
`runtime`. Checked live both ways: `lws` with the setting on;
after switching it off, `lws` still on ordinary reloads, then `locker` with
"SecureWindow" and "SecureDocument" after a hard reload. The setting itself
can also be read with the Tooling API: `SELECT Metadata FROM
SecuritySettings`, `sessionSettings.lockerServiceNext`.

## Past 100,000 records

Measured on 8 October 2026 with 110,000 bench rows, Lightning Web Security
on, in the same org, browser and machine as the runs above. The runs are in
`test-data/bench/results-2026-10-08.jsonl`; every one reported
`runtime: "lws"` and none saw the tab hidden. Runs in which the tab was
hidden were thrown away.

| Rows | Columns | Runs | First row | Full render | Sort | Sort settled | Edit commit | Heap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 110,000 (10,000 loaded) | 5 | 5 | 938 ms | 4,430 ms | 258 ms | 4,448 ms | 119 ms | 319 MB |
| 110,000 (10,000 loaded) | 20 | 2 | 1,645 ms | 8,554 ms | 545 ms | 8,850 ms | 286 ms | 376 MB |

Reading it:
- **The numbers match the 50,000 lines.** The grid loads the first 10,000
  rows whatever the object's size, and a sort fetches the first 10,000 in the
  new order, so 110,000 costs what 50,000 did. The 20-column line is the
  median of 2 runs, not 5: the other runs were spoiled by the tab being
  hidden, and are not counted.
- **What changed to get here.** Salesforce refuses to open a pagination cursor
  on more than 100,000 rows, with an error no code can catch, so until this
  change a grid over more than 100,000 matching records did not open at all.
  The grid now asks for at most 100,000 and counts the rest with `COUNT()`,
  which costs one query row however many it counts. It shows "10,000 of
  110,000 items", scrolls through the first 100,000, and a search or filter
  narrows the rest.
- **Scrolling to the 100,000th row** took about 85 seconds with 5 columns
  (45 pages of 2,000, about 0.75 s each, mostly Salesforce), and the tab then
  used about 480 MB.
- **Larger objects.** This org holds about 125,000 bench rows (250 MB of data
  storage, 2 KB a record), so 500,000 was not measured. Nothing in the grid
  reads more than 100,000 rows per query or more than one page per request,
  and counts cost one row, so the same behaviour is expected; a run in a
  larger org would show it.

## Environment of the published runs

- Org: Developer Edition, Lightning Web Security on, data storage 250 MB.
- Browser: Chrome 154 on macOS 27.0.1.
- Machine: Apple M3 Max (Mac15,9), 128 GB of memory.
- Date: September 2026; the 110,000-row lines 8 October 2026.
