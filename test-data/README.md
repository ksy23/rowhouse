# Rowhouse by Kugamon test data

Everything needed to stand up a test org and run the test suites.

```
./scripts/seed.sh                 # scratch org + metadata + 56 seed records + limited user
./scripts/seed.sh --benchmark     # the above, plus the 50,000 benchmark rows
./scripts/seed.sh --target my-org # use an existing org instead of creating one
```

## What's here

| Path | What it is |
|---|---|
| `data/Rowhouse_Test_Record__c.csv` | 56 records, one per edge case. Generated — edit the generator, not the CSV. |
| `data/benchmark-to-{1,5,10,50}k.csv` | The published-benchmark rows, in four steps (rows 1-1,000, 1,001-5,000, 5,001-10,000, 10,001-50,000). Generated on demand; not committed. |
| `bench/` | `RowhouseBenchData`, which inserts the same benchmark rows from Anonymous Apex, and `run-benchmark.js`, the browser-console runner. |
| `actions/` | What the grid actions' tests run: the autolaunched flow `Rowhouse_Test_Action_Flow`, the screen flow `Rowhouse_Test_Screen_Flow` and the Apex action `RowhouseTestAction`. The flow and the Apex action fail on a record named "Fail me", for the error paths. |
| `metadata/objects/` | Two test-only objects carrying every field type the grid must render, and `Rowhouse_Bench__c`, which holds only the benchmark rows. `Rowhouse_Test_Record__c` allows activities, so the Log a call test action relates its Task to the row. |
| `metadata/permissionsets/` | `Rowhouse_Test_Limited`, deliberately restricted access that the FLS tests depend on, and `Rowhouse_Test_Full`, every test field, held by the user the other tests run as. |
| `config/` | Sample grid configuration as Custom Metadata (configurations, columns and format rules), plus the scratch-org and test-user definitions. `Test_Records` allows mass delete and `Save_Test` does not; the delete tests rely on both. `Test_Records` and `Security_Test` allow import and `Save_Test` does not; the import tests rely on all three. `Group_Test` opens grouped by Stage, then Date by quarter, and carries one column for each kind of subtotal, plus two settings that cannot work (a group level on a number, a sum of a checkbox) so the warnings are tested. Child tables: `Test_Records` opens a Children tab (`Test_Children`, on `Rowhouse_Test_Child__c`); `Nest_Accounts` opens Test Records and Contacts tabs (`Nest_Contacts`), so Accounts reach three levels; `Group_Test` carries three Grid Child Table links that cannot work (no child configuration, a field that is not a reference, a field that points at another object) so their warnings are tested. Actions: `Test_Records` offers a screen flow, an autolaunched flow, invocable Apex (selection only, with its own question), a quick action (row only) and one that needs `Rowhouse_Diagnostics`; `Group_Test` carries three Grid Actions that cannot work (no type, another object's quick action, a name that is not an API name). Audit trail: `Audit_Test` sets Log Changes, on `Rowhouse_Test_Record__c` with six editable columns, mass delete, import and one action (`Audit_Test_Mark_Seen`, the autolaunched flow); `Save_Test` does not log, and the tests rely on both. Grouping: `Group_Test_Text` and `Group_Test_Number` set Allow Grouping (the number to test the warning). Child tables: `Nest_Accounts` has two child total columns, `Nest_Accounts_Contact_Count` (a count of Contacts) and `Nest_Accounts_Records_Amount` (a sum of Currency_Field__c), and its Contacts tab is 250 pixels high. Import and lookups: `Import_Test` allows inline edit, export, mass delete and import, with `External_Key__c` (an External Id, to match records by) and `Filtered_Account__c` (Direct Customer, a lookup filtered to accounts of Type Customer - Direct). Archived: `Test_Archived`, on `Rowhouse_Test_Child__c` with Log Changes set, is archived, so it is refused, not offered as a child table and not in the clean-up's list; the tests rely on it staying archived. |
| `tests/jest/` | Six Jest suites — focus, keyboard, ARIA, reactivity, cell rendering, CSV export. |
| `tests/jest/fixtures/seed.js` | Generated from the CSV so the fixtures and the org data cannot drift. |
| `tests/apex/` | Seventeen Apex test classes — security, chunked save, save finalizer, controller, configuration, describe normalisation, cursor paging, lookup search, object icons, format rules, mass delete, import, grouping and subtotals, child tables, grid actions, the audit trail, the benchmark data — and `GridTestUsers`, which builds the users they run as, including one without Rowhouse Grid User, who cannot write the audit log (`noLogUser`). |
| `scripts/` | The generators and the loader, and `cmdt-to-apex.py`, which turns configuration records into anonymous Apex that deploys them, for an org reached without the sf CLI. |

## The seed set is self-documenting

Every record carries `Test_Case__c` (what it breaks) and `Expected__c` (what
correct looks like). A failing test quotes the TC number, so you never have to
read the generator to find out what went wrong.

```
TC-001..003   null vs empty string vs zero
TC-004..011   whitespace, leading zeros, commas, quotes, newlines, length limits
TC-012..016   emoji, right-to-left, CJK width, combining marks, zero-width
TC-017..021   XSS, CSV formula injection, quote handling in search   ← security
TC-022..026   negatives, precision, 18-digit values, percent semantics
TC-027..034   Date vs DateTime, both DST transitions, leap day, range edges
TC-035..041   orphaned picklist values, dependent pairings, multi-select
TC-042..046   checkbox, email, phone, URL, javascript: scheme           ← security
TC-047..048   two records, identical content, distinct Ids
TC-049..054   collation and null ordering
TC-055..056   long text at its limit, and every field populated at once
```

Five of these deserve calling out, because they are the ones that reach
production in real grids:

- **TC-036** stores a picklist value that is no longer in the active value set.
  This is normal in any org more than a year old. Blanking it is data loss.
- **TC-019 / TC-020** are CSV formula injection. A value beginning `=` `+` `-`
  or `@` executes when the export is opened in Excel, and `=HYPERLINK` can send
  cell contents to an external URL. This is an exfiltration vector, not a
  formatting nit.
- **TC-046** is a `javascript:` URL in a URL field. It must never render as a
  clickable link.
- **TC-047 / TC-048** are byte-identical in every displayed field. If row keys
  derive from content rather than Id they collide, and after a sort an edit
  lands on the wrong record.
- **TC-027 / TC-028** are a Date on 1 January and 31 December. A Date has no
  timezone; if either shifts a day for a user in another offset, the code is
  treating it as a DateTime.

## Two things to check before trusting a run

**Log in as the limited user, not as yourself.** `seed.sh` creates a Standard
User with `Rowhouse_Test_Limited`, under which `Read_Only_Text__c` and
`Decimal_Field__c` are readable but not editable, and **fifteen fields are
invisible entirely**. A System Administrator sees everything, so every access
test passes vacuously. This is the most common way an FLS suite ends up
worthless.

The Apex suite does not use this user — it creates its own inside `@TestSetup`,
because package version creation runs the tests in a fresh build org where
`seed.sh` never ran. This one exists for the manual and browser tiers.

**Confirm TC-036 kept the value `Obsolete`.** `Picklist_Field__c` is
deliberately unrestricted so the value can be loaded. If it arrives blank, the
picklist was created restricted and the most common real-org edge case is
untestable.

## Known load caveats

Three records do not survive the CSV path, and each needs building in Apex
instead. Worth knowing before trusting a green run.

**TC-002 (empty string versus null) collapses.** The Bulk API turns `""` into
null on load, and `build-jest-fixture.py` does the same for the fixture — so
TC-001 and TC-002 become the same record. The distinction is real and worth
testing; it just cannot come through a CSV. Only the hardcoded assertion in
`gridCellTypes.rendering.test.js` covers it today.

**TC-023 (precision overflow) cannot arrive overflowed.** `Decimal_Field__c` is
scale 2, so `1234.567` is rounded to `1234.57` by the platform before the grid
ever sees it. The stated expectation — showing one value while saving another —
needs an Apex-constructed record, as `GridSaveServiceTest` does with
`Percent_Field__c`.

**TC-038 may not load as written.** It stores a dependent picklist value that
does not belong to its controlling value, which is exactly the state real orgs
end up in after a value set is reorganised — but whether the Bulk API enforces
the field dependency on insert was not confirmed from documentation. If the row
arrives with `Dependent_Picklist__c` blank, create it by removing the dependency,
loading, then reinstating the dependency.

## The benchmark rows are deterministic

Fixed seed, so anyone who clones the repo reproduces the same rows.

Design choices worth knowing:

- **Their own object.** The rows go into `Rowhouse_Bench__c`, not the edge-case
  object, so none of the 56 deliberately pathological records (a 32,000
  character text value, emoji, right-to-left text) enters a timing, and the
  10,000-row step stays exactly at the grid's 10,000-row ceiling.
- **A step past the ceiling.** The last step takes the object to 50,000 rows.
  There the grid loads the first 10,000 and sorts and searches on the server,
  and that mode is measured too.
- **Twenty columns.** Fourteen generated fields plus Name, and five formula
  fields (read-only, as formula columns are in a real org), for the
  "5 and 20 columns" the protocol measures.
- **The distribution is skewed, not uniform.** 70% short text values, 25%
  medium, 5% long; Email, Phone, Multi-Picklist and Dependent-Picklist are
  blank 45%, 60%, 75% and 33% of the time, about 15% of all cells. Uniform
  data makes a grid look faster than it is, because column widths stabilise
  on the first render and the measurement path never runs again.
- **The sizes nest.** Row N is the same row however the data is made, so rows
  1 to 1,000 of the 50k set *are* the 1k set, and the measurements are one
  curve rather than unrelated samples.
- **Two ways in, identical rows.** `scripts/generate-benchmark.py` writes CSV
  for the Bulk API; `bench/classes/RowhouseBenchData.cls` inserts the same rows
  from Anonymous Apex, for an org reached without the Salesforce CLI. Both use
  one Park-Miller random stream with a fixed number of draws per row, and
  golden rows are asserted in both languages
  (`scripts/test_generate_benchmark.py`, `tests/apex/RowhouseBenchDataTest`).

Regenerate the four step files with `python3 scripts/generate-benchmark.py`,
or any slice with `python3 scripts/generate-benchmark.py 2001 2500`.

## Regenerating

```bash
python3 scripts/generate-seed.py           # the 56 edge cases
python3 scripts/build-jest-fixture.py      # then always this — keeps fixtures in sync
python3 scripts/generate-benchmark.py      # rows 1-1k, 1k-5k, 5k-10k, 10k-50k
```

`build-jest-fixture.py` is not optional after changing the seed. The Jest
fixture is generated from the CSV precisely so the two cannot diverge, and a
suite passing against stale fixtures while the org data has moved on is worse
than no suite at all.
