/**
 * GridCurrency — amounts in an org with more than one currency.
 *
 * In such an org every record has a currency of its own (CurrencyIsoCode),
 * and its amounts are in it. The grid shows each amount with its record's
 * code, as Salesforce does ("USD 78,250.00"), so each row reads its record's
 * CurrencyIsoCode with its fields: for a parent record's field, the parent's.
 *
 * A SOQL aggregate (SUM, AVG, MIN, MAX) of a currency field is in the org's
 * corporate currency, each record converted at the org's rates (SOQL
 * reference, convertCurrency()). So are a grid's Total row, its subtotals
 * and its child totals, and the grid says so: they carry the corporate
 * currency's code.
 *
 * In an org with one currency none of this applies: nothing extra is read,
 * and amounts show in the user's currency, as before.
 */
public with sharing class GridCurrency {
    /** Tests set these: an Apex test cannot turn multiple currencies on. */
    @TestVisible
    private static Boolean multiCurrencyForTest;
    @TestVisible
    private static String corporateForTest;
    @TestVisible
    private static Boolean currencyFieldForTest;

    private static String corporateCache;

    /** Does the org use more than one currency? */
    public static Boolean isMultiCurrency() {
        return multiCurrencyForTest != null ? multiCurrencyForTest : UserInfo.isMultiCurrencyOrganization();
    }

    /**
     * The corporate currency's ISO code, which aggregates are in; null in an
     * org with one currency, or when it cannot be read. Read by name in a
     * dynamic query: CurrencyType exists only in an org with more than one
     * currency, so a static query would not compile anywhere else.
     */
    public static String corporate() {
        if (!isMultiCurrency()) {
            return null;
        }
        if (corporateForTest != null) {
            return corporateForTest;
        }
        if (corporateCache == null) {
            corporateCache = '';
            try {
                List<SObject> rows = GridSecurity.query(
                    'SELECT IsoCode FROM CurrencyType WHERE IsCorporate = true LIMIT 1',
                    new Map<String, Object>()
                );
                if (!rows.isEmpty()) {
                    corporateCache = String.valueOf(rows[0].get('IsoCode'));
                }
            } catch (Exception e) {
                corporateCache = ''; // not readable: the grid then names no currency for a total
            }
        }
        return String.isBlank(corporateCache) ? null : corporateCache;
    }

    /**
     * Each currency column's currency, in an org with more than one: an
     * amount of the row's own record (or of a parent record) is in that
     * record's currency (currencyField: where the row carries the code); a
     * child total is in the corporate currency (currencyCode). Every one's
     * Total row and subtotals are in the corporate currency (totalCurrency).
     */
    public static void describe(Schema.SObjectType objectType, List<GridConfig.Column> columns) {
        if (!isMultiCurrency()) {
            return;
        }
        String corporateCode = corporate();
        for (GridConfig.Column c : columns) {
            if (c.type != 'currency') {
                continue;
            }
            c.totalCurrency = corporateCode;
            if (c.isChildTotal == true) {
                c.currencyCode = corporateCode;
            } else if (c.isFormula == true) {
                // A formula works on the row's own amounts, in its record's currency.
                c.currencyField = hasCurrency(objectType) ? 'CurrencyIsoCode' : null;
                c.currencyCode = c.currencyField == null ? corporateCode : null;
            } else {
                GridPaths.FieldPath fp = GridPaths.resolve(objectType, c.field);
                c.currencyField = hasCurrency(fp.holder) ? isoPathOf(fp) : null;
                c.currencyCode = c.currencyField == null ? corporateCode : null;
            }
        }
    }

    /**
     * Where a row carries the currency of the record that holds a path's
     * field, as a path of local names: 'CurrencyIsoCode' for the grid's own
     * object, 'Account.CurrencyIsoCode' for an Account field on a Contact.
     */
    @TestVisible
    private static String isoPathOf(GridPaths.FieldPath fp) {
        return fp.isPath() ? fp.local.substringBeforeLast('.') + '.CurrencyIsoCode' : 'CurrencyIsoCode';
    }

    /** Do this object's records have a currency of their own? */
    private static Boolean hasCurrency(Schema.SObjectType objectType) {
        if (currencyFieldForTest != null) {
            return currencyFieldForTest;
        }
        return GridDescribe.fieldOrNull(objectType, 'CurrencyIsoCode') != null;
    }

    /** The currency codes the rows must carry: each column's currencyField, once. */
    public static List<String> fieldsToRead(List<GridConfig.Column> columns) {
        List<String> out = new List<String>();
        Set<String> seen = new Set<String>();
        for (GridConfig.Column c : columns) {
            if (c.currencyField != null && seen.add(c.currencyField.toLowerCase())) {
                out.add(c.currencyField);
            }
        }
        return out;
    }
}
