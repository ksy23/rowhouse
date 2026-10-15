/**
 * DEVELOPMENT ONLY. Never packaged.
 * How long the edit log keeps its entries: saving the period from the
 * Grid Admin tab, the nightly job it schedules, and the clean-up itself. A
 * test cannot deploy metadata, so the deploy is a stand-in that keeps what it
 * was given, and the period the job reads is set here.
 */
@IsTest
private class GridLogRetentionTest {
    private class Kept implements GridAdmin.Deployer {
        public Metadata.DeployContainer container;
        public Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback) {
            this.container = container;
            return UserInfo.getUserId();
        }
    }

    private static Object sentDays(Kept kept) {
        Metadata.CustomMetadata record = (Metadata.CustomMetadata) kept.container.getMetadata()[0];
        System.assertEquals('Rowhouse_Setting__mdt.Default', GridTestUsers.plain(record.fullName));
        for (Metadata.CustomMetadataValue v : record.values) {
            if (GridTestUsers.plain(v.field) == 'Log_Retention_Days__c') {
                return v.value;
            }
        }
        return 'not sent';
    }

    private static List<CronTrigger> jobs() {
        return [
            SELECT Id, NextFireTime, CronExpression
            FROM CronTrigger
            WHERE CronJobDetail.Name = :GridLogRetention.jobName()
        ];
    }

    /** Log entries, the first `old` of them made `daysAgo` days old. */
    private static List<Grid_Edit_Log__c> entries(Integer count, Integer old, Integer daysAgo) {
        List<Grid_Edit_Log__c> out = new List<Grid_Edit_Log__c>();
        for (Integer i = 0; i < count; i++) {
            out.add(
                new Grid_Edit_Log__c(
                    Operation__c = 'update',
                    Grid_Configuration__c = 'Consignments',
                    Object__c = 'Consignment__c',
                    Record_Name__c = 'Kennebec Lumber, ' + (i + 10) + ' bundles',
                    Field__c = 'Consignee__c'
                )
            );
        }
        insert out;
        for (Integer i = 0; i < old; i++) {
            Test.setCreatedDate(out[i].Id, Datetime.now().addDays(-daysAgo));
        }
        return out;
    }

    private static Integer kept(String operation) {
        return [SELECT COUNT() FROM Grid_Edit_Log__c WHERE Operation__c = :operation];
    }

    @IsTest
    static void periodsReadInPlainWords() {
        System.assertEquals('Forever', GridLogRetention.label(null));
        System.assertEquals('90 days', GridLogRetention.label(90));
        System.assertEquals('1 year', GridLogRetention.label(365));
        System.assertEquals('2 years', GridLogRetention.label(730));
        System.assertEquals('7 years', GridLogRetention.label(2555));
        System.assert(
            GridLogRetention.offered(null) && GridLogRetention.offered(2555),
            'Forever and 7 years are offered.'
        );
        System.assert(!GridLogRetention.offered(30), '30 days is not offered.');
    }

    @IsTest
    static void savingAPeriodDeploysTheSettingAndSchedulesTheNightlyJob() {
        System.runAs(GridTestUsers.adminUser()) {
            Kept kept = new Kept();
            GridAdmin.deployWith = kept;
            Test.startTest();
            String jobId = GridAdminController.saveLogRetention(365);
            System.assertNotEquals(null, jobId, 'The deployment\'s Id comes back, for saveStatus.');
            System.assertEquals(365, sentDays(kept));
            List<CronTrigger> scheduled = jobs();
            System.assertEquals(1, scheduled.size(), 'One nightly job.');
            System.assertEquals(GridLogRetention.CRON, scheduled[0].CronExpression);
            System.assertNotEquals(null, scheduled[0].NextFireTime);

            // Saving again keeps one job, not two.
            GridAdminController.saveLogRetention(90);
            System.assertEquals(1, jobs().size(), 'Still one nightly job.');

            // Forever removes it.
            GridAdminController.saveLogRetention(null);
            System.assertEquals(null, sentDays(kept), 'Forever saves a blank period.');
            System.assertEquals(0, jobs().size(), 'Forever removes the nightly job.');
            Test.stopTest();
        }
    }

    @IsTest
    static void onlyTheOfferedPeriodsAreSaved() {
        System.runAs(GridTestUsers.adminUser()) {
            Kept kept = new Kept();
            GridAdmin.deployWith = kept;
            try {
                GridAdmin.saveLogRetention(30);
                System.assert(false, 'A period the tab does not offer is refused.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('90 days, 1 year, 2 years or 7 years'), e.getMessage());
            }
            System.assertEquals(null, kept.container, 'Nothing was deployed.');
            System.assertEquals(0, jobs().size(), 'Nothing was scheduled.');
        }
    }

    @IsTest
    static void anAdminWithoutCustomizeApplicationCannotSaveIt() {
        System.runAs(GridTestUsers.adminViewer()) {
            Kept kept = new Kept();
            GridAdmin.deployWith = kept;
            try {
                GridAdmin.saveLogRetention(365);
                System.assert(false, 'Saving needs Customize Application.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Customize Application'), e.getMessage());
            }
            System.assertEquals(null, kept.container, 'Nothing was deployed.');
        }
    }

    @IsTest
    static void aGridUserCannotSeeOrSaveIt() {
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridLogRetention.status();
                System.assert(false, 'The status is for Rowhouse Grid Admin.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
            try {
                GridAdmin.saveLogRetention(90);
                System.assert(false, 'Saving is for Rowhouse Grid Admin.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
        }
    }

    @IsTest
    static void theCleanUpRemovesOnlyOldEntriesAndNotesWhatItRemoved() {
        System.runAs(GridTestUsers.adminUser()) {
            List<Grid_Edit_Log__c> all = entries(5, 3, 400);
            GridLogCleanup cleanup = new GridLogCleanup(365);
            Test.startTest();
            System.assertEquals(false, cleanup.step(), 'Fewer than a slice: one step does it.');
            Test.stopTest();
            System.assertEquals(3, cleanup.removed);
            System.assertEquals(0, cleanup.notRemoved);
            Set<Id> left = new Map<Id, Grid_Edit_Log__c>(
                    [SELECT Id FROM Grid_Edit_Log__c WHERE Operation__c = 'update']
                )
                .keySet();
            System.assertEquals(new Set<Id>{ all[3].Id, all[4].Id }, left, 'Only the entries newer than a year stay.');
            Grid_Edit_Log__c note = [
                SELECT Record_Name__c, New_Value__c, Object__c
                FROM Grid_Edit_Log__c
                WHERE Operation__c = 'cleanup'
            ];
            System.assertEquals('3 entries removed', note.New_Value__c);
            System.assert(note.Record_Name__c.startsWith('Entries older than 1 year (before '), note.Record_Name__c);
            System.assertEquals('Grid_Edit_Log__c', note.Object__c);
        }
    }

    @IsTest
    static void aNightWithNothingToRemoveWritesNothing() {
        System.runAs(GridTestUsers.adminUser()) {
            entries(2, 0, 0);
            GridLogCleanup cleanup = new GridLogCleanup(90);
            System.assertEquals(false, cleanup.step());
            System.assertEquals(0, cleanup.removed);
            System.assertEquals(0, kept('cleanup'), 'No note when nothing was removed.');
            System.assertEquals(2, kept('update'));
        }
    }

    @IsTest
    static void aFullSliceIsFollowedByAnotherStepUntilNoneAreLeft() {
        System.runAs(GridTestUsers.adminUser()) {
            entries(6, 5, 100);
            GridLogCleanup.slice = 2;
            GridLogCleanup cleanup = new GridLogCleanup(90);
            System.assertEquals(true, cleanup.step(), 'A full slice: another step follows.');
            System.assertEquals(true, cleanup.step());
            System.assertEquals(false, cleanup.step(), 'One left: the last step.');
            System.assertEquals(5, cleanup.removed);
            System.assertEquals(1, kept('update'), 'The new entry stays.');
            System.assertEquals(
                '5 entries removed',
                [SELECT New_Value__c FROM Grid_Edit_Log__c WHERE Operation__c = 'cleanup'].New_Value__c,
                'One note for the whole night, from the last step.'
            );
        }
    }

    @IsTest
    static void whenSalesforceRefusesTheNextStepTheNightKeepsWhatItRemoved() {
        System.runAs(GridTestUsers.adminUser()) {
            entries(5, 4, 100);
            GridLogCleanup.slice = 2;
            GridLogCleanup.refuseChain = true; // as a Developer Edition org does after five jobs
            GridLogCleanup cleanup = new GridLogCleanup(90);
            cleanup.execute(null);
            System.assertEquals(2, cleanup.removed);
            System.assertEquals(3, kept('update'), 'Two old entries went; the other two wait for the next night.');
            System.assertEquals(
                '2 entries removed; more remain for the next night',
                [SELECT New_Value__c FROM Grid_Edit_Log__c WHERE Operation__c = 'cleanup'].New_Value__c
            );
        }
    }

    @IsTest
    static void aUserWhoCannotDeleteEntriesRemovesNoneAndSaysSo() {
        System.runAs(GridTestUsers.adminUser()) {
            entries(2, 2, 400);
        }
        // Rowhouse Grid Admin, on a Standard User who may not delete the log's entries.
        System.runAs(GridTestUsers.adminViewer()) {
            GridLogCleanup cleanup = new GridLogCleanup(365);
            System.assertEquals(false, cleanup.step());
            System.assertEquals(0, cleanup.removed);
        }
        System.runAs(GridTestUsers.adminUser()) {
            System.assertEquals(2, kept('update'), 'Nothing was removed.');
            Grid_Edit_Log__c note = [SELECT New_Value__c FROM Grid_Edit_Log__c WHERE Operation__c = 'cleanup'];
            System.assert(note.New_Value__c.contains('none could be'), note.New_Value__c);
        }
    }

    @IsTest
    static void anAdminWhoLostRowhouseGridAdminDeletesNothingAndSaysSo() {
        System.runAs(GridTestUsers.adminUser()) {
            entries(2, 2, 400);
        }
        // The job runs as whoever saved the period; this user no longer holds Rowhouse Grid Admin.
        System.runAs(GridTestUsers.fullUser()) {
            GridLogCleanup cleanup = new GridLogCleanup(365);
            System.assertEquals(false, cleanup.step(), 'One step: it stops at once.');
            System.assertEquals(0, cleanup.removed);
        }
        System.runAs(GridTestUsers.adminUser()) {
            System.assertEquals(2, kept('update'), 'Nothing was removed.');
            Grid_Edit_Log__c note = [SELECT New_Value__c FROM Grid_Edit_Log__c WHERE Operation__c = 'cleanup'];
            System.assertEquals(GridLogCleanup.NOT_AN_ADMIN, note.New_Value__c);
        }
    }

    @IsTest
    static void theNightlyJobStopsItselfWhenTheLogIsKeptForever() {
        System.runAs(GridTestUsers.adminUser()) {
            GridLogRetention.useTestDays = true;
            GridLogRetention.testDays = null;
            Test.startTest();
            System.schedule(GridLogRetention.jobName(), GridLogRetention.CRON, new GridLogSchedule());
            Test.stopTest(); // runs the scheduled job
            System.assertEquals(0, jobs().size(), 'Kept forever: the job removed itself.');
        }
    }

    /** The nightly job's context, as the scheduler hands it over. */
    private class Night implements System.SchedulableContext {
        public Id getTriggerId() {
            return null;
        }
    }

    @IsTest
    static void theNightlyJobStartsTheCleanUpForAPeriod() {
        System.runAs(GridTestUsers.adminUser()) {
            entries(3, 2, 100);
            GridLogRetention.useTestDays = true;
            GridLogRetention.testDays = 90;
            Test.startTest();
            new GridLogSchedule().execute(new Night()); // as the scheduler runs it at 2 AM
            Test.stopTest(); // runs the clean-up it started
            System.assertEquals(1, kept('update'), 'The two old entries were removed.');
            System.assertEquals(
                '2 entries removed',
                [SELECT New_Value__c FROM Grid_Edit_Log__c WHERE Operation__c = 'cleanup'].New_Value__c
            );
        }
    }

    @IsTest
    static void anotherAdminSeesTheJobAndThatItIsNotTheirs() {
        System.runAs(GridTestUsers.adminUser()) {
            GridLogRetention.schedule(365);
        }
        System.runAs(GridTestUsers.adminViewer()) {
            GridLogRetention.useTestDays = true;
            GridLogRetention.testDays = 365;
            Map<String, Object> s = GridLogRetention.status();
            System.assertEquals(true, s.get('scheduled'), 'Another Rowhouse Grid Admin sees the nightly job.');
            System.assertEquals(false, s.get('mine'), 'It runs as the admin who saved, not as them.');
        }
    }

    @IsTest
    static void theStatusSaysWhatIsSetWhenItRunsAndWhatItLastRemoved() {
        System.runAs(GridTestUsers.adminUser()) {
            GridLogRetention.useTestDays = true;
            GridLogRetention.testDays = 365;
            Map<String, Object> before = GridLogRetention.status();
            System.assertEquals('1 year', before.get('label'));
            System.assertEquals(false, before.get('scheduled'));
            System.assertEquals(5, ((List<Object>) before.get('options')).size(), 'Forever and four periods.');
            System.assertEquals(true, before.get('canSave'));
            System.assertEquals(true, before.get('canRun'));
            List<String> logging = (List<String>) before.get('loggingGrids');
            System.assert(logging.contains('Consignment Audit'), 'The grids that log every change: ' + logging);
            System.assert(!logging.contains('Consignments'), 'Consignments does not log.');

            GridLogRetention.schedule(365);
            entries(1, 1, 400);
            new GridLogCleanup(365).step();
            Map<String, Object> after = GridLogRetention.status();
            System.assertEquals(true, after.get('scheduled'));
            System.assertNotEquals(null, after.get('nextRun'));
            System.assertEquals([SELECT Name FROM User WHERE Id = :UserInfo.getUserId()].Name, after.get('runsAs'));
            System.assertEquals(true, after.get('mine'), 'The job runs as the admin reading the status.');
            Map<String, Object> last = (Map<String, Object>) after.get('lastCleanup');
            System.assertEquals('1 entry removed', last.get('summary'));
        }
    }
}
