/**
 * DEVELOPMENT ONLY. Never packaged.
 * The users the suite runs as, built the same way in every test class.
 * Created inside the test, never by seed.sh: package version creation runs the
 * suite in a fresh build org where no script ran, and where the admin running
 * the tests has no field access to the test metadata at all.
 *
 *   limitedUser() — deliberately restricted (Rowhouse_Test_Limited). The access
 *                   tests run as this user.
 *   fullUser()    — every test field, through permission sets alone
 *                   (Rowhouse_Test_Full). Tests that are NOT about access run
 *                   as this user, so they depend on nothing the org's admin
 *                   happens to have.
 *   peerUser()    — fullUser()'s access, as a second person: the sharing tests'
 *                   other user, who must not see what fullUser() owns on the
 *                   Private test object unless it is shared.
 *   readOnlyUser() — reads the test records but may not edit, create or delete
 *                   them (Rowhouse_Test_Read_Only); reads the test children but
 *                   not their Amount.
 *   diagnosticsUser() — fullUser() plus Rowhouse_Diagnostics, for the action
 *                   that requires that custom permission.
 *   noLogUser()   — fullUser()'s test-field access WITHOUT Rowhouse_User, so
 *                   it cannot write the audit log.
 *   adminUser()   — a System Administrator with Rowhouse_Admin: builds and
 *                   saves grid configurations.
 *   adminViewer() — Rowhouse_Admin on a Standard User, without Customize
 *                   Application: may open the Grid Admin tab, may not save.
 *   limitedAdmin() — Rowhouse_Admin with limitedUser()'s field access, for
 *                   what an admin who cannot read a field is told.
 * All but noLogUser() hold Rowhouse_User, the product's own permission set.
 * A class that builds its users in @TestSetup finds them again with built(),
 * by the alias each one is built with (LIMITED, FULL, PEER and so on).
 *
 * plain() and qualified() let a test run with or without the package's
 * namespace: the dev org has none, a package build org has 'rowhouse', where
 * a deployed record is rowhouse__Grid_Column__mdt.X and a field
 * rowhouse__Child_Table__c.
 */
@IsTest
public class GridTestUsers {
    /** This code's namespace: blank in the dev org, 'rowhouse' in a package build. */
    public static final String NAMESPACE = GridTestUsers.class.getName().contains('.')
        ? GridTestUsers.class.getName().substringBefore('.')
        : '';

    /** The alias each user is built with, for built(). */
    public static final String LIMITED = 'rhltd';
    public static final String FULL = 'rhfull';
    public static final String PEER = 'rhpeer';
    public static final String READ_ONLY = 'rhro';
    public static final String DIAGNOSTICS = 'rhdiag';
    public static final String NO_LOG = 'rhnolog';
    public static final String ADMIN = 'rhadmin';
    public static final String ADMIN_VIEWER = 'rhadmv';

    /** A name without the namespace: rowhouse__Grid_Column__mdt.X becomes Grid_Column__mdt.X. */
    public static String plain(String name) {
        if (name == null || String.isBlank(NAMESPACE)) {
            return name;
        }
        String prefix = NAMESPACE + '__';
        return name.startsWithIgnoreCase(prefix) ? name.substring(prefix.length()) : name;
    }

    /** A custom field's name as the org spells it: Child_Table__c, or rowhouse__Child_Table__c in a package build. */
    public static String qualified(String name) {
        if (
            String.isBlank(NAMESPACE) ||
            name == null ||
            !name.endsWithIgnoreCase('__c') ||
            name.startsWithIgnoreCase(NAMESPACE + '__')
        ) {
            return name;
        }
        return NAMESPACE + '__' + name;
    }

    public static User limitedUser() {
        return userWith(LIMITED, 'Limited', new List<String>{ 'Rowhouse_Test_Limited', 'Rowhouse_User' });
    }

    public static User fullUser() {
        return userWith(FULL, 'Full', new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User' });
    }

    /** A second user with fullUser()'s access, for what one user must not see of another's. */
    public static User peerUser() {
        return userWith(PEER, 'Peer', new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User' });
    }

    /** Reads the test records, never edits, creates or deletes them; reads the children but not their Amount. */
    public static User readOnlyUser() {
        return userWith(READ_ONLY, 'ReadOnly', new List<String>{ 'Rowhouse_Test_Read_Only', 'Rowhouse_User' });
    }

    /** fullUser() with the Rowhouse_Diagnostics custom permission, which one fixture action requires. */
    public static User diagnosticsUser() {
        return userWith(
            DIAGNOSTICS,
            'Diagnostics',
            new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User', 'Rowhouse_Diagnostics' }
        );
    }

    /** Every test field, but not Rowhouse_User: no access to the audit log. */
    public static User noLogUser() {
        return userWith(NO_LOG, 'NoLog', new List<String>{ 'Rowhouse_Test_Full' });
    }

    /**
     * A Salesforce admin with Rowhouse Grid Admin: the System
     * Administrator profile holds Customize Application, which saving a grid
     * needs.
     */
    public static User adminUser() {
        return userWith(
            ADMIN,
            'Admin',
            new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User', 'Rowhouse_Admin' },
            'System Administrator'
        );
    }

    /** Rowhouse Grid Admin with the restricted field access of limitedUser(): fields hidden from the admin. */
    public static User limitedAdmin() {
        return userWith(
            'rhladm',
            'LimitedAdmin',
            new List<String>{ 'Rowhouse_Test_Limited', 'Rowhouse_User', 'Rowhouse_Admin' }
        );
    }

    /** Rowhouse Grid Admin without Customize Application: may open the Grid Admin tab, may not save. */
    public static User adminViewer() {
        return userWith(
            ADMIN_VIEWER,
            'AdminViewer',
            new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User', 'Rowhouse_Admin' }
        );
    }

    /**
     * The user this class built with the alias (LIMITED, FULL...), for a test
     * whose @TestSetup built it: the newest, and only a user built here, whose
     * username is rowhouse.<alias>.<number>@example.invalid, never a real user
     * of the org who shares the alias. Fails, by name, when there is none.
     */
    public static User built(String alias) {
        String username = 'rowhouse.' + alias + '.%@example.invalid';
        List<User> found = [
            SELECT Id, Alias, LastName
            FROM User
            WHERE Username LIKE :username AND IsActive = TRUE
            ORDER BY CreatedDate DESC, Id DESC
            LIMIT 1
        ];
        System.assert(!found.isEmpty(), 'No test user ' + alias + ': build it in @TestSetup through GridTestUsers.');
        return found[0];
    }

    private static User userWith(String alias, String lastName, List<String> permissionSetNames) {
        return userWith(alias, lastName, permissionSetNames, 'Standard User');
    }

    private static User userWith(String alias, String lastName, List<String> permissionSetNames, String profileName) {
        String name = 'rowhouse.' + alias + '.' + Crypto.getRandomInteger() + '@example.invalid';
        User u = new User(
            Alias = alias,
            Email = name,
            Username = name,
            LastName = lastName,
            FirstName = 'Rowhouse',
            ProfileId = [SELECT Id FROM Profile WHERE Name = :profileName LIMIT 1]
            .Id,
            TimeZoneSidKey = 'America/New_York',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (PermissionSet ps : [SELECT Id FROM PermissionSet WHERE Name IN :permissionSetNames]) {
            assignments.add(new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id));
        }
        // Fail here, by name, rather than as a baffling access error later.
        System.assertEquals(
            permissionSetNames.size(),
            assignments.size(),
            'Missing permission set; expected ' + permissionSetNames + ' to be deployed.'
        );
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert assignments;
        }
        return u;
    }
}
