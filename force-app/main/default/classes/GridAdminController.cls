/**
 * GridAdminController — what the Grid Admin tab and the grid's gear call.
 * Only the Rowhouse Grid Admin permission set grants access to this
 * class; every method checks the Rowhouse_Admin custom permission again
 * (GridAdmin.requireAdmin), and saving also needs Customize Application.
 *
 * public, not global (HR-1). A draft travels as JSON, so the page and the
 * server share one shape (GridAdmin.Draft).
 */
public with sharing class GridAdminController {
    /** Every grid configuration, by label. */
    @AuraEnabled
    public static List<Map<String, Object>> listConfigs() {
        try {
            return GridAdmin.listConfigs();
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** One configuration as a draft: { draft, warnings, canSave }. */
    @AuraEnabled
    public static Map<String, Object> readConfig(String configName) {
        try {
            return GridAdmin.readConfig(configName);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** May the running user save? For the page to say so before anyone edits. */
    @AuraEnabled
    public static Boolean canSave() {
        try {
            GridAdmin.requireAdmin();
            return GridAdmin.canSave();
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** The objects a grid can show. */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> listObjects() {
        try {
            return GridAdmin.listObjects();
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** An object's fields and possible child tables. */
    @AuraEnabled
    public static Map<String, Object> describeObject(String objectApiName) {
        try {
            return GridAdmin.describeObject(objectApiName);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Check a draft without saving it: { errors, warnings }. */
    @AuraEnabled
    public static GridAdmin.Check checkDraft(String draftJson) {
        try {
            return GridAdmin.check(parse(draftJson));
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Save a draft: returns the deployment's Id, for saveStatus. */
    @AuraEnabled
    public static String saveDraft(String draftJson) {
        try {
            return GridAdmin.save(parse(draftJson));
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** How a save is going: { status: 'pending' | 'Succeeded' | 'Failed', messages }. */
    @AuraEnabled
    public static Map<String, Object> saveStatus(String jobId) {
        try {
            return GridAdmin.saveStatus(jobId);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** How long the edit log keeps its entries, and the nightly clean-up. */
    @AuraEnabled
    public static Map<String, Object> logRetention() {
        try {
            return GridLogRetention.status();
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Save the edit log's retention in days, blank for forever: returns the deployment's Id, for saveStatus. */
    @AuraEnabled
    public static String saveLogRetention(Integer days) {
        try {
            return GridAdmin.saveLogRetention(days);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Archive a grid, or restore it: returns the deployment's Id, for saveStatus. */
    @AuraEnabled
    public static String archiveConfig(String configName, Boolean archived) {
        try {
            return GridAdmin.setArchived(configName, archived);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Clone a grid with a new title and API name: returns the deployment's Id, for saveStatus. */
    @AuraEnabled
    public static String cloneConfig(String sourceName, String label, String name) {
        try {
            return GridAdmin.cloneConfig(sourceName, label, name);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** The records to delete in Setup to delete a grid for good, in order, with their Setup pages. */
    @AuraEnabled
    public static List<Map<String, String>> setupRecords(String configName) {
        try {
            return GridAdmin.setupRecords(configName);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    private static GridAdmin.Draft parse(String draftJson) {
        if (String.isBlank(draftJson)) {
            throw new GridException('There is nothing to save.');
        }
        return (GridAdmin.Draft) JSON.deserialize(draftJson, GridAdmin.Draft.class);
    }

    /**
     * Subscribers catch bare Exception (HR-1), so the message is the
     * diagnostic: a GridException's own words; anything else in a plain
     * sentence, with the platform's text only for Rowhouse Grid Diagnostics
     * users, which Rowhouse Grid Admin includes (GridException.messageFor).
     */
    private static AuraHandledException auraError(Exception e) {
        String message = GridException.messageFor(e);
        AuraHandledException wrapped = new AuraHandledException(message);
        wrapped.setMessage(message);
        return wrapped;
    }
}
