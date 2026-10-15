/**
 * The one exception Rowhouse throws on purpose.
 *
 * HR-1: it is public, not global, so subscribers cannot catch it by type — they
 * catch bare Exception. That makes the MESSAGE the only diagnostic they get, so
 * every throw site names the object, field or record it is about.
 *
 * messageFor() is what the grid and the Grid Admin tab show for any failure:
 * a GridException's own words, which are written for the user; anything else
 * as a plain sentence, since the platform's own text can name fields and
 * classes. Users with Rowhouse Grid Diagnostics also get the platform's
 * text, to report it.
 */
public with sharing class GridException extends Exception {
    /** The custom permission that shows troubleshooting detail: the Rowhouse Grid Diagnostics permission set's. */
    public static final String DIAGNOSTICS = 'Rowhouse_Grid_Diagnostics';

    /** What a user is told when something fails that Rowhouse did not expect. */
    public static final String UNEXPECTED = 'Something went wrong. Try again, and if it keeps happening, ask your Salesforce admin.';

    /** What to show for a failure: see the header. */
    public static String messageFor(Exception e) {
        if (e instanceof GridException) {
            return e.getMessage();
        }
        return GridSecurity.hasCustomPermission(DIAGNOSTICS)
            ? UNEXPECTED + ' (' + e.getTypeName() + ': ' + e.getMessage() + ')'
            : UNEXPECTED;
    }
}
