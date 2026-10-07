# Getting help

Rowhouse by Kugamon is free, and so is help: there is no paid tier.

## Before you ask

- Check the open and closed issues on this repository.
- Read the Grid Guide (the Grid Guide tab in the Rowhouse app): its
  troubleshooting questions cover the most common surprises.

## Reporting a bug

Open an issue with:

1. **What you did, what you expected, what happened.** Steps someone else can
   follow.
2. **The org:** edition, release (Setup → Company Information), and whether
   Lightning Web Security is on (Setup → Session Settings).
3. **The browser** and its version.
4. **The grid:** the Grid Configuration's columns and settings, and roughly
   how many rows.
5. **Diagnostic lines, if you can.** Assign the `Rowhouse_Diagnostics`
   permission set to the affected user, reproduce the problem, then copy the
   lines that start with `[rowhouse]` from the browser console. They carry
   timings and counts, never record data.

## Security issues

Do not open a public issue. Use GitHub's private vulnerability reporting on
this repository (Security → Report a vulnerability).
