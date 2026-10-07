# dev/

Development-only metadata. **Nothing here is packaged**: `dev` is a package
directory with no package, and the hard-rule checks scan `force-app` only.
Each component's description starts with `DEVELOPMENT ONLY.` (see
CONTRIBUTING.md).

- `lwc/rowhouseDevHost`: places `gridApp` on a Lightning tab with the
  `Test_Records` configuration, or the one named in the URL
  (`/lightning/n/Rowhouse_Dev?c__grid=Bench_20`), which is how the benchmark
  switches grids. `gridApp` can be placed on App, Record and Home pages (HR-2),
  but a Lightning component tab needs the `lightning__Tab`
  target, which `gridApp` does not have. The grid is placed once the URL has
  been read, so a URL naming another grid opens only that one.
- `tabs/Rowhouse_Dev`: the tab for that host.
- `flexipages/Rowhouse_Grid_Test` and `tabs/Rowhouse_Grid_Test`: an App Page
  with `gridApp` placed the way an admin places it, through Lightning App
  Builder, with its one setting.
- `flexipages/Rowhouse_Account_Test`: an Account record page with the
  `Account_Contacts` grid on it, for the record page tests. It is not
  activated; activate it in Lightning App Builder to use it.
- `permissionsets/Rowhouse_Dev_Tabs` (Rowhouse Dev — Tabs): the two dev tabs, for the
  admin who builds and demos Rowhouse by Kugamon. It gives no field access, which comes from
  `test-data/metadata/permissionsets/Rowhouse_Test_Full`, assigned alongside;
  that is also what the Apex suite's `fullUser()` holds.
