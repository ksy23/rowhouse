/**
 * DEVELOPMENT ONLY. Never packaged.
 * GridCurrency — amounts in an org with more than one currency.
 *
 * An Apex test cannot turn multiple currencies on, and the development org
 * has one currency, so the multi-currency answers are checked with the
 * class's test settings (more than one currency, a corporate currency, every
 * object with a currency). What a real multi-currency org reads is checked
 * live there.
 */
@IsTest
private class GridCurrencyTest {
    static final Schema.SObjectType TEST_RECORD = Consignment__c.SObjectType;

    static GridConfig.Column column(String field, String type) {
        GridConfig.Column c = new GridConfig.Column();
        c.field = field;
        c.type = type;
        return c;
    }

    static void manyCurrencies(String corporate) {
        GridCurrency.multiCurrencyForTest = true;
        GridCurrency.corporateForTest = corporate;
        GridCurrency.currencyFieldForTest = true;
    }

    @IsTest
    static void oneCurrencyLeavesColumnsAsTheyWere() {
        GridCurrency.multiCurrencyForTest = false;
        List<GridConfig.Column> columns = new List<GridConfig.Column>{ column('Freight_Charge__c', 'currency') };
        GridCurrency.describe(TEST_RECORD, columns);
        System.assertEquals(null, columns[0].currencyField);
        System.assertEquals(null, columns[0].currencyCode);
        System.assertEquals(null, columns[0].totalCurrency);
        System.assertEquals(null, GridCurrency.corporate(), 'No corporate currency to name in an org with one.');
        System.assert(GridCurrency.fieldsToRead(columns).isEmpty(), 'Nothing extra is read.');
    }

    @IsTest
    static void eachAmountIsInItsRecordsCurrencyAndEachTotalInTheCorporateOne() {
        manyCurrencies('USD');
        GridConfig.Column own = column('Freight_Charge__c', 'currency');
        GridConfig.Column parent = column('Shipper__r.AnnualRevenue', 'currency');
        GridConfig.Column formula = column('_fx_Doubled', 'currency');
        formula.isFormula = true;
        GridConfig.Column childTotal = column('_ct_Total', 'currency');
        childTotal.isChildTotal = true;
        GridConfig.Column numeric = column('Pieces__c', 'number');
        List<GridConfig.Column> columns = new List<GridConfig.Column>{ own, parent, formula, childTotal, numeric };

        GridCurrency.describe(TEST_RECORD, columns);

        System.assertEquals('CurrencyIsoCode', own.currencyField);
        System.assertEquals(null, own.currencyCode);
        System.assertEquals('USD', own.totalCurrency);
        System.assertEquals(
            'Shipper__r.CurrencyIsoCode',
            parent.currencyField,
            'A parent record’s amount is in the parent’s currency.'
        );
        System.assertEquals('CurrencyIsoCode', formula.currencyField, 'A formula works on the row’s own amounts.');
        System.assertEquals(null, childTotal.currencyField);
        System.assertEquals('USD', childTotal.currencyCode, 'A child total is an aggregate: corporate currency.');
        System.assertEquals('USD', childTotal.totalCurrency);
        System.assertEquals(null, numeric.currencyField, 'Only currency columns.');
        System.assertEquals(null, numeric.totalCurrency);

        System.assertEquals(
            new List<String>{ 'CurrencyIsoCode', 'Shipper__r.CurrencyIsoCode' },
            GridCurrency.fieldsToRead(columns),
            'Each currency once.'
        );
    }

    @IsTest
    static void anObjectWithoutACurrencyHasItsAmountsInTheCorporateOne() {
        manyCurrencies('EUR');
        GridCurrency.currencyFieldForTest = false;
        GridConfig.Column own = column('Freight_Charge__c', 'currency');
        GridCurrency.describe(TEST_RECORD, new List<GridConfig.Column>{ own });
        System.assertEquals(null, own.currencyField);
        System.assertEquals('EUR', own.currencyCode);
        System.assertEquals('EUR', own.totalCurrency);
    }

    @IsTest
    static void aCorporateCurrencyThatCannotBeReadIsNone() {
        // More than one currency, but CurrencyType is not there to read (this
        // org has one currency): the grid then names no currency for a total.
        GridCurrency.multiCurrencyForTest = true;
        System.assertEquals(null, GridCurrency.corporate());
        GridConfig.Column own = column('Freight_Charge__c', 'currency');
        GridCurrency.currencyFieldForTest = true;
        GridCurrency.describe(TEST_RECORD, new List<GridConfig.Column>{ own });
        System.assertEquals(null, own.totalCurrency);
        System.assertEquals('CurrencyIsoCode', own.currencyField);
    }

    @IsTest
    static void forUserDescribesTheGridsCurrencyColumnsForARestrictedUser() {
        manyCurrencies('USD');
        GridConfig.Definition def;
        System.runAs(GridTestUsers.fullUser()) {
            def = GridConfig.forUser('Consignments');
        }
        Boolean found = false;
        for (GridConfig.Column c : def.columns) {
            if (c.type == 'currency' && c.isChildTotal != true) {
                found = true;
                System.assertEquals('USD', c.totalCurrency, c.field);
                System.assertNotEquals(null, c.currencyField, c.field);
            } else if (c.type != 'currency') {
                System.assertEquals(null, c.currencyField, c.field);
            }
        }
        System.assert(found, 'Consignments has a currency column.');
    }

    @IsTest
    static void theRealOrgHasOneCurrency() {
        // The development org: nothing changes, and the rows read nothing extra.
        GridConfig.Definition def;
        System.runAs(GridTestUsers.fullUser()) {
            def = GridConfig.forUser('Consignments');
        }
        System.assertEquals(UserInfo.isMultiCurrencyOrganization(), GridCurrency.isMultiCurrency());
        if (!UserInfo.isMultiCurrencyOrganization()) {
            System.assert(GridCurrency.fieldsToRead(def.columns).isEmpty());
        }
    }
}
