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
 *   diagnosticsUser() — fullUser() plus Rowhouse_Diagnostics, for the action
 *                   that requires that custom permission.
 *   noLogUser()   — fullUser()'s test-field access WITHOUT Rowhouse_User, so
 *                   it cannot write the audit log.
 *   adminUser()   — a System Administrator with Rowhouse_Admin: builds and
 *                   saves grid configurations.
 *   adminViewer() — Rowhouse_Admin on a Standard User, without Customize
 *                   Application: may open the Grid Admin tab, may not save.
 * All but noLogUser() hold Rowhouse_User, the product's own permission set.
 */
@IsTest
public class GridTestUsers {

    public static User limitedUser() {
        return userWith('rhltd', 'Limited', new List<String>{ 'Rowhouse_Test_Limited', 'Rowhouse_User' });
    }

    public static User fullUser() {
        return userWith('rhfull', 'Full', new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User' });
    }

    /** fullUser() with the Rowhouse_Diagnostics custom permission, which one fixture action requires. */
    public static User diagnosticsUser() {
        return userWith('rhdiag', 'Diagnostics', new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User', 'Rowhouse_Diagnostics' });
    }

    /** Every test field, but not Rowhouse_User: no access to the audit log. */
    public static User noLogUser() {
        return userWith('rhnolog', 'NoLog', new List<String>{ 'Rowhouse_Test_Full' });
    }

    /**
     * A Salesforce admin with Rowhouse Grid Admin: the System
     * Administrator profile holds Customize Application, which saving a grid
     * needs.
     */
    public static User adminUser() {
        return userWith('rhadmin', 'Admin', new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User', 'Rowhouse_Admin' },
            'System Administrator');
    }

    /** Rowhouse Grid Admin without Customize Application: may open the Grid Admin tab, may not save. */
    public static User adminViewer() {
        return userWith('rhadmv', 'AdminViewer', new List<String>{ 'Rowhouse_Test_Full', 'Rowhouse_User', 'Rowhouse_Admin' });
    }

    private static User userWith(String alias, String lastName, List<String> permissionSetNames) {
        return userWith(alias, lastName, permissionSetNames, 'Standard User');
    }

    private static User userWith(String alias, String lastName, List<String> permissionSetNames, String profileName) {
        String name = 'rowhouse.' + alias + '.' + Crypto.getRandomInteger() + '@example.invalid';
        User u = new User(
            Alias = alias, Email = name, Username = name, LastName = lastName, FirstName = 'Rowhouse',
            ProfileId = [SELECT Id FROM Profile WHERE Name = :profileName LIMIT 1].Id,
            TimeZoneSidKey = 'America/New_York', LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US'
        );
        insert u;
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (PermissionSet ps : [SELECT Id FROM PermissionSet WHERE Name IN :permissionSetNames]) {
            assignments.add(new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id));
        }
        // Fail here, by name, rather than as a baffling access error later.
        System.assertEquals(permissionSetNames.size(), assignments.size(),
            'Missing permission set; expected ' + permissionSetNames + ' to be deployed.');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert assignments;
        }
        return u;
    }
}
