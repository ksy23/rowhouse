/**
 * DEVELOPMENT ONLY. Never packaged.
 * Mass delete: what the server refuses, what it deletes, and how a row
 * that could not be deleted comes back. Undo after a delete, and the Ids of
 * every matching record for "delete every matching record". The fixture configurations decide
 * whether a grid allows it: Consignments does, Consignment_Rates does not. The refusal
 * for a user without delete permission is in GridSecurityTest, with the other
 * access tests.
 */
@IsTest
private class GridDeleteServiceTest {
    private static List<Consignment__c> newRecords(String name, Integer count) {
        List<Consignment__c> out = new List<Consignment__c>();
        for (Integer i = 0; i < count; i++) {
            out.add(new Consignment__c(Name = name + ' ' + i));
        }
        return out;
    }

    private static String refusal(String configName, List<Id> ids) {
        try {
            GridDeleteService.deleteRows(configName, ids);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void deletesTheSelectedRowsIntoTheRecycleBin() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords('Kennebec Lumber, bundle', 3);
            insert recs;
            Test.startTest();
            GridDeleteService.Result result = GridDeleteService.deleteRows(
                'Consignments',
                new List<Id>{ recs[0].Id, recs[1].Id, recs[0].Id }
            ); // a repeated Id is deleted once
            Test.stopTest();
            System.assertEquals(new List<Id>{ recs[0].Id, recs[1].Id }, result.deletedIds);
            System.assert(result.errors.isEmpty(), String.valueOf(result.errors));
            System.assertEquals(
                1,
                [SELECT COUNT() FROM Consignment__c WHERE Id IN :recs],
                'Only the selected rows are deleted.'
            );
            System.assertEquals(
                2,
                [SELECT COUNT() FROM Consignment__c WHERE Id IN :recs AND IsDeleted = TRUE ALL ROWS],
                'Deleted rows go to the Recycle Bin, where they can be restored.'
            );
        }
    }

    @IsTest
    static void reportsARowTheUserMayNotDeleteAndDeletesTheRest() {
        // Both users may delete the object, but only their own records: the
        // organisation-wide default is Public Read/Write, which does not give
        // delete. So one row fails for sharing, the other is deleted.
        User owner = GridTestUsers.fullUser();
        User other = GridTestUsers.fullUser();
        Consignment__c theirs = new Consignment__c(Name = 'Casco Bay Marine, 4 crates');
        System.runAs(owner) {
            insert theirs;
        }
        Consignment__c mine = new Consignment__c(Name = 'Wachusett Paper, 9 pallets');
        GridDeleteService.Result result;
        System.runAs(other) {
            insert mine;
            Test.startTest();
            result = GridDeleteService.deleteRows('Consignments', new List<Id>{ theirs.Id, mine.Id });
            Test.stopTest();
        }
        System.assertEquals(new List<Id>{ mine.Id }, result.deletedIds);
        System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
        System.assertEquals(theirs.Id, result.errors[0].recordId);
        System.assertEquals(null, result.errors[0].fieldName, 'A delete error belongs to the row, not a cell.');
        System.assert(String.isNotBlank(result.errors[0].message), 'The row error must say why.');
        System.runAs(owner) {
            System.assertEquals(
                1,
                [SELECT COUNT() FROM Consignment__c WHERE Id = :theirs.Id],
                'The row the user may not delete is still there.'
            );
        }
    }

    @IsTest
    static void refusesWhenTheConfigurationDoesNotAllowIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = new Consignment__c(Name = 'Penobscot Paper, full truck');
            insert rec;
            Test.startTest();
            String message = refusal('Consignment_Rates', new List<Id>{ rec.Id });
            Boolean offered = GridConfig.forUser('Consignment_Rates').allowMassDelete;
            Test.stopTest();
            System.assertEquals('This grid does not allow deleting records.', message);
            System.assertEquals(false, offered, 'The grid must not offer what the server refuses.');
            System.assertEquals(1, [SELECT COUNT() FROM Consignment__c WHERE Id = :rec.Id]);
        }
    }

    @IsTest
    static void offersDeleteOnlyToUsersWhoMayDeleteTheObject() {
        User limited = GridTestUsers.limitedUser();
        User full = GridTestUsers.fullUser();
        Boolean limitedOffered;
        Boolean fullOffered;
        Test.startTest();
        System.runAs(limited) {
            limitedOffered = GridConfig.forUser('Consignments').allowMassDelete;
        }
        System.runAs(full) {
            fullOffered = GridConfig.forUser('Consignments').allowMassDelete;
        }
        Test.stopTest();
        System.assertEquals(false, limitedOffered, 'Freight_Limited_Access has no delete permission.');
        System.assertEquals(true, fullOffered);
    }

    @IsTest
    static void refusesAnIdOfAnotherObjectAndDeletesNothing() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = new Consignment__c(Name = 'Bangor Brick & Tile, Belfast');
            insert rec;
            Test.startTest();
            String message = refusal('Consignments', new List<Id>{ rec.Id, UserInfo.getUserId() });
            Test.stopTest();
            System.assert(message != null && message.contains('is not a Consignment__c'), message);
            System.assertEquals(
                1,
                [SELECT COUNT() FROM Consignment__c WHERE Id = :rec.Id],
                'A request with a foreign Id is refused whole.'
            );
        }
    }

    @IsTest
    static void refusesMoreThanTwoHundredIds() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = new Consignment__c(Name = 'Mill River Energy, Springfield');
            insert rec;
            List<Id> ids = new List<Id>();
            for (Integer i = 0; i <= GridDeleteService.MAX_IDS; i++) {
                ids.add(rec.Id);
            }
            Test.startTest();
            String message = refusal('Consignments', ids);
            Test.stopTest();
            System.assertEquals('Delete at most 200 records at a time; this request has 201.', message);
            System.assertEquals(1, [SELECT COUNT() FROM Consignment__c WHERE Id = :rec.Id]);
        }
    }

    @IsTest
    static void undoPutsDeletedRecordsBackAndSaysWhyNotForOneNotInTheBin() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords('Saco River Outfitters, carton', 3);
            insert recs;
            GridDeleteService.deleteRows('Consignments', new List<Id>{ recs[0].Id, recs[1].Id });
            Test.startTest();
            GridDeleteService.RestoreResult result = GridController.restoreRows(
                'Consignments',
                new List<Id>{ recs[0].Id, recs[1].Id, recs[2].Id }
            );
            Test.stopTest();
            System.assertEquals(new List<Id>{ recs[0].Id, recs[1].Id }, result.restoredIds);
            System.assertEquals(1, result.errors.size(), 'A record that was never deleted cannot be put back.');
            System.assertEquals(recs[2].Id, result.errors[0].recordId);
            System.assertEquals(3, [SELECT COUNT() FROM Consignment__c WHERE Id IN :recs], 'All three are back.');
        }
    }

    @IsTest
    static void undoIsRefusedWhereDeletingIs() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = new Consignment__c(Name = 'Monadnock Granite, 2 slabs');
            insert rec;
            delete rec;
            String message;
            Test.startTest();
            try {
                GridDeleteService.restoreRows('Consignment_Rates', new List<Id>{ rec.Id });
            } catch (GridException e) {
                message = e.getMessage();
            }
            String foreign;
            try {
                GridDeleteService.restoreRows('Consignments', new List<Id>{ UserInfo.getUserId() });
            } catch (GridException e) {
                foreign = e.getMessage();
            }
            Test.stopTest();
            System.assertEquals('This grid does not allow deleting records.', message);
            System.assert(foreign != null && foreign.contains('is not a Consignment__c'), foreign);
            System.assertEquals(0, [SELECT COUNT() FROM Consignment__c WHERE Id = :rec.Id]);
        }
    }

    @IsTest
    static void listsEveryMatchingRecordInIdOrderASliceAtATime() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> recs = newRecords('Quabbin Supply, drum', 3);
            recs.add(new Consignment__c(Name = 'Green Mountain Maple, 6 barrels'));
            insert recs;
            Test.startTest();
            List<Object> first = (List<Object>) GridController.matchingIds(
                    'Consignments',
                    'Quabbin Supply',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                )
                .get('ids');
            List<Object> rest = (List<Object>) GridController.matchingIds(
                    'Consignments',
                    'Quabbin Supply',
                    null,
                    null,
                    null,
                    null,
                    String.valueOf(first[0]),
                    null
                )
                .get('ids');
            Test.stopTest();
            List<Id> expected = new List<Id>{ recs[0].Id, recs[1].Id, recs[2].Id };
            expected.sort();
            System.assertEquals(
                expected,
                (List<Id>) JSON.deserialize(JSON.serialize(first), List<Id>.class),
                'Only the records the search matches, in Id order.'
            );
            System.assertEquals(2, rest.size(), 'After an Id: the ones after it.');
        }
    }

    @IsTest
    static void refusesToListMatchesWhereDeletingIsNotAllowedOrAfterAForeignId() {
        System.runAs(GridTestUsers.fullUser()) {
            String notAllowed;
            String foreign;
            Test.startTest();
            try {
                GridController.matchingIds('Consignment_Rates', null, null, null, null, null, null, null);
            } catch (AuraHandledException e) {
                notAllowed = e.getMessage();
            }
            try {
                GridController.matchingIds('Consignments', null, null, null, null, null, UserInfo.getUserId(), null);
            } catch (AuraHandledException e) {
                foreign = e.getMessage();
            }
            Test.stopTest();
            System.assertEquals('This grid does not allow deleting records.', notAllowed);
            System.assert(foreign != null && foreign.contains('is not a Consignment__c'), foreign);
        }
    }

    @IsTest
    static void theControllerPassesOnARefusalAndAnEmptyRequest() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = new Consignment__c(Name = 'Narragansett Shellfish, Providence');
            insert rec;
            String message;
            Test.startTest();
            GridDeleteService.Result empty = GridController.deleteRows('Consignment_Rates', new List<Id>());
            try {
                GridController.deleteRows('Consignment_Rates', new List<Id>{ rec.Id });
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Test.stopTest();
            System.assert(empty.deletedIds.isEmpty() && empty.errors.isEmpty(), 'Nothing asked, nothing done.');
            System.assertEquals('This grid does not allow deleting records.', message);
        }
    }
}
