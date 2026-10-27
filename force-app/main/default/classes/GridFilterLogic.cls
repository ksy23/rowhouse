/**
 * GridFilterLogic — how a user's filters combine, as a list view's filter
 * logic: the filters are numbered 1, 2, 3… in the order the filter panel shows
 * them, and the logic joins the numbers with AND, OR and NOT and parentheses,
 * "1 AND (2 OR 3)". Without logic every filter must hold, as before.
 *
 * The logic comes from the browser, so nothing about it is trusted (HR-6): it
 * is parsed here into a tree of filter numbers and the three words, and only
 * that tree becomes SOQL, around conditions GridFilters has already checked
 * and bound. Anything else in the text refuses the request. As in Salesforce,
 * every filter must be used, a number must name a filter, and AND and OR at
 * the same level need parentheses ("1 AND 2 OR 3" is refused: it could mean
 * either).
 *
 * It applies to the user's own filters only: the admin's Grid Filters and the
 * page's record are joined to the result with AND, so filter logic can only
 * narrow what the grid shows.
 */
public with sharing class GridFilterLogic {
    /** Characters filter logic may have. */
    public static final Integer MAX_LENGTH = 255;

    /** One part of the logic: a filter, or AND or OR of parts, or NOT of one. */
    public class Node {
        /** filter, and, or, not. */
        public String op;
        /** For a filter: its place in the list, from 0. */
        public Integer index;
        public List<Node> parts = new List<Node>();
    }

    /**
     * The logic as a tree, for this many filters; null when there is no logic
     * (or no filters), so every filter must hold. Throws, in Salesforce's
     * words, when the logic cannot be used.
     */
    public static Node parse(String logic, Integer filterCount) {
        if (String.isBlank(logic) || filterCount == null || filterCount == 0) {
            return null;
        }
        if (logic.length() > MAX_LENGTH) {
            throw new GridException('Filter logic is ' + MAX_LENGTH + ' characters at most.');
        }
        Parser p = new Parser(tokens(logic), filterCount);
        Node root = p.expression();
        if (p.at < p.tokens.size()) {
            throw new GridException(')'.equals(p.tokens[p.at]) ? 'Your filter is missing a parenthesis.' : SPELLING);
        }
        Set<Integer> used = new Set<Integer>();
        collect(root, used);
        if (used.size() < filterCount) {
            throw new GridException('Some filter conditions are defined but not referenced in your filter logic.');
        }
        return root;
    }

    /**
     * The tree as SOQL, around each filter's own condition (clauses, in the
     * filters' order). Each part is in parentheses, so nothing in a condition
     * can change how the words join.
     */
    public static String soql(Node node, List<String> clauses) {
        if (node.op == 'filter') {
            return '(' + clauses[node.index] + ')';
        }
        if (node.op == 'not') {
            return '(NOT ' + soql(node.parts[0], clauses) + ')';
        }
        List<String> parts = new List<String>();
        for (Node part : node.parts) {
            parts.add(soql(part, clauses));
        }
        return '(' + String.join(parts, node.op == 'and' ? ' AND ' : ' OR ') + ')';
    }

    /** The logic in a standard spelling, "1 AND (2 OR NOT 3)", as the grid shows it. */
    public static String spelled(Node node) {
        return spelled(node, true);
    }

    private static String spelled(Node node, Boolean top) {
        if (node.op == 'filter') {
            return String.valueOf(node.index + 1);
        }
        if (node.op == 'not') {
            return 'NOT ' + spelled(node.parts[0], false);
        }
        List<String> parts = new List<String>();
        for (Node part : node.parts) {
            parts.add(spelled(part, false));
        }
        String joined = String.join(parts, node.op == 'and' ? ' AND ' : ' OR ');
        return top ? joined : '(' + joined + ')';
    }

    private static final String SPELLING = 'Check the spelling in your filter logic.';

    private static void collect(Node node, Set<Integer> used) {
        if (node.op == 'filter') {
            used.add(node.index);
        }
        for (Node part : node.parts) {
            collect(part, used);
        }
    }

    /** Numbers, AND, OR, NOT and parentheses; anything else is a spelling mistake. */
    private static List<String> tokens(String logic) {
        List<String> out = new List<String>();
        String text = logic.toUpperCase();
        Integer i = 0;
        while (i < text.length()) {
            String ch = text.substring(i, i + 1);
            if (ch.isWhitespace()) {
                i++;
            } else if (ch == '(' || ch == ')') {
                out.add(ch);
                i++;
            } else if (ch.isNumeric() || ch.isAlpha()) {
                Integer j = i;
                Boolean digits = ch.isNumeric();
                while (j < text.length()) {
                    String next = text.substring(j, j + 1);
                    if (digits ? !next.isNumeric() : !next.isAlpha()) {
                        break;
                    }
                    j++;
                }
                String word = text.substring(i, j);
                if (!digits && word != 'AND' && word != 'OR' && word != 'NOT') {
                    throw new GridException(SPELLING);
                }
                out.add(word);
                i = j;
            } else {
                throw new GridException(SPELLING);
            }
        }
        return out;
    }

    /** expression := term ((AND | OR) term)*, one word per level; term := NOT term | ( expression ) | number. */
    private class Parser {
        public List<String> tokens;
        public Integer count;
        public Integer at = 0;

        public Parser(List<String> tokens, Integer count) {
            this.tokens = tokens;
            this.count = count;
        }

        public Node expression() {
            Node first = term();
            String word = null;
            Node joined = null;
            while (at < tokens.size() && (tokens[at] == 'AND' || tokens[at] == 'OR')) {
                String next = tokens[at] == 'AND' ? 'and' : 'or';
                if (word != null && word != next) {
                    throw new GridException(
                        'Your filter must use parentheses around successive AND and OR expressions.'
                    );
                }
                if (joined == null) {
                    joined = new Node();
                    joined.op = next;
                    joined.parts.add(first);
                }
                word = next;
                at++;
                joined.parts.add(term());
            }
            return joined == null ? first : joined;
        }

        public Node term() {
            if (at >= tokens.size()) {
                throw new GridException(SPELLING);
            }
            String token = tokens[at];
            if (token == 'NOT') {
                at++;
                Node n = new Node();
                n.op = 'not';
                n.parts.add(term());
                return n;
            }
            if (token == '(') {
                at++;
                Node nested = expression();
                if (at >= tokens.size() || tokens[at] != ')') {
                    throw new GridException('Your filter is missing a parenthesis.');
                }
                at++;
                return nested;
            }
            if (token.isNumeric()) {
                at++;
                Integer n = token.length() > 3 ? 1000 : Integer.valueOf(token);
                if (n < 1 || n > count) {
                    throw new GridException('The filter logic references an undefined filter: ' + token + '.');
                }
                Node f = new Node();
                f.op = 'filter';
                f.index = n - 1;
                return f;
            }
            throw new GridException(SPELLING);
        }
    }
}
