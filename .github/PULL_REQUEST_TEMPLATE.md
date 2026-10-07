## What this changes

<!-- One to three sentences. Link the issue: "Fixes #123". -->

## Why this way

<!-- The platform behavior you measured, and why you chose this approach over
the others, with its cost. -->

## Checklist

- [ ] `npm run verify` passes (formatting, hard-rule checks, ESLint, SLDS Linter, Jest).
- [ ] The Apex tests pass in a Salesforce org (`RunLocalTests`).
- [ ] New behavior has a test that fails without it.
- [ ] Access tests run as a restricted user, never as an admin.
- [ ] Anything a user or admin can see is updated in the Grid Guide (`guide/pages`, then `npm run guide`), and its steps were followed word for word in an org.
- [ ] No hard rule is broken. If one should change, that is argued in an issue first.
- [ ] Every commit is signed off (`git commit -s`).

## Screenshots

<!-- Before and after, for any visible change. Delete if none. -->
