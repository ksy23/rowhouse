# Contributing to Rowhouse

Rowhouse by Kugamon is a free, open-source data grid for Salesforce. Contributions are
welcome: bug reports, fixes, tests, documentation and features on the roadmap.
This page covers how to set up, what every change must pass, and the
twenty-nine hard rules the project is built on.

## Before you start

- **Open an issue first** for anything larger than a small fix, so the
  approach can be agreed before you spend time on it.
- **Sign off every commit** with the Developer Certificate of Origin
  (`git commit -s`). The sign-off says you wrote the change or have the right
  to submit it under the project's licence, the Mozilla Public License 2.0.
  There is no CLA.
- **Read the hard rules below.** A pull request that breaks one is not merged,
  whatever the feature. If a rule is wrong, argue it in an issue: rules change
  here, deliberately, never around it in code.

## How this project runs

- **Bug reports are welcome at any time.** Each one is triaged before it
  becomes work: a real defect, or a question about setting a grid up? Setup
  questions get an answer and, where the Grid Guide fell short, a better
  guide page.
- **Wrong data comes first.** A bug that silently saves or shows the wrong
  value jumps the queue, however rare: a user who sees an error can report
  it, but nobody reports a wrong value they never noticed.
- **Small, focused pull requests.** One fix or one feature each, with its
  tests, and no unrelated changes.
- **Every pull request is reviewed** against the checklist in the pull
  request template and the hard rules below.

## Set up

Two commands, and no Salesforce org needed:

```bash
npm ci --legacy-peer-deps
npm run verify
```

`npm run verify` runs every check CI runs, in the same order:

1. the static-check self-test (each check must be seen to fail on a planted
   violation, or it proves nothing);
2. the hard-rule checks in `scripts/checks/run-all.js`;
3. the formatting check (Prettier);
4. ESLint, including the custom rules in `eslint-rules/`;
5. SLDS Linter;
6. Jest, including the accessibility assertions.

`npm ci` also installs a pre-commit hook that formats the files you commit
with Prettier, so formatting never comes up in review. `npm run format`
formats everything. Formatting Apex uses a parser that comes built for
Windows (x64), Linux (x64) and macOS; anywhere else it needs Java 17 or
later. Metadata XML is left as Salesforce writes it, and component templates
(`.html`) as you write them: the LWC compiler drops whitespace that contains a
line break, so keep words and the inline tag beside them on one line.

The Apex tests run in a Salesforce org. Every test builds the users and rows it
needs (`test-data/tests/apex/GridTestUsers.cls`), so the suite does not depend
on who runs it or on seed data. `test-data/README.md` explains how to stand up
an org with the test objects.

## What a change must include

- **Tests alongside the code.** New behaviour comes with a test that fails
  without it. Fix the code, not the test, unless the test is wrong, and then
  say why in the pull request.
- **Access tests run as a restricted user**, never as an admin. An admin sees
  every field, so an access test run as an admin passes while proving nothing.
- **Findings and choices explained.** Say in the pull request what platform
  behaviour you measured, and why you chose one approach over another, with
  the cost.
- **The Grid Guide kept true.** A change someone can see goes into the guide's
  pages (`guide/pages`), then `npm run guide` rebuilds them as components; a
  built page that differs from its source fails `run-all.js`. Every step the
  change touches is then followed word for word in a Salesforce org before the
  pull request is opened.
- **Development-only components say so.** Nothing under `test-data/` or `dev/`
  is packaged. Every component there that has a description
  starts it with `DEVELOPMENT ONLY.`, and every Apex class there starts its
  header comment with it, so nobody mistakes it for part of Rowhouse by Kugamon in an
  org's Setup (`python3 scripts/mark-dev-only.py` adds the words;
  `run-all.js` fails without them). A component nobody needs any more is
  deleted rather than left behind.

## Naming

Salesforce fixes most of these:

| What | Style | Example |
| --- | --- | --- |
| Apex classes | PascalCase | `GridSaveService` |
| Lightning web component folders | camelCase (must start lowercase) | `gridTable` |
| The class inside a component | PascalCase | `class GridTable` |
| Components in markup | kebab-case with a namespace | `<c-grid-table>` |
| Rowhouse by Kugamon CSS classes | `rh-` prefix, kebab-case | `rh-wrap-text` |
| Custom objects and fields | Salesforce API names | `Grid_Column__mdt.Wrap_Text__c` |

## The hard rules

Every rule has a reason and an enforcement mechanism. Where a machine can check
it, a machine does.

### Permanence

**HR-1. No `global` Apex, ever: no global classes, methods, interfaces, enums, variables, properties or exceptions, and no `webservice` members.**  
Retractability. A managed package can hard-delete any Apex class it ships except a global one, which stays in every subscriber org until the package dies. A package with zero global Apex can take back anything it ships.  
*Enforced by:* `scripts/checks/run-all.js`.

**HR-2. One exposed grid component, `gridApp`, with exactly two `@api` members: `configName`, the name of its Grid Configuration, and `recordId`, which Lightning sets on a record page. `rowhouseAdmin` is exposed too, with no `@api` member, only so it can be the Grid Admin tab, and so is `rowhouseFlow`, with no `@api` member, only so Lightning can open it as the page a screen-flow action runs on, and `rowhouseGuide`, with no `@api` member, only so it can be the Grid Guide tab. Every other component `isExposed=false`.**  
An exposed component's `@api` properties can never be removed, even ones added after the last release. Twenty scalar props is twenty permanent commitments; one text setting is one. Everything else an admin controls lives in the configuration, which is data, not API. `rowhouseFlow` is a URL-addressable page so that Salesforce's flow engine stays out of every grid's first load.  
*Enforced by:* `run-all.js`.

**HR-3. Every admin-editable Custom Metadata field is *Subscriber-controlled*.**  
Developer-controlled means an upgrade silently overwrites the customer's configuration. Manageability cannot be changed after release.  
*Enforced by:* `run-all.js`, against `scripts/checks/cmdt-admin-editable.json`.

**HR-4. Normalise `getGlobalDescribe()` through `getLocalName()`, always.**  
The same code returns `rowhouse__X__c` in the managed build and `X__c` in the unlocked one. The sharpest correctness hazard in the dual build.  
*Enforced by:* `GridDescribeTest` (in both builds once the managed build exists).


### Security

**HR-5. Every FLS and CRUD decision goes through `GridSecurity`. Nowhere else.**  
One auditable choke point is the only way to defend a dynamic-SOQL package in security review.  
*Enforced by:* `run-all.js`.

**HR-6. Never trust the client payload — server-side allow-list from describe.**  
Deserialization lets a caller populate fields the grid never rendered, so `stripInaccessible` must sanitize *all* populated fields, not the rendered ones.  
*Enforced by:* `GridSecurityTest.saveRejectsAnEditableFieldThatIsNotInTheColumnSet`.

**HR-7. No DML in a loop.**  
Drops the row ceiling from 10,000 to 150, and is the most common way a grid save breaks.  
*Enforced by:* `GridSaveServiceTest` (counts DML statements and queued jobs).

**HR-8. Apex pinned at API 67.0+; never `WITH SECURITY_ENFORCED`.**  
User mode by default. The old clause no longer compiles, so any pre-2026 sample or generated code fails the build — which is the point.  
*Enforced by:* `run-all.js`, and the compiler.

**HR-9. No callouts, ever.**  
Zero external services is both the architecture and the claim. One callout makes both false.  
*Enforced by:* `run-all.js`; `GridDataServiceTest.makesNoCallouts`.


### Accessibility

**HR-10. `aria-rowindex` on every row including headers, or on none — never partial. With `aria-rowcount`, using `-1` while the total is unknown.**  
The APG's warning is unusually strong: inconsistent values "could have devastating effects on assistive technology behavior… could cause screen reader table reading functions to skip rows or simply stop functioning." `-1` is explicitly sanctioned for an unknown total.  
*Enforced by:* `gridTable.aria.test.js`, `gridTable.windowing.test.js`.

**HR-11. Every cell is focusable or contains a focusable element.**  
APG: "In a grid, every cell contains a focusable element or is itself focusable." Screen readers are in application mode inside a grid and announce only focusable elements. The sole exception is a header with no sort or filter action.  
*Enforced by:* `gridTable.aria.test.js`.

**HR-12. Apply `slds-has-focus` in JavaScript on every focus move.**  
SLDS sets `outline: 0` on both `th:focus` and `[role="gridcell"]:focus` and replaces the ring with an inset shadow on that class. Forget it and focused cells have **no visible focus indicator at all**.  
*Enforced by:* `gridKeyboard.focus.test.js`.

**HR-13. Focus state lives outside the row components and is restored after every render.**  
Reordering a keyed `for:each` can unmount and remount a row, destroying focus — filed by LWC's own maintainer, who notes a fix "would be an observable change, so could break consumers." Sorting a column must not silently lose the focused cell.  
*Enforced by:* `gridKeyboard.focus.test.js` (focus follows the record through a sort).

**HR-14. `aria-sort="none"` for sortable-but-unsorted, and a direction on at most one column.**  
`lightning-datatable` emits `'other'` here; correctness beats bug-compatibility. ARIA cannot express multiple sort keys, so multi-column sort is not fully representable.  
*Enforced by:* `gridTable.aria.test.js`.

**HR-15. SLDS class names only. Never `--` BEM, never override `.slds-*`, never `--slds-c-*` component hooks.**  
SLDS Linter runs in CI with Error-severity rules as build failures. Component-level hooks are unsupported in SLDS 2, where Salesforce's own advice is to stay on SLDS 1 if you use them.  
*Enforced by:* SLDS Linter (`npm run lint:slds`, Error severity) and `run-all.js`.

**HR-16. Copy SLDS markup from the design-system Jest snapshots, never from blog posts.**  
The widely-cited recipes are wrong in specifics: `slds-is-error` does not exist (it is `slds-has-error` and `slds-cell-error`), the sortable header is an `<a role="button">` not a `<button>`, and the edit pencil carries no `slds-button_icon-bare`.  
*Enforced by:* Review.


### Reactivity and rendering

**HR-17. Never clone an array or object inside an `@api` setter. Assign the reference; normalise in a getter or upstream.**  
Cloning in the setter is the exact shape of an open LWC defect: the parent mutates, the reference never changes, the setter never fires, the child never updates. A core maintainer called it counter-intuitive behaviour rather than a bug, so no fix is coming.  
*Enforced by:* ESLint `rowhouse/no-clone-in-api-setter`; `gridTable.reactivity.test.js`.

**HR-18. No `@track` on the row array. Reassign a new reference instead.**  
`@track` routes every object you touch through an observable-membrane Proxy; a plain field uses a bare getter and setter with no proxy. On ten thousand rows that is the cheapest optimisation available — and Lightning Web Security multiplies proxy cost, becoming "observable" in the tens of thousands.  
*Enforced by:* ESLint `rowhouse/no-track-on-collections`.

**HR-19. Row keys are stable, record-derived and opaque. Never the index.**  
Documented constraint, and in debug builds the renderer *throws* on mismatched vnodes — so unstable keys fail loudly in a scratch org rather than quietly in production.  
*Enforced by:* `scripts/checks/templates.js`; `gridTable.reactivity.test.js`.

**HR-20. Never write reactive state in `renderedCallback`.**  
Rerender is queued as a microtask, so writing reactive state there can loop forever. Measurements go to a non-reactive object; layout writes go through `requestAnimationFrame` — which is how Salesforce's own virtualizer does it.  
*Enforced by:* ESLint `rowhouse/no-reactive-write-in-rendered-callback`.

**HR-21. Never call `querySelectorAll` per row; cap it per render pass.**  
A genuine pincer: `lwc:ref` is a compile error inside `for:each` (`LWC1158`), and `querySelectorAll` on large trees leaks under Lightning Locker with, in Salesforce's words, no workaround other than enabling LWS — which is the subscriber's decision, not ours.  
*Enforced by:* ESLint `rowhouse/no-queryselector-in-loop`.

**HR-22. No `<slot>` as an immediate child of `<table>`, `<thead>`, `<tbody>` or `<tr>`.**  
The parser silently hoists it out of the table. Open since 2018. Columns are projected by iterating a config array, never by slotting.  
*Enforced by:* `scripts/checks/templates.js`.

**HR-23. Assume Lightning Locker, not LWS. Feature-detect both observers with a scroll fallback.**  
`ResizeObserver` and `IntersectionObserver` appear nowhere in the Locker bundle, and Salesforce's own `lightning/resizeObserver` ships exactly this fallback. LWS is default only for orgs created in Winter '23 or later, cannot be enabled per component, and a package cannot force it.  
Locker also has no `BigInt`, so exact decimal sums are done on digit strings.  
*Enforced by:* Jest (the window-resize fallback); `scripts/checks/run-all.js` (no `BigInt` in components); a test org with Lightning Web Security off.

**HR-24. Never pass `<html>`, `<head>` or `<body>` as an observer target or as `IntersectionObserver`'s `root`.**  
LWS throws `LockerSecurityError` on shared elements. Observe our own scroll container, or omit `root` entirely. Observing our own subtree is otherwise undistorted.  
*Enforced by:* ESLint `rowhouse/no-shared-element-observer`.

**HR-25. No keyboard layer as a cross-namespace mixin — a plain module or our own base class.**  
Locker's support for extending mixins is very limited and works only if the mixin touches neither DOM nor events, which is precisely what a keyboard layer does.  
*Enforced by:* `run-all.js`.


### Product

**HR-26. No third-party JavaScript.**  
**A values and maintainability choice, not a platform requirement.** Static-resource bundling is explicitly sanctioned by Salesforce; only remote CDN loading is forbidden. Claiming this rule is a platform requirement would be false. What is true: Salesforce's list of libraries known to work under LWS has three entries and none is a grid, and Locker blocks libraries that scan the DOM broadly — which is what every virtualizing grid does.  
*Enforced by:* `run-all.js`.

**HR-27. Nothing in the cell editors (`lwc/cell*`) imports from the table.**  
Enforced by a check, not convention. It is what lets the editors be consumed without the table. (Lightning web components cannot be nested in folders, so each editor is its own `cell*` component and the check covers all of them.)  
*Enforced by:* `run-all.js`.

**HR-28. Plain objects and arrays across every component boundary.**  
No class instances, no functions in event payloads. LWS proxies cross-namespace data and silently swallows mutations on anything that is not a plain object, array or typed array.  
*Enforced by:* Review.

**HR-29. No paid tier, no feature gates, no in-product upsell.**  
The rule that makes "free, not freemium" sayable. The moment a Pro tier exists, that sentence is gone for good.  
*Enforced by:* The licence terms and governance, not code.

## Reporting a security issue

Do not open a public issue. [SECURITY.md](SECURITY.md) explains how to report
it privately.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
