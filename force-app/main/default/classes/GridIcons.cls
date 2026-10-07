/**
 * GridIcons — the icon Salesforce shows for an object, as a lightning-icon
 * name: "standard:account", "custom:custom57". The grid shows it beside
 * its title, as a list view does, and a lookup's matches show their object's.
 *
 * WHERE IT COMES FROM
 * An object's icon is its tab's: Schema.describeTabs() lists each tab with its
 * object and its icons' URLs (".../img/icon/t4v35/standard/account_120.png"),
 * and the name is in the URL. An object with no tab has no icon of its own and
 * gets FALLBACK, as it does in Lightning.
 *
 * describeTabs() reads every app's tabs, so it is not free (about 55 ms in a
 * Developer Edition org): it runs once per transaction, cached here, and only
 * when a grid opens (GridController.openGrid; getGridConfig, whose
 * answer the browser caches). Never from the per-row or per-keystroke calls.
 */
public with sharing class GridIcons {
    public static final String FALLBACK = 'standard:record';
    /** An owner field's queues are Groups; Lightning shows them with this icon. */
    public static final String QUEUE = 'standard:queue';

    private static final Pattern ICON_URL = Pattern.compile(
        '/(standard|custom|utility|action)/([a-z0-9_]+?)(?:_\\d+)?\\.(?:png|svg)$'
    );
    /** lower-case object API name → icon; filled on first use. */
    private static Map<String, String> byObject;

    /** The icon for an object; FALLBACK for one with no tab. */
    public static String iconFor(Schema.SObjectType objectType) {
        if (objectType == null) {
            return FALLBACK;
        }
        String icon = icons().get(String.valueOf(objectType).toLowerCase());
        return icon == null ? FALLBACK : icon;
    }

    /**
     * The grid's own icon, and each lookup column's targets' icons, keyed by
     * the target's local name, as GridLookup names a match's object.
     */
    public static void decorate(GridConfig.Definition def) {
        def.objectIcon = iconFor(GridDescribe.typeFor(def.objectApiName));
        for (GridConfig.Column c : def.columns) {
            if (c.referenceTo == null) {
                continue;
            }
            c.referenceIcons = new Map<String, String>();
            for (String target : c.referenceTo) {
                c.referenceIcons.put(target, target == 'Group' ? QUEUE : iconFor(GridDescribe.typeFor(target)));
            }
        }
    }

    /** "standard:account" from ".../standard/account_120.png"; null for anything else. */
    @TestVisible
    private static String fromUrl(String url) {
        if (String.isBlank(url)) {
            return null;
        }
        Matcher m = ICON_URL.matcher(url.trim().toLowerCase().substringBefore('?'));
        return m.find() ? m.group(1) + ':' + m.group(2) : null;
    }

    private static Map<String, String> icons() {
        if (byObject != null) {
            return byObject;
        }
        byObject = new Map<String, String>();
        for (Schema.DescribeTabSetResult app : Schema.describeTabs()) {
            for (Schema.DescribeTabResult tab : app.getTabs()) {
                String objectName = tab.getSobjectName();
                if (String.isBlank(objectName) || byObject.containsKey(objectName.toLowerCase())) {
                    continue;
                }
                for (Schema.DescribeIconResult icon : tab.getIcons()) {
                    String name = fromUrl(icon.getUrl());
                    if (name != null) {
                        byObject.put(objectName.toLowerCase(), name);
                        break;
                    }
                }
            }
        }
        return byObject;
    }
}
