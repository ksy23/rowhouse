/**
 * GridPaths — a column's field on a parent record, named by a path through
 * lookups, as a report or a formula names it: Account.Industry on a Contact
 * grid, Account.Owner.Email two lookups away, up to MAX_HOPS lookups.
 *
 * A name without a dot is a field of the grid's own object, and resolves to
 * a path of no hops, so callers handle both alike:
 *   local         how the grid keys the column and its values (HR-4: local
 *                 names), "Account.Industry";
 *   soql          the same in API names, for SELECT, WHERE, ORDER BY and
 *                 GROUP BY, all of which take a path (measured in a Developer
 *                 Edition org, cursors included);
 *   field         the field at the end, for its type, label and describe;
 *   holder        the object whose record holds that field;
 *   holderIdSoql  where a row's holder record Id is read: "AccountId",
 *                 "Account.OwnerId"; "Id" for the grid's own object.
 *
 * Every lookup on the way must point to one kind of record: a lookup that
 * can point to several (an owner that can be a queue, a task's What) is
 * refused, as a grid formula refuses it. Whether the user may read or edit
 * the path is GridSecurity's to say (canReadPath, canEditPath).
 */
public with sharing class GridPaths {
    /** The most lookups a column may reach through. */
    public static final Integer MAX_HOPS = 5;

    public class FieldPath {
        public String local;
        public String soql;
        /** The lookups followed, in order; empty for a field of the grid's own object. */
        public List<Schema.SObjectField> hops = new List<Schema.SObjectField>();
        /** Their relationship names, as SOQL spells them. */
        public List<String> relationships = new List<String>();
        public Schema.SObjectField field;
        public Schema.SObjectType holder;
        public String holderIdSoql;
        public String holderIdLocal;

        public Boolean isPath() {
            return !hops.isEmpty();
        }
    }

    /** Does the name reach through a lookup? */
    public static Boolean isPath(String name) {
        return String.isNotBlank(name) && name.contains('.');
    }

    /**
     * The path a column names, from the grid's object. Throws, in an
     * admin's terms, for a lookup that is not there, one that can point to
     * more than one kind of record, a path more than MAX_HOPS lookups long, or
     * a field the last record does not have.
     */
    public static FieldPath resolve(Schema.SObjectType objectType, String name) {
        FieldPath p = new FieldPath();
        if (!isPath(name)) {
            p.field = GridDescribe.field(objectType, name);
            p.local = GridDescribe.localName(p.field);
            p.soql = GridDescribe.apiName(p.field);
            p.holder = objectType;
            p.holderIdSoql = 'Id';
            p.holderIdLocal = 'Id';
            return p;
        }
        List<String> steps = name.trim().split('\\.');
        if (steps.size() - 1 > MAX_HOPS) {
            throw new GridException(
                name + ' reaches ' + (steps.size() - 1) + ' lookups away; a column can reach at most ' + MAX_HOPS + '.'
            );
        }
        Schema.SObjectType current = objectType;
        List<String> localSteps = new List<String>();
        for (Integer i = 0; i < steps.size() - 1; i++) {
            Schema.SObjectField lookup = lookupNamed(current, steps[i].trim());
            if (lookup == null) {
                throw new GridException(
                    GridDescribe.localName(current) + ' has no lookup called ' + steps[i].trim() + ' (in ' + name + ').'
                );
            }
            Schema.DescribeFieldResult d = lookup.getDescribe();
            if (d.getReferenceTo().size() != 1 || d.isNamePointing()) {
                throw new GridException(
                    d.getLabel() +
                        ' can point to more than one kind of record (such as a user or a queue), so a column cannot reach through it (in ' +
                        name +
                        ').'
                );
            }
            p.hops.add(lookup);
            p.relationships.add(d.getRelationshipName());
            localSteps.add(withoutNamespace(d.getRelationshipName()));
            current = d.getReferenceTo()[0];
        }
        p.field = GridDescribe.field(current, steps[steps.size() - 1]);
        p.holder = current;
        p.local = String.join(localSteps, '.') + '.' + GridDescribe.localName(p.field);
        p.soql = String.join(p.relationships, '.') + '.' + GridDescribe.apiName(p.field);
        Schema.SObjectField last = p.hops[p.hops.size() - 1];
        if (p.hops.size() == 1) {
            p.holderIdSoql = GridDescribe.apiName(last);
            p.holderIdLocal = GridDescribe.localName(last);
        } else {
            List<String> before = new List<String>();
            List<String> beforeLocal = new List<String>();
            for (Integer i = 0; i < p.hops.size() - 1; i++) {
                before.add(p.relationships[i]);
                beforeLocal.add(localSteps[i]);
            }
            p.holderIdSoql = String.join(before, '.') + '.' + GridDescribe.apiName(last);
            p.holderIdLocal = String.join(beforeLocal, '.') + '.' + GridDescribe.localName(last);
        }
        return p;
    }

    /**
     * The column heading a path gets when the admin gives none, as a report
     * names a field from a related record: "Account: Industry",
     * "Account: Owner: Email".
     */
    public static String defaultLabel(FieldPath p) {
        List<String> parts = new List<String>();
        for (Schema.SObjectField hop : p.hops) {
            parts.add(GridConfig.defaultLabel(hop.getDescribe()));
        }
        parts.add(GridConfig.defaultLabel(p.field.getDescribe()));
        return String.join(parts, ': ');
    }

    /** A row's value at the end of the path; null where a record on the way is blank. */
    public static Object valueAt(SObject row, FieldPath p) {
        SObject current = holderOf(row, p);
        return current == null ? null : current.get(p.field);
    }

    /** The Id of the record that holds the path's field for this row; null where a lookup on the way is blank. */
    public static Id holderIdAt(SObject row, FieldPath p) {
        if (!p.isPath()) {
            return row.Id;
        }
        SObject current = row;
        for (Integer i = 0; i < p.hops.size() - 1; i++) {
            current = current.getSObject(p.relationships[i]);
            if (current == null) {
                return null;
            }
        }
        return (Id) current.get(p.hops[p.hops.size() - 1]);
    }

    /** The record at the end of the lookups, as the row carries it; null where one is blank. */
    private static SObject holderOf(SObject row, FieldPath p) {
        SObject current = row;
        for (String relationship : p.relationships) {
            if (current == null) {
                return null;
            }
            current = current.getSObject(relationship);
        }
        return current;
    }

    /** The lookup field whose relationship is named so (Account, Lookup_Field__r), with or without the namespace. */
    private static Schema.SObjectField lookupNamed(Schema.SObjectType objectType, String relationshipName) {
        String wanted = withoutNamespace(relationshipName).toLowerCase();
        for (Schema.SObjectField f : GridDescribe.fieldsFor(GridDescribe.apiName(objectType)).values()) {
            Schema.DescribeFieldResult d = f.getDescribe();
            if (
                d.getType() == Schema.DisplayType.REFERENCE &&
                d.getRelationshipName() != null &&
                withoutNamespace(d.getRelationshipName()).toLowerCase() == wanted
            ) {
                return f;
            }
        }
        return null;
    }

    /** HR-4: a relationship's name without this package's namespace. */
    public static String withoutNamespace(String name) {
        String ns = GridDescribe.NAMESPACE;
        return String.isNotBlank(ns) && name.toLowerCase().startsWith(ns.toLowerCase() + '__')
            ? name.substring(ns.length() + 2)
            : name;
    }
}
