# Spreadsheet feel

Ranges, copy, paste, fill-down, undo and redo of unsaved edits, and frozen
columns: how they behave, and why.

Everything here works on **drafts**. Nothing is saved until Save, exactly as
with typing into a cell, so every one of these actions can be undone, and
Cancel throws all of it away.

## Keyboard

Navigation mode only (in an open editor, the keys belong to the editor, so
Cmd+Z there undoes typing inside the box, as in any text field).
"Cmd" is Ctrl on Windows and Linux.

| Keys | Does |
| --- | --- |
| Shift+Arrow, Shift+Home/End, Shift+PageUp/PageDown, Cmd+Shift+Home/End | Extend the range from where it started |
| Shift+click | Extend the range to the clicked cell |
| Any move without Shift, or Escape | Back to a single cell |
| Cmd+C | Copy the range (or the cell) |
| Cmd+V | Paste into the range (or from the cell) |
| Cmd+D | Fill down: the range's top row into the rows below it; for one cell, the cell above into it |
| Delete, Backspace | Clear the editable cells in the range |
| Cmd+Z | Undo the last change |
| Cmd+Shift+Z, Ctrl+Y | Redo |

These are the keys Excel and Google Sheets use, so nobody has to learn them.
Undo and Redo are also buttons in the grid's Save bar, for mouse users and so
the feature can be found at all.

## How it behaves

**A range is a rectangle of view positions, and sorting clears it.**
Rows are identified by record, but a range is what the user sees: rows 3 to 7
of the current order. After a sort those records are no longer next to each
other, so the range is cleared rather than silently becoming a different set
of cells. Header cells and the row-status and selection columns are never in a
range. A range also ends when focus reaches another cell some other way than
extending it: Tab back into the grid, a screen reader moving focus, a script.
The next Shift+Arrow then starts a new range from where focus is, not from a
corner left behind earlier.

**Copy writes tab-separated text, the format every spreadsheet pastes.**
- Numbers are written plain (no grouping, no currency symbol), rounded to the
  field's scale as displayed, so Excel and Sheets read them as numbers
  in any locale. Dates are ISO (2026-09-29), which both read as dates in any
  locale. Checkboxes are TRUE or FALSE. Picklists are their labels, as shown.
  Date/time values are copied as displayed.
- **Formula neutralisation applies to copy as it does to CSV export**
  (the same `neutralise` function). A value beginning with `= + - @` pasted
  into Excel runs as a formula, so it is copied with a leading apostrophe,
  which spreadsheets treat as "this is text". Pasting such a value back into
  Rowhouse by Kugamon removes that one apostrophe again, so a copy within the grid
  round-trips exactly.
- Values containing a tab, a line break or a double quote are quoted the way
  Excel quotes them, so multi-line text stays in one cell.

**Clipboard events are bound on the grid's own root element.**
Under Lightning Web Security, clipboard listeners on `document` or the shadow
root never run; a listener on the component's own root element does, and the
`paste` event's `clipboardData` is readable there with no permission prompt.
`navigator.clipboard.readText()` is not usable for Cmd+V (Firefox and Safari
do not support it; Chrome prompts). So:
- Copy uses the `copy` event and `clipboardData.setData`. If the browser sends
  that event somewhere the grid cannot hear it, the keydown handler falls back
  to `navigator.clipboard.writeText`, which Lightning Web Security does not
  distort.
- Paste uses the `paste` event only.

**Paste follows Excel's rules.**
- One value into a range fills the range. A block into a range whose size is a
  whole multiple of the block's repeats the block. Otherwise the block is
  pasted once from the range's top-left cell.
- Cells past the last row or column are dropped; read-only cells (formulas,
  fields the user cannot edit, columns the admin did not make editable) are
  skipped. Both are counted and announced, never silent.
- Each value is read by the column's type. A value that cannot be read (text
  in a number column, a picklist value that does not exist) marks that cell
  with an error and leaves the cell unchanged; the rest of the paste goes in.
- At most 10,000 cells per paste, the grid's row ceiling. Larger pastes are
  refused with a message, not truncated.

**Undo covers unsaved edits only, and one action is one step.**
A paste of 500 cells is one undo step, as is a fill-down. History lives with
the drafts (`c/gridHistory`, plain data like `gridEditState`) and keeps the
last 100 steps. Save clears it (saved values are the record's now; undoing
them would need another save), and so does Cancel.

**Frozen columns are an admin setting.**
`Grid_Configuration.Frozen_Columns__c`: how many columns, from the left, stay
in place while the grid scrolls sideways. The row-status and selection
columns stay with them. Frozen cells are `position: sticky` with a `left`
offset from the pinned column widths, so the first render with frozen columns
pins the widths (as a resize does). Cards ignore the setting.

## Accessibility

- Cells in a multi-cell range carry `aria-selected="true"`, and the grid
  carries `aria-multiselectable="true"` because cells can be multi-selected.
  Cells outside the range carry no `aria-selected` at all, because
  `aria-selected="false"` on every cell makes several screen readers say
  "not selected" on every move.
- Every action announces its result through the grid's live region:
  "3 rows by 2 columns selected", "Copied 6 cells", "Pasted 12 cells. 2
  read-only cells skipped.", "Filled down 4 cells", "Undid paste of 12 cells".

## Where it lives

| Piece | Module |
| --- | --- |
| TSV in and out, reading a pasted value by column type | `c/gridClipboard` (plain functions) |
| Range state, keys, clipboard events, frozen offsets | `c/gridTable` |
| Undo and redo stacks | `c/gridHistory` (plain data) |
| Applying multi-cell changes, Undo and Redo | `c/gridView` |
| `Frozen_Columns__c` | `Grid_Configuration__mdt`, read by `GridConfig` |
