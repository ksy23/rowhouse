/**
 * DEVELOPMENT ONLY. Never packaged.
 * A custom permission an admin names, such as a Grid Action's Required
 * Permission, read from the user's own permission set assignments, as the
 * installed package must: from there FeatureManagement does not see the org's
 * own custom permissions. GridSecurity.readAssignmentsOnly makes that read
 * answer alone. Run_Freight_Actions is granted by Freight Full Access
 * (fullUser), not by Freight Read Only or Freight Limited Access.
 */
@IsTest
private class GridCustomPermissionTest {
    private static final String PERMISSION = 'Run_Freight_Actions';

    @IsTest
    static void aUserWhoseAssignmentGrantsItHoldsIt() {
        User reader = GridTestUsers.readOnlyUser();
        GridSecurity.readAssignmentsOnly = true;
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(GridSecurity.hasCustomPermission(PERMISSION), 'Freight Full Access grants it.');
            System.assert(GridSecurity.hasCustomPermission(' run_freight_actions '), 'In any case, trimmed.');
        }
        System.runAs(reader) {
            System.assert(!GridSecurity.hasCustomPermission(PERMISSION), 'Freight Read Only does not grant it.');
        }
    }

    @IsTest
    static void anUnknownOrMalformedNameIsNotHeld() {
        GridSecurity.readAssignmentsOnly = true;
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(!GridSecurity.hasCustomPermission('Approve_Freight_Credits'), 'No such permission.');
            System.assert(!GridSecurity.hasCustomPermission('Run Freight Actions'), 'A label is not an API name.');
            System.assert(
                !GridSecurity.hasCustomPermission('cargo_ops__Run_Freight_Actions'),
                'Another package\'s, which this org does not have.'
            );
            System.assert(
                GridSecurity.hasCustomPermission(null) && GridSecurity.hasCustomPermission(' '),
                'A blank name asks for nothing.'
            );
        }
    }

    /**
     * Through a permission set group, with and without the permission muted,
     * the read of the user's assignments says what FeatureManagement says.
     * Measured in a Developer Edition org: both true for the open group, both
     * false for the muted one. In some orgs a group assigned
     * inside a test does not take effect at once, and then both say false, so
     * the test compares the two rather than expecting true.
     */
    @IsTest
    static void throughAGroupItAgreesWithFeatureManagement() {
        User floor = GridTestUsers.limitedUser();
        User desk = GridTestUsers.readOnlyUser();
        Id permission = [SELECT Id FROM CustomPermission WHERE DeveloperName = :PERMISSION LIMIT 1].Id;
        // A permission set that grants only the custom permission, in two groups; the second mutes it.
        PermissionSet actions = new PermissionSet(Name = 'Dispatch_Actions', Label = 'Dispatch Actions');
        insert actions;
        insert new SetupEntityAccess(ParentId = actions.Id, SetupEntityId = permission);
        PermissionSetGroup open = new PermissionSetGroup(
            DeveloperName = 'Dispatch_Floor',
            MasterLabel = 'Dispatch Floor'
        );
        PermissionSetGroup muted = new PermissionSetGroup(
            DeveloperName = 'Dispatch_Desk',
            MasterLabel = 'Dispatch Desk'
        );
        insert new List<PermissionSetGroup>{ open, muted };
        MutingPermissionSet mute = new MutingPermissionSet(
            DeveloperName = 'Dispatch_Desk_Muted',
            MasterLabel = 'Dispatch Desk Muted'
        );
        insert mute;
        insert new SetupEntityAccess(ParentId = mute.Id, SetupEntityId = permission);
        insert new List<PermissionSetGroupComponent>{
            new PermissionSetGroupComponent(PermissionSetGroupId = open.Id, PermissionSetId = actions.Id),
            new PermissionSetGroupComponent(PermissionSetGroupId = muted.Id, PermissionSetId = actions.Id),
            new PermissionSetGroupComponent(PermissionSetGroupId = muted.Id, PermissionSetId = mute.Id)
        };
        Test.calculatePermissionSetGroup(new List<Id>{ open.Id, muted.Id });
        insert new List<PermissionSetAssignment>{
            new PermissionSetAssignment(AssigneeId = floor.Id, PermissionSetGroupId = open.Id),
            new PermissionSetAssignment(AssigneeId = desk.Id, PermissionSetGroupId = muted.Id)
        };
        GridSecurity.readAssignmentsOnly = true;
        for (User u : new List<User>{ floor, desk, GridTestUsers.fullUser() }) {
            System.runAs(u) {
                System.assertEquals(
                    FeatureManagement.checkPermission(PERMISSION),
                    GridSecurity.hasCustomPermission(PERMISSION),
                    u.Alias
                );
            }
        }
        System.runAs(desk) {
            System.assert(!GridSecurity.hasCustomPermission(PERMISSION), 'Muted in the group.');
        }
    }
}
