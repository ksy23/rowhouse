/**
 * DEVELOPMENT ONLY. Never packaged.
 * Saved views: saved, read, renamed and deleted by their owner only;
 * private until shared, and shared through Salesforce's own sharing with
 * all users or groups by someone who holds Manage Public List Views; checked
 * against the grid on save and again when the grid opens on one. As
 * restricted users throughout. 'Consignments' is a fixture configuration
 * (test-data/config).
 */
@IsTest
private class GridViewsTest {
    private static final String BIG = '{"v":1,"filters":[{"field":"Pieces__c","operator":"greater_than","value":"10"}],"grouping":[]}';
    private static final String ECONOMY = '{"v":1,"filters":[{"field":"Service_Level__c","operator":"equals","value":"Economy"}],"grouping":[]}';

    @TestSetup
    static void setup() {
        GridTestUsers.fullUser();
        GridTestUsers.peerUser();
        GridTestUsers.limitedUser();
        GridTestUsers.adminUser();
        GridTestUsers.noExportUser();
        GridTestUsers.adminViewer();
        System.runAs(GridTestUsers.built(GridTestUsers.FULL)) {
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Apple crates, Springfield', Pieces__c = 5, Service_Level__c = 'Economy'),
                new Consignment__c(Name = 'Maple syrup, Burlington', Pieces__c = 15, Service_Level__c = 'Standard'),
                new Consignment__c(Name = 'Paper rolls, Bangor', Pieces__c = 25, Service_Level__c = 'Express')
            };
        }
    }

    private static User full() {
        return GridTestUsers.built(GridTestUsers.FULL);
    }

    private static User peer() {
        return GridTestUsers.built(GridTestUsers.PEER);
    }

    private static User admin() {
        return GridTestUsers.built(GridTestUsers.ADMIN);
    }

    private static List<GridViews.View> listed() {
        return (List<GridViews.View>) GridController.listViews('Consignments').get('views');
    }

    private static List<String> names(List<GridViews.View> views) {
        List<String> out = new List<String>();
        for (GridViews.View v : views) {
            out.add(v.name);
        }
        return out;
    }

    @IsTest
    static void anOwnerSavesReadsRenamesAndDeletesTheirOwnView() {
        System.runAs(full()) {
            System.assertEquals(0, listed().size(), 'No views yet.');
            GridViews.View saved = GridController.saveView('consignments', null, '  Big shipments ', BIG, null, null);
            System.assertEquals('Big shipments', saved.name, 'The name is trimmed.');
            System.assertEquals(true, saved.mine);
            System.assertEquals(BIG, saved.view);
            System.assertEquals(GridViews.ONLY_ME, saved.sharing, 'A new view is its owner\'s alone.');
            Grid_View__c record = [SELECT Grid__c, OwnerId FROM Grid_View__c WHERE Id = :saved.id];
            System.assertEquals('Consignments', record.Grid__c, 'The grid as the org spells it.');
            System.assertEquals(UserInfo.getUserId(), record.OwnerId);

            GridController.saveView('Consignments', null, 'Economy only', ECONOMY, null, null);
            System.assertEquals(new List<String>{ 'Big shipments', 'Economy only' }, names(listed()), 'A to Z.');
            System.assertEquals(null, listed()[0].view, 'The list leaves out what each view keeps.');

            GridViews.View renamed = GridController.saveView('Consignments', saved.id, 'Large loads', null, null, null);
            System.assertEquals('Large loads', renamed.name);
            System.assertEquals(BIG, renamed.view, 'A rename keeps what the view keeps.');
            GridViews.View changed = GridController.saveView('Consignments', saved.id, null, ECONOMY, null, null);
            System.assertEquals('Large loads', changed.name, 'A change keeps the name.');
            System.assertEquals(ECONOMY, GridController.readView('Consignments', saved.id).view);

            try {
                GridController.saveView('Consignments', null, 'economy ONLY', BIG, null, null);
                System.assert(false, 'Two of one user\'s views of a grid can\'t share a name.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('already have a view named'), e.getMessage());
            }
            GridController.saveView('Consignments', saved.id, 'Large loads', null, null, null); // its own name: fine

            GridController.deleteView('Consignments', saved.id);
            System.assertEquals(new List<String>{ 'Economy only' }, names(listed()));
            try {
                GridController.readView('Consignments', saved.id);
                System.assert(false, 'A deleted view is gone.');
            } catch (AuraHandledException e) {
                System.assertEquals('This view was deleted, or is no longer shared with you.', e.getMessage());
            }
        }
    }

    @IsTest
    static void aViewIsPrivateUntilItsOwnerSharesIt() {
        GridViews.View saved;
        System.runAs(full()) {
            saved = GridViews.save('Consignments', null, 'Big shipments', BIG, null, null);
        }
        System.runAs(peer()) {
            System.assertEquals(0, listed().size(), 'Another user\'s private view is not listed.');
            try {
                GridViews.read('Consignments', saved.id);
                System.assert(false, 'Nor can it be read by its Id.');
            } catch (GridException e) {
                System.assertEquals('This view was deleted, or is no longer shared with you.', e.getMessage());
            }
            System.assertEquals(null, GridViews.readIfVisible('Consignments', saved.id));
            try {
                GridViews.remove('Consignments', saved.id);
                System.assert(false, 'Nor deleted.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('no longer shared'), e.getMessage());
            }
        }
        System.runAs(admin()) {
            // View All on Grid View reads every view, but the grid's list leaves out other people's private ones.
            System.assertEquals(0, listed().size(), 'Not listed, even for someone who can see it.');
        }
    }

    @IsTest
    static void sharingNeedsManagePublicListViews() {
        System.runAs(GridTestUsers.built('rhnoexp')) {
            System.assertEquals(false, GridSecurity.canSharePublicly(), 'Minimum Access lacks it.');
            System.assertEquals(false, GridController.listViews('Consignments').get('canShare'));
            GridViews.View saved = GridViews.save('Consignments', null, 'Big shipments', BIG, null, null);
            for (String mode : new List<String>{ GridViews.ALL_USERS, GridViews.WITH_GROUPS }) {
                try {
                    GridController.shareView('Consignments', saved.id, mode, new List<String>());
                    System.assert(false, 'Sharing needs the permission.');
                } catch (AuraHandledException e) {
                    System.assert(e.getMessage().contains('Manage Public List Views'), e.getMessage());
                }
            }
            try {
                GridController.saveView('Consignments', null, 'Shared at once', BIG, GridViews.ALL_USERS, null);
                System.assert(false, 'Nor when the view is created.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('Manage Public List Views'), e.getMessage());
            }
            System.assertEquals(
                new List<String>{ 'Big shipments' },
                names(listed()),
                'A refused share saves nothing of the new view.'
            );
            System.assertEquals(
                GridViews.ONLY_ME,
                GridController.shareView('Consignments', saved.id, 'me', null).sharing
            );
            try {
                GridController.viewGroupTypes();
                System.assert(false, 'Nor can they look for groups.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('Manage Public List Views'), e.getMessage());
            }
        }
    }

    @IsTest
    static void aSharedViewIsSeenAndReadButOnlyItsOwnerChangesIt() {
        Group newEngland;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            newEngland = new Group(Name = 'Sales New England', Type = 'Regular');
            insert newEngland;
            insert new GroupMember(GroupId = newEngland.Id, UserOrGroupId = peer().Id);
        }
        GridViews.View everyone;
        GridViews.View region;
        System.runAs(admin()) {
            System.assertEquals(true, GridSecurity.canSharePublicly(), 'A System Administrator holds it.');
            everyone = GridController.saveView('Consignments', null, 'Everyone sees this', BIG, 'all', null);
            System.assertEquals(GridViews.ALL_USERS, everyone.sharing);
            region = GridController.saveView(
                'Consignments',
                null,
                'New England only',
                ECONOMY,
                'groups',
                new List<String>{ newEngland.Id }
            );
            System.assertEquals(GridViews.WITH_GROUPS, region.sharing);
            System.assertEquals('Sales New England', region.groups[0].name);
            System.assertEquals('Public Groups', region.groups[0].typeLabel);
        }
        System.runAs(peer()) {
            List<GridViews.View> seen = listed();
            System.assertEquals(new List<String>{ 'Everyone sees this', 'New England only' }, names(seen));
            System.assertEquals(false, seen[0].mine);
            System.assertEquals('Harriet Hathaway', seen[0].ownerName);
            GridViews.View read = GridController.readView('Consignments', everyone.id);
            System.assertEquals(BIG, read.view, 'Read in full.');
            System.assertEquals(null, read.sharing, 'Who else sees it is its owner\'s business.');
            List<String> refusals = new List<String>();
            try {
                GridViews.save('Consignments', everyone.id, 'Mine now', null, null, null);
            } catch (GridException e) {
                refusals.add(e.getMessage());
            }
            try {
                GridViews.share('Consignments', everyone.id, 'me', null);
            } catch (GridException e) {
                refusals.add(e.getMessage());
            }
            try {
                GridViews.remove('Consignments', everyone.id);
            } catch (GridException e) {
                refusals.add(e.getMessage());
            }
            System.assertEquals(3, refusals.size(), String.valueOf(refusals));
            for (String r : refusals) {
                System.assert(r.startsWith('Only the view\'s owner can change it.'), r);
            }
            GridViews.View copy = GridViews.save('Consignments', null, 'Everyone sees this', read.view, null, null);
            System.assertEquals(true, copy.mine, 'Clone: a copy of their own, under the same name if they like.');
        }
        System.runAs(GridTestUsers.built(GridTestUsers.LIMITED)) {
            System.assertEquals(
                new List<String>{ 'Everyone sees this' },
                names(listed()),
                'Someone outside the group sees only the view shared with all users.'
            );
        }
        System.runAs(admin()) {
            GridViews.View back = GridController.shareView('Consignments', region.id, 'me', null);
            System.assertEquals(GridViews.ONLY_ME, back.sharing);
            System.assertEquals(0, back.groups.size());
        }
        System.runAs(peer()) {
            System.assertEquals(
                new List<String>{ 'Everyone sees this', 'Everyone sees this' },
                names(listed()),
                'No longer shared: gone from the list (theirs and the copy remain).'
            );
        }
    }

    @IsTest
    static void groupsToShareWithAreRolesAndPublicGroups() {
        UserRole role;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new Group(Name = 'Sales New England', Type = 'Regular');
            role = new UserRole(Name = 'Sales Rep, Portland');
            insert role;
        }
        System.runAs(admin()) {
            Set<String> types = new Set<String>();
            for (Map<String, String> t : GridController.viewGroupTypes()) {
                types.add(t.get('value'));
                System.assertEquals(GridViews.GROUP_TYPES.get(t.get('value')), t.get('label'));
            }
            System.assert(types.contains('Regular') && types.contains('Role'), String.valueOf(types));
            System.assert(
                !(types.contains('RoleAndSubordinates') && types.contains('RoleAndSubordinatesInternal')),
                'One kind of subordinates, as Salesforce offers.'
            );
            List<GridViews.ShareGroup> found = GridController.searchViewGroups('Regular', 'new eng');
            System.assertEquals(1, found.size());
            System.assertEquals('Sales New England', found[0].name);
            List<GridViews.ShareGroup> roles = GridController.searchViewGroups('Role', 'Portland');
            System.assertEquals(1, roles.size());
            System.assertEquals('Sales Rep, Portland', roles[0].name, 'A role\'s group by the role\'s name.');
            System.assertEquals(0, GridController.searchViewGroups('Regular', '%').size(), 'Wildcards are text.');

            GridViews.View saved = GridViews.save(
                'Consignments',
                null,
                'Portland reps',
                BIG,
                'groups',
                new List<String>{ roles[0].id }
            );
            System.assertEquals('Sales Rep, Portland', saved.groups[0].name);
            System.assertEquals('Roles', saved.groups[0].typeLabel);

            List<String> refusals = new List<String>();
            for (
                List<String> bad : new List<List<String>>{
                    new List<String>(),
                    new List<String>{ 'not an Id' },
                    new List<String>{ UserInfo.getUserId() }
                }
            ) {
                try {
                    GridViews.share('Consignments', saved.id, 'groups', bad);
                    refusals.add('accepted ' + bad);
                } catch (GridException e) {
                    refusals.add(e.getMessage());
                }
            }
            System.assert(refusals[0].startsWith('Choose at least one group'), refusals[0]);
            System.assert(refusals[1].startsWith('Not a group'), refusals[1]);
            System.assert(
                refusals[2].contains('only with roles and public groups'),
                'A user is not a group: ' + refusals[2]
            );
            try {
                GridController.searchViewGroups('Queue', 'Support');
                System.assert(false, 'Only the kinds a view can be shared with.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('kind of group'), e.getMessage());
            }
            try {
                GridViews.share('Consignments', saved.id, 'everyone', null);
                System.assert(false, 'Only me, all or groups.');
            } catch (GridException e) {
                System.assertEquals('Choose who sees this view.', e.getMessage());
            }
        }
    }

    @IsTest
    static void whatAViewKeepsMustFitTheGrid() {
        System.runAs(full()) {
            Map<String, List<String>> refused = new Map<String, List<String>>{
                'Enter a view name.' => new List<String>{ ' ', BIG },
                'A view name is 80 characters at most.' => new List<String>{ 'x'.repeat(81), BIG },
                'There is no view to save.' => new List<String>{ 'Empty', '' },
                'A view must be a JSON object.' => new List<String>{ 'Not JSON', '[1,2]' },
                'A view\'s filters must be a list.' => new List<String>{ 'Bad filters', '{"filters":"Pieces"}' },
                'Cannot filter by Weight__c.' => new List<String>{
                    'Not a column of the grid',
                    '{"filters":[{"field":"Weight__c","operator":"greater_than","value":"500"}]}'
                },
                'Cannot filter by Id.' => new List<String>{
                    'Not a column',
                    '{"filters":[{"field":"Id","operator":"equals","value":"a00"}]}'
                },
                'The filter logic references an undefined filter: 2.' => new List<String>{
                    'Bad logic',
                    '{"filters":[{"field":"Pieces__c","operator":"is_blank"}],"logic":"1 OR 2"}'
                },
                'A view\'s filter logic must be text.' => new List<String>{
                    'Logic a number',
                    '{"filters":[{"field":"Pieces__c","operator":"is_blank"}],"logic":1}'
                }
            };
            for (String message : refused.keySet()) {
                List<String> attempt = refused.get(message);
                try {
                    GridViews.save('Consignments', null, attempt[0], attempt[1], null, null);
                    System.assert(false, 'Refused: ' + message);
                } catch (GridException e) {
                    System.assert(e.getMessage().startsWith(message), message + ' / ' + e.getMessage());
                }
            }
            try {
                GridViews.save(
                    'Consignments',
                    null,
                    'Too long',
                    '{"x":"' + 'y'.repeat(GridViews.MAX_LENGTH) + '"}',
                    null,
                    null
                );
                System.assert(false, 'Too long.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains(String.valueOf(GridViews.MAX_LENGTH)), e.getMessage());
            }
            try {
                GridViews.save('No_Such_Grid', null, 'Nowhere', BIG, null, null);
                System.assert(false, 'Only a view of a grid that exists.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('No Grid Configuration named'), e.getMessage());
            }
            try {
                GridViews.read('Consignments', UserInfo.getUserId());
                System.assert(false, 'Only a Grid View Id.');
            } catch (GridException e) {
                System.assertEquals('This view was deleted, or is no longer shared with you.', e.getMessage());
            }
            System.assertEquals(0, [SELECT COUNT() FROM Grid_View__c], 'Nothing refused was saved.');
            String fine = '{"filters":[{"field":"Pieces__c","operator":"is_blank"},{"field":"Pieces__c","operator":"greater_than","value":"20"}],"logic":"1 or 2"}';
            System.assertEquals(fine, GridViews.save('Consignments', null, 'Blank or big', fine, null, null).view);
        }
    }

    @IsTest
    static void aUserSavesAtMostAHundredViewsOfAGrid() {
        System.runAs(full()) {
            List<Grid_View__c> many = new List<Grid_View__c>();
            for (Integer i = 0; i < GridViews.MAX_OWN_VIEWS; i++) {
                many.add(new Grid_View__c(Name = 'Route ' + i, Grid__c = 'Consignments', View__c = '{}'));
            }
            insert many;
            try {
                GridViews.save('Consignments', null, 'One more', BIG, null, null);
                System.assert(false, 'The most is ' + GridViews.MAX_OWN_VIEWS + '.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Delete one first'), e.getMessage());
            }
        }
    }

    /** The names of the rows openGrid's first page has. */
    private static List<String> firstPage(Map<String, Object> opened) {
        List<String> out = new List<String>();
        for (
            Map<String, Object> r : (List<Map<String, Object>>) ((Map<String, Object>) opened.get('page')).get('rows')
        ) {
            out.add((String) r.get('Name'));
        }
        out.sort();
        return out;
    }

    @IsTest
    static void aGridOpensOnThePinnedViewNarrowedByItsFilters() {
        System.runAs(full()) {
            GridViews.View big = GridViews.save('Consignments', null, 'Big shipments', BIG, null, null);
            GridViews.View economy = GridViews.save('Consignments', null, 'Economy only', ECONOMY, null, null);
            Map<String, Object> opened = GridController.openGrid('Consignments', null, null, null, null, null);
            System.assertEquals(null, opened.get('view'), 'Nothing pinned: the grid as the admin built it.');
            System.assertEquals(3, firstPage(opened).size());

            GridLayouts.save('Consignments', '{"v":1,"pin":"' + big.id + '"}');
            opened = GridController.openGrid('Consignments', null, null, null, null, null);
            System.assertEquals(big.id, ((GridViews.View) opened.get('view')).id, 'The pinned view.');
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington', 'Paper rolls, Bangor' },
                firstPage(opened)
            );
            Map<String, Object> start = (Map<String, Object>) opened.get('start');
            System.assertEquals(1, ((List<Map<String, Object>>) start.get('filters')).size());
            System.assertEquals(new List<String>(), (List<String>) start.get('groupBy'), 'Kept with no grouping.');

            opened = GridController.openGrid('Consignments', null, null, null, null, economy.id);
            System.assertEquals(economy.id, ((GridViews.View) opened.get('view')).id, 'The view asked for wins.');
            System.assertEquals(new List<String>{ 'Apple crates, Springfield' }, firstPage(opened));

            // An unsaved change to the pinned view, and the user's own sort of it, from their layout.
            String draft = '{"filters":[{"field":"Pieces__c","operator":"less_than","value":"20"}],"grouping":[]}';
            GridLayouts.save(
                'Consignments',
                '{"v":1,"pin":"' +
                    big.id +
                    '","views":{"' +
                    big.id +
                    '":{"sort":[{"field":"Name","direction":"desc"}],"draft":' +
                    draft +
                    '}}}'
            );
            opened = GridController.openGrid('Consignments', null, null, null, null, null);
            start = (Map<String, Object>) opened.get('start');
            System.assertEquals('desc', start.get('sortDirection'), 'Their own sort of the view.');
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield', 'Maple syrup, Burlington' },
                firstPage(opened),
                'The draft.'
            );

            GridViews.remove('Consignments', big.id);
            opened = GridController.openGrid('Consignments', null, null, null, null, null);
            System.assertEquals(null, opened.get('view'), 'A pinned view that was deleted: as the admin built it.');
            System.assertEquals(null, opened.get('viewError'), 'Quietly: nobody asked for it by name.');
            opened = GridController.openGrid('Consignments', null, null, null, null, big.id);
            System.assertEquals(
                'The view you opened was deleted, or is no longer shared with you.',
                opened.get('viewError')
            );
            System.assertEquals(3, firstPage(opened).size());
        }
    }

    @IsTest
    static void aFilterThatNoLongerFitsIsLeftOutWhenTheViewOpens() {
        System.runAs(full()) {
            // Saved when it fitted; written here as it is now, past the checks on save.
            Grid_View__c old = new Grid_View__c(
                Name = 'Heavy loads',
                Grid__c = 'Consignments',
                View__c = '{"filters":[{"field":"Weight__c","operator":"greater_than","value":"500"},' +
                    '{"field":"Pieces__c","operator":"greater_than","value":"20"},"not a filter"],"logic":"1 OR 2"}'
            );
            insert old;
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            Map<String, Object> start = GridViews.startOf(def, old.View__c, null);
            System.assertEquals(1, ((List<Map<String, Object>>) start.get('filters')).size(), 'Only Pieces is left.');
            System.assertEquals(null, start.get('logic'), 'Its numbers no longer match, so the logic goes too.');
            List<String> notes = (List<String>) start.get('notes');
            System.assertEquals(2, notes.size(), String.valueOf(notes));
            System.assert(notes[0].startsWith('Cannot filter by Weight__c'), notes[0]);

            Map<String, Object> opened = GridController.openGrid('Consignments', null, null, null, null, old.Id);
            System.assertEquals(new List<String>{ 'Paper rolls, Bangor' }, firstPage(opened));

            start = GridViews.startOf(
                def,
                '{"filters":[{"field":"Pieces__c","operator":"is_blank"}],"logic":"1 AND 1 AND"}',
                null
            );
            System.assertEquals(null, start.get('logic'), 'Logic that can\'t be read is left out, with a note.');
            System.assertEquals(1, ((List<String>) start.get('notes')).size());
        }
    }

    @IsTest
    static void theLayoutSaysWhichViewIsPinned() {
        System.runAs(full()) {
            GridViews.View big = GridViews.save('Consignments', null, 'Big shipments', BIG, null, null);
            GridLayouts.save('Consignments', '{"v":1,"pin":"' + big.id + '"}');
            System.assertEquals(big.id, GridLayouts.pinned('{"v":1,"pin":"' + big.id + '"}'));
            System.assertEquals(null, GridLayouts.pinned('{"pin":7}'));
            System.assertEquals(null, GridLayouts.pinned('not json'));
            System.assertEquals(null, GridLayouts.viewState('{"views":[]}', big.id));
        }
    }

    @IsTest
    static void aGridAdminSeesEveryViewAndCanDeleteAny() {
        GridViews.View mine;
        GridViews.View everyone;
        System.runAs(full()) {
            mine = GridViews.save('Consignments', null, 'Big shipments', BIG, null, null);
        }
        System.runAs(admin()) {
            everyone = GridViews.save('Consignments', null, 'Economy only', ECONOMY, 'all', null);
        }
        System.runAs(GridTestUsers.built(GridTestUsers.ADMIN_VIEWER)) {
            List<GridViews.View> every = GridAdminController.gridViews('Consignments');
            System.assertEquals(new List<String>{ 'Big shipments', 'Economy only' }, names(every), 'Private ones too.');
            System.assertEquals('Abigail Coffin', every[0].ownerName);
            System.assertEquals(GridViews.ONLY_ME, every[0].sharing);
            System.assertEquals(GridViews.ALL_USERS, every[1].sharing);
            System.assertEquals(null, every[0].view, 'Not what they keep.');
            System.assertEquals(false, every[0].mine);
            GridAdminController.deleteGridView('Consignments', mine.id);
            System.assertEquals(
                new List<String>{ 'Economy only' },
                names(GridAdminController.gridViews('Consignments'))
            );
            try {
                GridViews.save('Consignments', everyone.id, 'Renamed by an admin', null, null, null);
                System.assert(false, 'Deleting, yes; changing someone else\'s view, no.');
            } catch (GridException e) {
                System.assert(e.getMessage().startsWith('Only the view\'s owner'), e.getMessage());
            }
        }
        System.runAs(full()) {
            try {
                GridAdminController.gridViews('Consignments');
                System.assert(false, 'Only for Rowhouse Grid Admin.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
            try {
                GridViews.removeAny('Consignments', everyone.id);
                System.assert(false, 'Salesforce refuses a user without Modify All.');
            } catch (Exception e) {
                System.assertEquals(1, [SELECT COUNT() FROM Grid_View__c WHERE Id = :everyone.id], 'Still there.');
            }
        }
    }
}
