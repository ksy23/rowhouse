/**
 * DEVELOPMENT ONLY. Never packaged.
 * GridIcons: an object's icon from its tab's icon URL.
 */
@IsTest
private class GridIconsTest {

    @IsTest
    static void readsTheIconNameFromItsUrl() {
        System.assertEquals('standard:account', GridIcons.fromUrl('https://x.my.salesforce.com/img/icon/t4v35/standard/account_120.png'));
        System.assertEquals('standard:account', GridIcons.fromUrl('/img/icon/t4v35/standard/account.svg'));
        System.assertEquals('custom:custom57', GridIcons.fromUrl('https://x/img/icon/t4v35/custom/custom57_120.png'));
        System.assertEquals('standard:work_order', GridIcons.fromUrl('/img/icon/t4v35/standard/work_order_60.png?v=2'));
        System.assertEquals(null, GridIcons.fromUrl('https://x/img/icon/tab/other.gif'));
        System.assertEquals(null, GridIcons.fromUrl(''));
        System.assertEquals(null, GridIcons.fromUrl(null));
    }

    @IsTest
    static void noObjectGetsTheRecordIcon() {
        System.assertEquals(GridIcons.FALLBACK, GridIcons.iconFor(null));
    }

    @IsTest
    static void aTabbedObjectGetsAnIconName() {
        String icon = GridIcons.iconFor(Account.SObjectType);
        System.assert(Pattern.matches('(standard|custom):[a-z0-9_]+', icon), icon);
    }
}
