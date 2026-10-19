# Changelog

Each release is a version of the Rowhouse Grid managed package (namespace
`rowhouse`). Install or upgrade from its links; an upgrade keeps your grids.

## Unreleased

- **Export to Excel.** Export is a menu: **Excel (.xlsx)** writes the grid as
  it looks (numbers, amounts, percents and dates with their formats, the
  columns you see at their widths, frozen and wrapped columns, display rules'
  fills, text colors and bold, and, in a grouped grid, a heading and a
  subtotal row for each group and a Total row, as formulas Excel's outline
  folds); **CSV** writes the values, as before. The Grid Configuration
  setting is now labelled **Allow Export**.
- **Import** reads a number Excel shows as a percent (12.5% is 0.125 in the
  file) into a percent field as 12.5.
- **Fixed:** a layout change (a hidden column, a new sort) made just before
  the page was reloaded or closed was lost. It is now kept as the page goes,
  and held in the browser until Salesforce has it.

## 1.1 — Winter 2027 (15 October 2026)

The version to install. It upgrades 1.0 in place and keeps your grids.

- **Package version:** 1.1.0.1, ID `04tUK000000TU7ZYAW`
- **Install:**
  [production or Developer Edition](https://login.salesforce.com/packaging/installPackage.apexp?p0=04tUK000000TU7ZYAW)
  ·
  [sandbox](https://test.salesforce.com/packaging/installPackage.apexp?p0=04tUK000000TU7ZYAW)
  · `sf package install --package 04tUK000000TU7ZYAW --target-org <your org> --wait 20`
- **License:** the GNU Affero General Public License v3.0 (AGPL-3.0). See
  NOTICE.

## 1.0 — Winter 2027 (15 October 2026)

The first release, package version 1.0.0.2. Replaced by 1.1: install 1.1
instead.

What it includes is in the README's [What it does](README.md#what-it-does):
inline editing with every common field type, spreadsheet keys, undo and redo;
sort, search, filters, grouping with subtotals, charts and child tables;
formula columns and display rules; bulk update and delete, CSV and Excel
import and CSV export; flow and quick actions; each user's own layout; the
Grid Admin tab, an optional audit trail and the Grid Guide; Lightning Web
Security and Lightning Locker; up to 100,000 rows.

Not yet: an AppExchange listing (it follows Salesforce's security review), so
upgrades are installed from each version's link rather than pushed.
