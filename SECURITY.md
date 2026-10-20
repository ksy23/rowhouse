# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately, in any of these
ways:

1. **GitHub:** this repository's **Security** tab → **Report a
   vulnerability**.
2. **Email:** [support@kugamon.com](mailto:support@kugamon.com), with a
   subject that starts with `[SECURITY]`.
3. **Kugamon support:** [Submit a Case](https://www.kugamon.com/support/submit-a-case/)
   and say it is a security report.

Please include:

- what an attacker could do, and to whose data;
- the steps to reproduce it, as short as you can make them;
- the Rowhouse version (Setup → Installed Packages), the Salesforce edition,
  and whether Lightning Web Security is on (Setup → Session Settings).

We will confirm that we have your report, work with you to understand and fix
the problem, and agree with you when it is disclosed. We credit reporters in
the release notes unless you would rather stay anonymous.

## Supported versions

Security fixes go into the latest released version of the managed package.
To get them, install or upgrade from that version's link in
[CHANGELOG.md](CHANGELOG.md); an upgrade keeps your grids. The latest version
is 1.2, Winter 2027.

## How Rowhouse protects data

- **Everything runs as the user.** Every read and write runs in user mode,
  through Salesforce's own object, field and sharing security. Every Apex
  class is `with sharing`; there is no system-mode path.
- **One place decides access.** Every object and field check goes through a
  single class, `GridSecurity`, so a reviewer can read one file to see them
  all. An automated check fails the build if any other class makes one.
- **The browser is never trusted.** The server checks each save, delete,
  import and action again against the grid's configuration and the user's
  permissions, whatever the page sends.
- **Nothing leaves the org.** No callouts, no outside services, and no
  third-party code: every line of JavaScript and Apex in the package is
  Rowhouse's own.
- **Access is granted, not assumed.** Users need the **Rowhouse Grid User**
  permission set. Building grids on the Grid Admin tab needs **Rowhouse Grid
  Admin** as well, and Customize Application.
- **Diagnostics carry no record data.** The optional diagnostic lines hold
  timings and counts only.
- **Exports are safe to open.** CSV exports and copied cells neutralize
  values that a spreadsheet would run as a formula.

## How the code is checked

- **Salesforce Code Analyzer** runs on every push with the AppExchange and
  security rules, and the build fails on any finding. A finding that is not a
  real problem is suppressed as narrowly as possible, with the reason, in
  [`code-analyzer.yml`](code-analyzer.yml). Its path-based field-security
  check (Graph Engine) runs on each release.
- **The project's hard rules** (for example: no `global` Apex, no callouts,
  every access check through `GridSecurity`) are enforced by automated checks
  on every push; [CONTRIBUTING.md](CONTRIBUTING.md) lists them.
- **Access tests run as a restricted user**, not as an administrator, so a
  missing object, field or sharing check fails a test.
- **Dependencies** are watched by Dependabot. None of them ships in the
  package: they are the build and test tools.
