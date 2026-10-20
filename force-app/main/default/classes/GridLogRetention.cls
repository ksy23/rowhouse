/**
 * GridLogRetention — how long the Grid Edit Log keeps its entries.
 *
 * THE SETTING
 * The Rowhouse Setting record named Default, Log Retention (days): blank keeps
 * every entry forever, which is how Rowhouse starts. The Grid Admin tab offers
 * 90, 365, 730 and 2555 days (7 years) and saves the record as it saves a
 * grid: a deploy (GridAdmin.saveLogRetention).
 *
 * THE NIGHTLY CLEAN-UP
 * Saving a period also schedules GridLogSchedule, every night at 2 AM in the
 * admin's time zone, under one job name; saving Forever removes the job.
 * Scheduled by Rowhouse's own code, so no admin schedules Apex by hand (HR-1
 * leaves nothing global to schedule). The job runs as the admin who saved, in
 * user mode (HR-8), so it deletes only entries that admin may delete; a System
 * Administrator may delete them all. A grid user may not delete entries,
 * which is why nothing starts the clean-up from a grid.
 *
 * Each night GridLogSchedule wakes this class by name (execute, below) rather
 * than naming it in code, so a scheduled clean-up does not stop Rowhouse
 * being updated: see GridLogSchedule.
 */
public with sharing class GridLogRetention implements Schedulable {
    public static final String JOB_NAME = 'Rowhouse: Grid Edit Log clean-up';

    /**
     * The job's name. A test names its job apart, so Apex tests never meet,
     * move or remove the org's real nightly job, whether it is on or not.
     */
    public static String jobName() {
        return Test.isRunningTest() ? JOB_NAME + ' (test)' : JOB_NAME;
    }
    /** Every day at 2 AM, in the time zone of the user who scheduled it. */
    public static final String CRON = '0 0 2 * * ?';
    /** The Rowhouse Setting record Rowhouse reads. */
    public static final String SETTING = 'Default';
    /** The periods the Grid Admin tab offers, in days; blank is forever. */
    public static final List<Integer> CHOICES = new List<Integer>{ 90, 365, 730, 2555 };

    @TestVisible
    private static Boolean useTestDays = false;
    @TestVisible
    private static Integer testDays;

    /**
     * The days entries are kept, or null to keep them forever. Setup takes any
     * number, but 0 or less would delete every entry each night: it keeps them
     * forever instead, as blank does (the audit log fails closed).
     */
    public static Integer days() {
        Integer n;
        if (useTestDays) {
            n = testDays;
        } else {
            Rowhouse_Setting__mdt setting = Rowhouse_Setting__mdt.getInstance(SETTING);
            n = setting == null ||
                setting.Log_Retention_Days__c == null
                ? null
                : setting.Log_Retention_Days__c.intValue();
        }
        return n == null || n < 1 ? null : n;
    }

    /** Is this a period the Grid Admin tab offers? Blank (forever) is. */
    public static Boolean offered(Integer days) {
        return days == null || CHOICES.contains(days);
    }

    /** How a period reads: Forever, 90 days, 1 year, 2 years, 7 years. */
    public static String label(Integer days) {
        if (days == null) {
            return 'Forever';
        }
        if (Math.mod(days, 365) == 0) {
            Integer years = days / 365;
            return years + (years == 1 ? ' year' : ' years');
        }
        return days + (days == 1 ? ' day' : ' days');
    }

    /** May the running user run the clean-up: delete entries, and write the note of what it removed? */
    public static Boolean canRun() {
        return GridSecurity.canDelete(Grid_Edit_Log__c.SObjectType) &&
            GridSecurity.canCreate(Grid_Edit_Log__c.SObjectType);
    }

    // ---------------------------------------------------------------- the job

    /** The scheduled jobs of this name, newest first. Normally one. */
    private static List<CronTrigger> jobs() {
        return (List<CronTrigger>) GridSecurity.query(
            'SELECT Id, NextFireTime, PreviousFireTime, State, CreatedById, CreatedBy.Name FROM CronTrigger ' +
            'WHERE CronJobDetail.Name = :name ORDER BY CreatedDate DESC',
            new Map<String, Object>{ 'name' => jobName() }
        );
    }

    /**
     * One nightly job for a period, none for forever: any job of this name is
     * removed first, so saving again moves the job to the user saving.
     */
    public static void schedule(Integer days) {
        for (CronTrigger job : jobs()) {
            System.abortJob(job.Id);
        }
        if (days != null) {
            System.schedule(jobName(), CRON, new GridLogSchedule());
        }
    }

    /**
     * The night's work, when GridLogSchedule wakes this class: read the
     * period again; forever removes the job, a period starts the clean-up.
     */
    public void execute(SchedulableContext context) {
        Integer days = days();
        if (days == null) {
            System.abortJob(context.getTriggerId());
            return;
        }
        System.enqueueJob(new GridLogCleanup(days));
    }

    /** The titles of the grids that log every change, A to Z: what the clean-up affects. An archived grid writes nothing. */
    public static List<String> loggingGrids() {
        List<String> out = new List<String>();
        for (Grid_Configuration__mdt cfg : Grid_Configuration__mdt.getAll().values()) {
            if (cfg.Log_Changes__c == true && cfg.Archived__c != true) {
                out.add(cfg.MasterLabel);
            }
        }
        out.sort();
        return out;
    }

    // ---------------------------------------------------------------- status

    /**
     * What the Grid Admin tab shows: { days, label, options, canSave, canRun,
     * scheduled, nextRun, lastRun, runsAs, mine, loggingGrids, lastCleanup:
     * { when, summary } }.
     */
    public static Map<String, Object> status() {
        GridAdmin.requireAdmin();
        Integer days = days();
        List<Map<String, Object>> options = new List<Map<String, Object>>{
            new Map<String, Object>{ 'value' => '', 'label' => label(null) }
        };
        // A period set in Setup that the tab does not offer is listed too, in
        // its place, so the box shows what the clean-up uses.
        List<Integer> periods = new List<Integer>(CHOICES);
        if (!offered(days)) {
            periods.add(days);
            periods.sort();
        }
        for (Integer d : periods) {
            options.add(new Map<String, Object>{ 'value' => String.valueOf(d), 'label' => label(d) });
        }
        Map<String, Object> out = new Map<String, Object>{
            'days' => days,
            'label' => label(days),
            'options' => options,
            'canSave' => GridAdmin.canSave(),
            'canRun' => canRun(),
            'scheduled' => false
        };
        List<CronTrigger> scheduled = jobs();
        if (!scheduled.isEmpty()) {
            CronTrigger job = scheduled[0];
            out.put('scheduled', true);
            out.put('nextRun', job.NextFireTime);
            out.put('lastRun', job.PreviousFireTime);
            out.put('runsAs', job.CreatedBy == null ? null : job.CreatedBy.Name);
            // Saving again moves the job to whoever saves: the tab offers it when the job is someone else's.
            out.put('mine', job.CreatedById == UserInfo.getUserId());
        }
        out.put('loggingGrids', loggingGrids());
        List<Grid_Edit_Log__c> notes = (List<Grid_Edit_Log__c>) GridSecurity.query(
            'SELECT CreatedDate, Record_Name__c, New_Value__c FROM Grid_Edit_Log__c WHERE Operation__c = :op ' +
            'ORDER BY CreatedDate DESC LIMIT 1',
            new Map<String, Object>{ 'op' => GridEditLog.OP_CLEANUP }
        );
        if (!notes.isEmpty()) {
            out.put(
                'lastCleanup',
                new Map<String, Object>{ 'when' => notes[0].CreatedDate, 'summary' => notes[0].New_Value__c }
            );
        }
        return out;
    }
}
