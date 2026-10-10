/**
 * DEVELOPMENT ONLY. Never packaged.
 * Lookup and owner cells: the typeahead search, the display name that
 * travels with each row, sorting and searching by that name, and the save's
 * check that a lookup holds an Id of its own target object.
 *
 * Runs as GridTestUsers.fullUser(): what the searches can see comes from
 * sharing and permission sets, never from whoever runs the suite.
 */
@IsTest
private class GridLookupTest {
    private static Map<String, Id> accounts(List<String> names) {
        List<Account> recs = new List<Account>();
        for (String n : names) {
            recs.add(new Account(Name = n));
        }
        insert recs;
        Map<String, Id> out = new Map<String, Id>();
        for (Account a : recs) {
            out.put(a.Name, a.Id);
        }
        return out;
    }

    @IsTest
    static void searchFindsTheTermAnywhereInTheName() {
        System.runAs(GridTestUsers.fullUser()) {
            accounts(new List<String>{ 'Acme Rowhouse', 'Rowhouse Ltd', 'Unrelated Co' });
            List<Map<String, String>> found = GridLookup.search('Test_Records', 'Lookup_Field__c', 'rowhouse');
            System.assertEquals(2, found.size(), String.valueOf(found));
            System.assertEquals('Acme Rowhouse', found[0].get('name'), 'Sorted by name.');
            System.assertEquals('Rowhouse Ltd', found[1].get('name'));
            System.assertEquals('Account', found[0].get('kind'));
            System.assertEquals('Account', found[0].get('object'), 'The object\'s local name keys its icon.');
            System.assert(String.isNotBlank(found[0].get('id')));
        }
    }

    @IsTest
    static void wildcardsInTheTermAreText() {
        System.runAs(GridTestUsers.fullUser()) {
            accounts(new List<String>{ '100% Cotton', 'Plain Cotton' });
            List<Map<String, String>> found = GridLookup.search('Test_Records', 'Lookup_Field__c', '%');
            System.assertEquals(1, found.size(), 'A percent sign is matched literally (TC-021).');
            System.assertEquals('100% Cotton', found[0].get('name'));
        }
    }

    @IsTest
    static void ownerSearchOffersActiveUsersAndThisObjectsQueues() {
        Group queue = new Group(Name = 'Rowhouse Owner Queue', Type = 'Queue');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert queue;
            insert new QueueSobject(
                QueueId = queue.Id,
                SobjectType = Rowhouse_Test_Record__c.SObjectType.getDescribe().getName()
            );
        }
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, String>> found = GridLookup.search('Test_Records', 'OwnerId', 'Rowhouse');
            Set<String> kinds = new Set<String>();
            Boolean queueFound = false;
            for (Map<String, String> r : found) {
                kinds.add(r.get('kind'));
                queueFound = queueFound || r.get('id') == queue.Id;
            }
            System.assert(kinds.contains('User'), 'The test user is named Rowhouse Full: ' + found);
            System.assert(queueFound, 'A queue that accepts the object is offered: ' + found);
            for (Map<String, String> r : found) {
                System.assertEquals(r.get('kind') == 'Queue' ? 'Group' : 'User', r.get('object'), String.valueOf(r));
            }
        }
    }

    @IsTest
    static void onlyAnEditableLookupColumnOfTheGridCanBeSearched() {
        System.runAs(GridTestUsers.fullUser()) {
            for (String field : new List<String>{ 'Text_Field__c', 'CreatedById', 'No_Such_Field__c' }) {
                try {
                    GridLookup.search('Test_Records', field, 'a');
                    System.assert(false, 'Expected a refusal for ' + field);
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('no editable lookup column'), e.getMessage());
                }
            }
        }
    }

    @IsTest
    static void theLimitedUserCannotSearchALookupItCannotSee() {
        System.runAs(GridTestUsers.limitedUser()) {
            try {
                GridLookup.search('Test_Records', 'Lookup_Field__c', 'a');
                System.assert(false, 'Lookup_Field__c is not readable to the limited user.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Lookup_Field__c'), e.getMessage());
            }
        }
    }

    @IsTest
    static void rowsCarryTheNameAndSortAndSearchByIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Id> ids = accounts(new List<String>{ 'Zeta Corp', 'Alpha Corp' });
            insert new List<Rowhouse_Test_Record__c>{
                new Rowhouse_Test_Record__c(Name = 'LK-1', Lookup_Field__c = ids.get('Zeta Corp')),
                new Rowhouse_Test_Record__c(Name = 'LK-2', Lookup_Field__c = ids.get('Alpha Corp'))
            };
            Map<String, Object> result = GridController.fetchRows(
                'Test_Records',
                'Corp',
                'Lookup_Field__c',
                'asc',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get('rows');
            System.assertEquals(2, rows.size(), 'Quick search matches the lookup name.');
            System.assertEquals('LK-2', rows[0].get('Name'), 'Sorted by the name shown, Alpha before Zeta.');
            Map<String, String> labels = (Map<String, String>) rows[0].get('_labels');
            System.assertEquals('Alpha Corp', labels.get('Lookup_Field__c'));
            System.assertEquals(ids.get('Alpha Corp'), rows[0].get('Lookup_Field__c'), 'The value stays the Id.');
            System.assert(String.isNotBlank(labels.get('OwnerId')), 'The owner is named too.');
        }
    }

    @IsTest
    static void aLookupSavesOnlyAnIdOfItsTargetObject() {
        System.runAs(GridTestUsers.fullUser()) {
            Rowhouse_Test_Record__c rec = new Rowhouse_Test_Record__c(Name = 'LK-save');
            insert rec;
            GridSaveResult res = GridSaveService.save(
                'Test_Records',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => rec.Id, 'Lookup_Field__c' => UserInfo.getUserId() }
                }
            );
            System.assertEquals(1, res.errors.size(), String.valueOf(res.errors));
            System.assertEquals('Lookup_Field__c', res.errors[0].fieldName);
            System.assert(res.errors[0].message.contains('is not a Account record'), res.errors[0].message);
        }
    }

    @IsTest
    static void aFilteredLookupIsSaidSoWithItsApiName() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Column filtered;
            GridConfig.Column plain;
            for (GridConfig.Column c : GridConfig.forUser('Import_Test').columns) {
                if (c.field == 'Filtered_Account__c') {
                    filtered = c;
                }
            }
            for (GridConfig.Column c : GridConfig.forUser('Test_Records').columns) {
                if (c.field == 'Lookup_Field__c') {
                    plain = c;
                }
            }
            System.assertEquals(true, filtered.filteredLookup, 'Filtered_Account__c has a lookup filter.');
            System.assert(filtered.fieldApiName.endsWith('Filtered_Account__c'), filtered.fieldApiName);
            System.assertEquals(false, plain.filteredLookup);
            System.assertEquals(null, plain.fieldApiName);
        }
    }

    @IsTest
    static void aLookupOffersNewForTargetsTheUserMayCreate() {
        System.runAs(GridTestUsers.fullUser()) {
            for (GridConfig.Column c : GridConfig.forUser('Test_Records').columns) {
                if (c.field == 'Lookup_Field__c') {
                    Boolean canCreate = Schema.Account.SObjectType.getDescribe().isCreateable();
                    System.assertEquals(canCreate, c.newTargets != null, String.valueOf(c.newTargets));
                    if (canCreate) {
                        System.assertEquals('Account', c.newTargets[0].get('object'));
                    }
                }
                if (c.field == 'OwnerId') {
                    System.assertEquals(null, c.newTargets, 'An owner is not created from its lookup.');
                }
            }
        }
    }

    @IsTest
    static void namesTheRecordALookupNowPointsTo() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Id> ids = accounts(new List<String>{ 'Named Corp' });
            Rowhouse_Test_Record__c other = new Rowhouse_Test_Record__c(Name = 'Not an account');
            insert other;
            Test.startTest();
            String name = GridController.lookupName('Test_Records', 'Lookup_Field__c', ids.get('Named Corp'));
            String refused;
            try {
                GridController.lookupName('Test_Records', 'Lookup_Field__c', other.Id);
            } catch (AuraHandledException e) {
                refused = e.getMessage();
            }
            Test.stopTest();
            System.assertEquals('Named Corp', name);
            System.assert(refused != null && refused.contains('cannot be the value of'), refused);
        }
    }

    @IsTest
    static void namesFindTheirRecordsWhateverTheCaseAndSayWhenTwoShareOne() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Id> ids = accounts(new List<String>{ 'Edge Communications', 'Twin Co', 'Twin Co', 'Other' });
            Test.startTest();
            Map<String, List<Map<String, String>>> found = GridController.findLookupNames(
                'Test_Records',
                'Lookup_Field__c',
                new List<String>{ 'edge communications', 'Twin Co', 'Nobody Inc', '  ', null }
            );
            Test.stopTest();
            System.assertEquals(new Set<String>{ 'edge communications', 'twin co' }, found.keySet());
            System.assertEquals(1, found.get('edge communications').size());
            System.assertEquals(ids.get('Edge Communications'), found.get('edge communications')[0].get('id'));
            System.assertEquals('Edge Communications', found.get('edge communications')[0].get('name'));
            System.assertEquals(
                2,
                found.get('twin co').size(),
                'Two records of one name: both, so the browser can say so.'
            );
        }
    }

    @IsTest
    static void ownerNamesAreActiveUsersOrThisObjectsQueues() {
        System.runAs(GridTestUsers.fullUser()) {
            String me = [SELECT Name FROM User WHERE Id = :UserInfo.getUserId()].Name;
            Map<String, List<Map<String, String>>> found = GridLookup.namesFor(
                'Test_Records',
                'OwnerId',
                new List<String>{ me }
            );
            System.assert(found.containsKey(me.toLowerCase()), String.valueOf(found));
            Boolean mine = false;
            for (Map<String, String> m : found.get(me.toLowerCase())) {
                mine = mine || m.get('id') == UserInfo.getUserId();
            }
            System.assert(mine, 'The user by name.');
        }
    }

    @IsTest
    static void namesAreLookedUpOnlyForAnEditableLookupColumnAndAFewAtATime() {
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridLookup.namesFor('Test_Records', 'Text_Field__c', new List<String>{ 'x' });
                System.assert(false, 'Not a lookup column.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('no editable lookup column'), e.getMessage());
            }
            List<String> many = new List<String>();
            for (Integer i = 0; i <= GridLookup.MAX_NAMES; i++) {
                many.add('Name ' + i);
            }
            try {
                GridLookup.namesFor('Test_Records', 'Lookup_Field__c', many);
                System.assert(false, 'Too many names.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('At most'), e.getMessage());
            }
            System.assertEquals(0, GridLookup.namesFor('Test_Records', 'Lookup_Field__c', new List<String>()).size());
        }
    }
}
