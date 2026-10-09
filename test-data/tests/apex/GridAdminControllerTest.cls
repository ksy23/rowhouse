/**
 * DEVELOPMENT ONLY. Never packaged.
 * The Grid Admin tab's entry points. Each one hands its request to GridAdmin
 * (tested in GridAdminTest) or GridLogRetention, so these tests check what the
 * controller itself adds: every method reaches its service with the page's
 * arguments, a draft arrives as JSON, and every failure reaches the page as an
 * AuraHandledException with a readable message. A test cannot deploy
 * metadata, so the deploy is a stand-in that keeps what it was given.
 */
@IsTest
private class GridAdminControllerTest {
    private class Kept implements GridAdmin.Deployer {
        public Integer deploys = 0;
        public Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback) {
            deploys++;
            return UserInfo.getUserId(); // any Id: the page only hands it back
        }
    }

    @IsTest
    static void everyReadReachesItsService() {
        System.runAs(GridTestUsers.adminUser()) {
            Boolean listed = false;
            for (Map<String, Object> c : GridAdminController.listConfigs()) {
                if (c.get('name') == 'Test_Records')
                    listed = true;
            }
            System.assert(listed, 'Test_Records is listed.');

            Map<String, Object> read = GridAdminController.readConfig('Test_Records');
            System.assertEquals('Test_Records', ((GridAdmin.Draft) read.get('draft')).config.name);
            System.assertEquals(true, GridAdminController.canSave(), 'A System Administrator may save.');

            Boolean offered = false;
            for (Map<String, String> o : GridAdminController.listObjects()) {
                if (o.get('name') == 'Rowhouse_Test_Record__c')
                    offered = true;
            }
            System.assert(offered, 'The test object is offered.');
            System.assert(
                GridAdminController.describeObject('Rowhouse_Test_Record__c').containsKey('fields'),
                'An object is described with its fields.'
            );

            GridAdmin.Check result = GridAdminController.checkDraft(JSON.serialize(read.get('draft')));
            System.assertEquals(new List<String>(), result.errors, 'The grid as it is checks clean.');

            System.assertEquals('pending', GridAdminController.saveStatus('0Afhk0000000003').get('status'));
            System.assert(GridAdminController.logRetention() != null, 'The log retention status is returned.');
            System.assert(!GridAdminController.setupRecords('Test_Children').isEmpty(), 'Setup lists its records.');
        }
    }

    @IsTest
    static void everyWriteDeploysThroughGridAdmin() {
        System.runAs(GridTestUsers.adminUser()) {
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            String draftJson = JSON.serialize(GridAdminController.readConfig('Test_Records').get('draft'));

            System.assertEquals(String.valueOf(UserInfo.getUserId()), GridAdminController.saveDraft(draftJson));
            System.assertNotEquals(null, GridAdminController.archiveConfig('Test_Records', true));
            System.assertNotEquals(
                null,
                GridAdminController.cloneConfig('Nest_Accounts', 'Copy of Nest Accounts', 'Copy_of_Nest_Accounts')
            );
            System.assertEquals(3, spy.deploys, 'Save, archive and clone each deploy once.');
        }
    }

    @IsTest
    static void aRefusalReachesThePageWithItsOwnWords() {
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridAdminController.listConfigs();
                System.assert(false, 'Rowhouse Grid User alone may not use the Grid Admin tab.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
        }
    }

    @IsTest
    static void everyEntryPointFailsAsAnAuraHandledException() {
        System.runAs(GridTestUsers.fullUser()) {
            List<String> refused = new List<String>();
            for (Integer i = 0; i < 12; i++) {
                try {
                    switch on i {
                        when 0 {
                            GridAdminController.readConfig('Test_Records');
                        }
                        when 1 {
                            GridAdminController.canSave();
                        }
                        when 2 {
                            GridAdminController.listObjects();
                        }
                        when 3 {
                            GridAdminController.describeObject('Rowhouse_Test_Record__c');
                        }
                        when 4 {
                            GridAdminController.checkDraft('{}');
                        }
                        when 5 {
                            GridAdminController.saveDraft('{}');
                        }
                        when 6 {
                            GridAdminController.saveStatus('0Afhk0000000003');
                        }
                        when 7 {
                            GridAdminController.saveLogRetention(null);
                        }
                        when 8 {
                            GridAdminController.archiveConfig('Test_Records', true);
                        }
                        when 9 {
                            GridAdminController.cloneConfig('Nest_Accounts', 'Copy', 'Copy_of_Nest_Accounts');
                        }
                        when 10 {
                            GridAdminController.setupRecords('Test_Records');
                        }
                        when 11 {
                            GridAdminController.logRetention();
                        }
                    }
                } catch (AuraHandledException e) {
                    refused.add(String.valueOf(i));
                    System.assert(String.isNotBlank(e.getMessage()), 'Call ' + i + ' says why.');
                }
            }
            System.assertEquals(
                12,
                refused.size(),
                'Every entry point needs Rowhouse Grid Admin. Refused: ' + String.join(refused, ', ')
            );
        }
    }

    @IsTest
    static void aBadDraftIsRefusedWithAReadableMessage() {
        System.runAs(GridTestUsers.adminUser()) {
            try {
                GridAdminController.checkDraft('');
                System.assert(false, 'A blank draft is refused.');
            } catch (AuraHandledException e) {
                System.assertEquals('There is nothing to save.', e.getMessage());
            }
            try {
                GridAdminController.saveDraft('{not json');
                System.assert(false, 'A draft that is not JSON is refused.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().startsWith('System.JSONException'), e.getMessage());
            }
            try {
                GridAdminController.saveLogRetention(45);
                System.assert(false, 'Only the offered periods are saved.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('90 days'), e.getMessage());
            }
        }
    }
}
