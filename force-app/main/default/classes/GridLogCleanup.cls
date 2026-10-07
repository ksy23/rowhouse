/**
 * GridLogCleanup — the Grid Edit Log's nightly clean-up.
 *
 * Started each night by GridLogSchedule, which GridLogRetention schedules when
 * an admin chooses how long the log keeps its entries. A class that is
 * Queueable may not also be Schedulable ("Queueable cannot be implemented
 * with other system interfaces", measured), hence two classes.
 *
 * EACH STEP
 * Up to slice (4,000) of the oldest entries older than the period are deleted, in
 * user mode (GridSecurity), and then emptied from the Recycle Bin for good, so
 * a night's clean-up never crowds out what people deleted on purpose (a full
 * Recycle Bin loses its oldest records after two hours). A delete and an
 * empty count as two rows each: 4,000 stays under the 10,000 rows a
 * transaction may change. While a full slice was removed, the next step is
 * chained, up to MAX_STEPS a night. Salesforce lets Developer Edition and
 * trial orgs chain only five jobs: when it refuses the next step, the night
 * ends there, its deletions kept, and the rest waits for the next night.
 * An entry that cannot be deleted is skipped from then on, and reported.
 *
 * THE NOTE OF IT
 * When it removed or failed to remove anything, the last step writes one
 * Cleanup entry to the log: what was older than what, and how many went.
 * A night with nothing to remove writes nothing.
 *
 * AS WHOM
 * The admin who saved the setting, in user mode: entries that admin may not
 * delete stay, and are counted as not removed.
 */
public with sharing class GridLogCleanup implements Queueable {
    /** Entries a step deletes; a test makes it small. */
    @TestVisible
    private static Integer slice = 4000;
    @TestVisible
    private static final Integer MAX_STEPS = 50;

    @TestVisible
    private Integer days;
    @TestVisible
    private Datetime cutoff;
    @TestVisible
    private Integer removed = 0;
    @TestVisible
    private Integer notRemoved = 0;
    private String firstProblem;
    private Integer steps = 0;
    private Set<Id> skip = new Set<Id>();
    /** Old entries are left for the next night. */
    private Boolean more = false;
    /** A test's stand-in for Salesforce refusing to chain another step. */
    @TestVisible
    private static Boolean refuseChain = false;

    /** A clean-up of entries older than this many days. */
    public GridLogCleanup(Integer days) {
        this.days = days;
        this.cutoff = days == null ? null : Datetime.now().addDays(-days);
    }

    public void execute(QueueableContext context) {
        if (!step()) {
            return;
        }
        try {
            if (refuseChain) {
                throw new GridException('Maximum stack depth has been reached.');
            }
            if (!Test.isRunningTest()) {
                System.enqueueJob(this); // a test cannot chain jobs; it calls step() again itself
            }
        } catch (Exception e) {
            // Not thrown on: this step's deletions stay, and the rest waits for the next night.
            more = true;
            note();
        }
    }

    /**
     * One step: delete and empty up to a slice of old entries. True when another
     * step should follow; otherwise the note is written and the clean-up ends.
     */
    @TestVisible
    private Boolean step() {
        steps++;
        if (cutoff == null) {
            return false;
        }
        if (!GridLogRetention.canRun()) {
            notRemoved = -1;
            firstProblem = 'the user it runs as cannot delete Grid Edit Log entries';
            note();
            return false;
        }
        List<Id> old = new List<Id>();
        for (
            SObject entry : GridSecurity.query(
                'SELECT Id FROM Grid_Edit_Log__c WHERE CreatedDate < :cutoff AND Id NOT IN :skip ORDER BY CreatedDate LIMIT ' +
                slice,
                new Map<String, Object>{ 'cutoff' => cutoff, 'skip' => skip }
            )
        ) {
            old.add(entry.Id);
        }
        List<Id> deleted = new List<Id>();
        if (!old.isEmpty()) {
            List<Database.DeleteResult> results = GridSecurity.deleteRecords(Grid_Edit_Log__c.SObjectType, old);
            for (Integer i = 0; i < results.size(); i++) {
                if (results[i].isSuccess()) {
                    deleted.add(old[i]);
                } else {
                    skip.add(old[i]);
                    notRemoved++;
                    if (firstProblem == null && !results[i].getErrors().isEmpty()) {
                        firstProblem = results[i].getErrors()[0].getMessage();
                    }
                }
            }
            GridSecurity.purgeDeleted(deleted);
            removed += deleted.size();
        }
        if (old.size() == slice && steps < MAX_STEPS) {
            return true;
        }
        more = old.size() == slice;
        note();
        return false;
    }

    /** One Cleanup entry, when there is something to say. */
    private void note() {
        if (removed == 0 && notRemoved == 0) {
            return;
        }
        String said = removed + (removed == 1 ? ' entry' : ' entries') + ' removed';
        if (notRemoved != 0) {
            said += notRemoved < 0
                ? '; none could be: ' + firstProblem
                : '; ' + notRemoved + ' could not be: ' + firstProblem;
        }
        if (more) {
            said += '; more remain for the next night';
        }
        Grid_Edit_Log__c entry = new Grid_Edit_Log__c(
            Operation__c = GridAudit.OP_CLEANUP,
            Object__c = 'Grid_Edit_Log__c',
            Record_Name__c = ('Entries older than ' +
                GridLogRetention.label(days) +
                ' (before ' +
                cutoff.format('yyyy-MM-dd') +
                ')')
                .left(255),
            New_Value__c = said.left(131072),
            Save_Id__c = EncodingUtil.convertToHex(Crypto.generateAesKey(128))
        );
        try {
            GridSecurity.insertOwnRecords(new List<SObject>{ entry });
        } catch (DmlException e) {
            // The old entries are gone either way; only the note of it could not be written.
            System.debug(LoggingLevel.WARN, 'Grid Edit Log clean-up note not written: ' + e.getMessage());
        }
    }
}
