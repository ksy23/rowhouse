/**
 * DEVELOPMENT ONLY. Never packaged.
 * Change Owner from a row's menu: who is offered it, what the server
 * refuses, what it changes at once, how a record that cannot change owner
 * comes back, and the log in a grid that keeps one. The fixture configurations
 * decide where it is offered: Consignments and Consignment_Audit edit cells,
 * Consignment_Directory does not; Consignment_Audit logs its changes.
 */
@IsTest
private class GridOwnerServiceTest {
    private static Consignment__c newRecord(String name) {
        Consignment__c r = new Consignment__c(Name = name);
        insert r;
        return r;
    }

    private static Id ownerOf(Id recordId) {
        return [SELECT OwnerId FROM Consignment__c WHERE Id = :recordId].OwnerId;
    }

    private static String refusal(String configName, List<Id> ids, Id ownerId) {
        try {
            GridOwnerService.changeOwner(configName, ids, ownerId);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void changesTheOwnerAtOnce() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        Consignment__c first;
        Consignment__c second;
        GridOwnerService.Result result;
        System.runAs(full) {
            first = newRecord('Kennebec Lumber, 7 bundles');
            second = newRecord('Casco Bay Marine, 4 crates');
            Test.startTest();
            result = GridOwnerService.changeOwner(
                'Consignments',
                new List<Id>{ first.Id, second.Id, first.Id },
                peer.Id
            ); // a repeated Id is changed once
            Test.stopTest();
        }
        System.assertEquals(new List<Id>{ first.Id, second.Id }, result.changedIds);
        System.assert(result.errors.isEmpty(), String.valueOf(result.errors));
        System.assertEquals(peer.Id, ownerOf(first.Id), 'Saved at once, not held as an unsaved edit.');
        System.assertEquals(peer.Id, ownerOf(second.Id));
    }

    @IsTest
    static void offersChangeOwnerAndEditOnlyWhereTheGridEditsCellsAndTheUserMayEdit() {
        User full = GridTestUsers.fullUser();
        User reader = GridTestUsers.readOnlyUser();
        GridConfig.Definition editing;
        GridConfig.Definition directory;
        GridConfig.Definition reading;
        Test.startTest();
        System.runAs(full) {
            editing = GridConfig.forUser('Consignments');
            directory = GridConfig.forUser('Consignment_Directory');
        }
        System.runAs(reader) {
            reading = GridConfig.forUser('Consignments');
        }
        Test.stopTest();
        System.assertEquals(true, editing.canChangeOwner);
        System.assertEquals(true, editing.canEditRecords);
        System.assertEquals(false, directory.canChangeOwner, 'Consignment_Directory does not edit cells.');
        System.assertEquals(false, directory.canEditRecords);
        System.assertEquals(false, reading.canChangeOwner, 'Freight_Read_Only cannot edit the object.');
        System.assertEquals(false, reading.canEditRecords);
    }

    @IsTest
    static void refusesWhereTheGridDoesNotOfferIt() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        User reader = GridTestUsers.readOnlyUser();
        Consignment__c rec;
        System.runAs(full) {
            rec = newRecord('Penobscot Paper, full truck');
        }
        String directory;
        String readOnly;
        String search;
        Test.startTest();
        System.runAs(full) {
            directory = refusal('Consignment_Directory', new List<Id>{ rec.Id }, peer.Id);
        }
        System.runAs(reader) {
            readOnly = refusal('Consignments', new List<Id>{ rec.Id }, peer.Id);
            try {
                GridOwnerService.searchOwners('Consignments', 'Pelletier');
            } catch (GridException e) {
                search = e.getMessage();
            }
        }
        Test.stopTest();
        String expected = 'You cannot change the owner of records in this grid.';
        System.assertEquals(expected, directory);
        System.assertEquals(expected, readOnly);
        System.assertEquals(expected, search, 'The owner search is refused where Change Owner is.');
        System.assertEquals(full.Id, ownerOf(rec.Id), 'Nothing was changed.');
    }

    @IsTest
    static void refusesAnOwnerTheRecordCannotHave() {
        User full = GridTestUsers.fullUser();
        List<User> automated = [SELECT Id FROM User WHERE UserType = 'AutomatedProcess' LIMIT 1];
        Consignment__c rec;
        String notAnOwner;
        String noOwner;
        String systemUser;
        System.runAs(full) {
            rec = newRecord('Wachusett Paper, 9 pallets');
            Test.startTest();
            notAnOwner = refusal('Consignments', new List<Id>{ rec.Id }, rec.Id);
            noOwner = refusal('Consignments', new List<Id>{ rec.Id }, null);
            systemUser = automated.isEmpty()
                ? 'That owner cannot own (no automated process user in this org)'
                : refusal('Consignments', new List<Id>{ rec.Id }, automated[0].Id);
            Test.stopTest();
        }
        System.assert(notAnOwner != null && notAnOwner.startsWith('That owner cannot own'), notAnOwner);
        System.assert(noOwner != null && noOwner.startsWith('That owner cannot own'), noOwner);
        System.assert(
            systemUser != null && systemUser.startsWith('That owner cannot own'),
            'The automated process user cannot own records: ' + systemUser
        );
        System.assertEquals(full.Id, ownerOf(rec.Id), 'Nothing was changed.');
    }

    @IsTest
    static void reportsARecordThatCannotChangeOwnerAndChangesTheRest() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        Consignment__c kept;
        Consignment__c gone;
        GridOwnerService.Result result;
        System.runAs(full) {
            kept = newRecord('Bangor Brick & Tile, Belfast');
            gone = newRecord('Androscoggin Mills, 12 rolls');
            delete gone; // deleted by someone else since the grid read it
            Test.startTest();
            result = GridOwnerService.changeOwner('Consignments', new List<Id>{ gone.Id, kept.Id }, peer.Id);
            Test.stopTest();
        }
        System.assertEquals(new List<Id>{ kept.Id }, result.changedIds);
        System.assertEquals(1, result.errors.size(), String.valueOf(result.errors));
        System.assertEquals(gone.Id, result.errors[0].recordId);
        System.assertEquals(null, result.errors[0].fieldName, 'The error belongs to the row, not a cell.');
        System.assert(String.isNotBlank(result.errors[0].message), 'The row error must say why.');
        System.assertEquals(peer.Id, ownerOf(kept.Id));
    }

    @IsTest
    static void refusesAnIdOfAnotherObjectAndChangesNothing() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        Consignment__c rec;
        String message;
        System.runAs(full) {
            rec = newRecord('Kennebec Lumber, 3 bundles');
            Test.startTest();
            message = refusal('Consignments', new List<Id>{ rec.Id, UserInfo.getUserId() }, peer.Id);
            Test.stopTest();
        }
        System.assert(message != null && message.contains('is not a Consignment__c'), message);
        System.assertEquals(full.Id, ownerOf(rec.Id), 'A request with a foreign Id is refused whole.');
    }

    @IsTest
    static void logsTheOwnerChangeInAGridThatLogs() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        Consignment__c rec;
        List<Grid_Edit_Log__c> entries;
        System.runAs(full) {
            rec = newRecord('Casco Bay Marine, 2 crates');
            Test.startTest();
            GridOwnerService.changeOwner('Consignment_Audit', new List<Id>{ rec.Id }, peer.Id);
            Test.stopTest();
            entries = [
                SELECT Operation__c, Field__c, Old_Value__c, New_Value__c, Record_Name__c, Grid_Configuration__c
                FROM Grid_Edit_Log__c
                WHERE Record_Id__c = :String.valueOf(rec.Id)
            ];
        }
        System.assertEquals(1, entries.size(), String.valueOf(entries));
        System.assertEquals(GridEditLog.OP_UPDATE, entries[0].Operation__c);
        System.assertEquals('OwnerId', entries[0].Field__c);
        System.assertEquals(String.valueOf(full.Id), entries[0].Old_Value__c);
        System.assertEquals(String.valueOf(peer.Id), entries[0].New_Value__c);
        System.assertEquals('Casco Bay Marine, 2 crates', entries[0].Record_Name__c);
        System.assertEquals('Consignment_Audit', entries[0].Grid_Configuration__c);
    }

    @IsTest
    static void changesNoOwnerWhenTheLogCannotBeWritten() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        Consignment__c rec;
        String message;
        System.runAs(full) {
            rec = newRecord('Penobscot Paper, 5 pallets');
            Test.startTest();
            GridEditLog.failWriteForTest = true;
            try {
                GridOwnerService.changeOwner('Consignment_Audit', new List<Id>{ rec.Id }, peer.Id);
            } catch (GridException e) {
                message = e.getMessage();
            } finally {
                GridEditLog.failWriteForTest = false;
            }
            Test.stopTest();
        }
        System.assert(message != null && message.contains('log entry could not be written'), message);
        System.assertEquals(full.Id, ownerOf(rec.Id), 'No owner stays changed without its log entry.');
    }

    @IsTest
    static void searchFindsUsersByName() {
        User peer = GridTestUsers.peerUser();
        User full = GridTestUsers.fullUser();
        List<Map<String, String>> found;
        System.runAs(full) {
            Test.startTest();
            found = GridOwnerService.searchOwners('Consignments', 'Pelletier');
            Test.stopTest();
        }
        Boolean seen = false;
        for (Map<String, String> match : found) {
            if (match.get('id') == String.valueOf(peer.Id)) {
                seen = true;
                System.assertEquals('User', match.get('kind'));
                System.assertEquals('Nora Pelletier', match.get('name'));
            }
        }
        System.assert(seen, 'The search offers an active user by name: ' + found);
    }
}
