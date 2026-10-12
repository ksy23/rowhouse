/**
 * GridFormulas — formulas the grid works out itself: formula
 * columns, and display rules whose condition is a formula.
 *
 * The syntax is a formula field's, evaluated with Apex FormulaEval, on the
 * server, for each row as the rows are read. Measured in a Developer Edition org (API 67):
 *   - Formula.builder() builds a formula for an object and a return type;
 *     a syntax error or an unknown field throws FormulaValidationException
 *     there, which an admin sees on the Grid Admin tab;
 *   - getReferencedFields() lists the SOQL paths the formula reads
 *     (Pieces__c, Shipper__r.Name, CreatedBy.FirstName); a path
 *     through a polymorphic lookup comes back as Owner:User.Name, which SOQL
 *     cannot select without TYPEOF, so such a formula is refused;
 *   - evaluating a row that lacks one of those fields throws, and so does a
 *     division by zero: such a row gets no value (a blank cell, a rule that
 *     does not match), never a failed page;
 *   - about 0.1 ms a row (56 rows in about 5 ms).
 *
 * What a formula may read is checked here with GridSecurity, every step of a
 * path: a user who cannot read one of them does not get the formula at all
 * (GridConfig.forUser), as with a column on a field they cannot read.
 */
public with sharing class GridFormulas {
    /** Formulas one grid may have, columns and rules together: a 2,000-row page stays well inside the CPU limit. */
    public static final Integer MAX_FORMULAS = 10;
    /** A formula column's key in the browser: a field name cannot start with an underscore. */
    public static final String KEY_PREFIX = '_fx_';
    /** What a formula column may return, by its Formula Type. */
    public static final Map<String, FormulaEval.FormulaReturnType> RETURN_TYPES = new Map<String, FormulaEval.FormulaReturnType>{
        'text' => FormulaEval.FormulaReturnType.STRING,
        'number' => FormulaEval.FormulaReturnType.DECIMAL,
        'currency' => FormulaEval.FormulaReturnType.DECIMAL,
        'percent' => FormulaEval.FormulaReturnType.DECIMAL,
        'date' => FormulaEval.FormulaReturnType.DATE,
        'datetime' => FormulaEval.FormulaReturnType.DATETIME,
        'checkbox' => FormulaEval.FormulaReturnType.BOOLEAN
    };

    /** A formula, built: the instance and the SOQL paths it reads. */
    public class Compiled {
        public FormulaEval.FormulaInstance instance;
        public List<String> paths = new List<String>();
    }

    /**
     * Build a formula for an object. Throws a GridException whose message is
     * the platform's own, in an admin's terms.
     */
    public static Compiled compile(
        Schema.SObjectType objectType,
        String source,
        FormulaEval.FormulaReturnType returnType
    ) {
        // The text is not called "formula": that name would hide the Formula class.
        if (String.isBlank(source)) {
            throw new GridException('it has no formula.');
        }
        Compiled c = new Compiled();
        try {
            c.instance = Formula.builder()
                .withType(objectType)
                .withReturnType(returnType)
                .withFormula(source.trim())
                .build();
        } catch (Exception e) {
            throw new GridException('the formula does not work: ' + e.getMessage());
        }
        for (String path : c.instance.getReferencedFields()) {
            if (path.contains(':')) {
                throw new GridException(
                    'the formula reads ' +
                        path +
                        ', a field through a lookup that can point to more than' +
                        ' one object (such as an owner). A grid formula cannot read those; use the lookup\'s Id instead.'
                );
            }
            c.paths.add(path);
        }
        c.paths.sort();
        return c;
    }

    /**
     * Can the running user read every step of a path, such as
     * Shipper__r.Owner.Name: each lookup, the object it points to, and
     * the field at the end? A field on the object itself is one step.
     */
    public static Boolean canRead(Schema.SObjectType objectType, String path) {
        Schema.SObjectType current = objectType;
        List<String> steps = path.split('\\.');
        for (Integer i = 0; i < steps.size() - 1; i++) {
            Schema.SObjectField lookup = lookupNamed(current, steps[i]);
            if (lookup == null || !GridSecurity.canRead(lookup)) {
                return false;
            }
            List<Schema.SObjectType> targets = lookup.getDescribe().getReferenceTo();
            if (targets.size() != 1 || !GridSecurity.canRead(targets[0])) {
                return false;
            }
            current = targets[0];
        }
        try {
            return GridSecurity.canRead(GridDescribe.field(current, steps[steps.size() - 1]));
        } catch (GridException e) {
            return false;
        }
    }

    /** Every path a list of formulas reads, each once. */
    public static Boolean canReadAll(Schema.SObjectType objectType, List<String> paths) {
        for (String path : paths) {
            if (!canRead(objectType, path)) {
                return false;
            }
        }
        return true;
    }

    /**
     * A path as SOQL must name it: each relationship and the field at the end
     * by their full API names. A formula names this package's own fields
     * without the namespace, and an Apex cursor over such a name fails in a
     * namespaced org with an internal error that no catch block stops
     * (measured), so the query always gets the full names. Every name in the
     * answer comes from describe: a step that cannot be resolved throws, and
     * nothing from the formula's text reaches the query as it was written.
     * (canRead has already refused such a path, so the grid never gets here
     * with one.)
     */
    public static String qualified(Schema.SObjectType objectType, String path) {
        Schema.SObjectType current = objectType;
        List<String> steps = path.split('\\.');
        List<String> out = new List<String>();
        for (Integer i = 0; i < steps.size() - 1; i++) {
            Schema.SObjectField lookup = lookupNamed(current, steps[i]);
            List<Schema.SObjectType> targets = lookup == null
                ? new List<Schema.SObjectType>()
                : lookup.getDescribe().getReferenceTo();
            if (targets.size() != 1) {
                throw new GridException(
                    'A formula reads ' + path + ', but ' + steps[i] + ' is not a lookup to one kind of record.'
                );
            }
            out.add(lookup.getDescribe().getRelationshipName());
            current = targets[0];
        }
        // GridDescribe.field throws, naming the field, when the last step is not one.
        out.add(GridDescribe.apiName(GridDescribe.field(current, steps[steps.size() - 1])));
        return String.join(out, '.');
    }

    /** The lookup field whose relationship is named so (Account, Shipper__r), or null. */
    private static Schema.SObjectField lookupNamed(Schema.SObjectType objectType, String relationshipName) {
        String wanted = GridDescribe.withoutNamespace(relationshipName);
        for (Schema.SObjectField f : GridDescribe.fieldsFor(GridDescribe.apiName(objectType)).values()) {
            Schema.DescribeFieldResult d = f.getDescribe();
            if (
                d.getType() == Schema.DisplayType.REFERENCE &&
                d.getRelationshipName() != null &&
                GridDescribe.withoutNamespace(d.getRelationshipName()).equalsIgnoreCase(wanted)
            ) {
                return f;
            }
        }
        return null;
    }

    /** A formula's value for one row, or null when the formula cannot be worked out for it. */
    public static Object evaluate(FormulaEval.FormulaInstance instance, SObject row) {
        if (instance == null || row == null) {
            return null;
        }
        try {
            return instance.evaluate(row);
        } catch (Exception e) {
            return null; // a missing value, a division by zero: a blank cell, never a failed page
        }
    }
}
