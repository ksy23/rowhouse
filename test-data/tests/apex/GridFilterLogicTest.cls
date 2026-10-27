/**
 * DEVELOPMENT ONLY. Never packaged.
 * Filter logic as a list view's: what is accepted, how it reads, the SOQL it
 * becomes, and what is refused, in Salesforce's words.
 */
@IsTest
private class GridFilterLogicTest {
    @IsTest
    static void logicIsReadAsAListViewReadsIt() {
        Map<String, String> spelled = new Map<String, String>{
            '1 AND (2 OR 3)' => '1 AND (2 OR 3)',
            '1 and (2 or 3)' => '1 AND (2 OR 3)',
            '(1 OR 2) AND 3' => '(1 OR 2) AND 3',
            '((1)) OR NOT (2 AND 3)' => '1 OR NOT (2 AND 3)',
            '1 OR 2 OR 3' => '1 OR 2 OR 3',
            'NOT NOT 1 AND 2 AND 3' => 'NOT NOT 1 AND 2 AND 3',
            '1 AND 2 AND 3 AND 1' => '1 AND 2 AND 3 AND 1',
            '  1and(2or3)  ' => '1 AND (2 OR 3)'
        };
        for (String logic : spelled.keySet()) {
            System.assertEquals(spelled.get(logic), GridFilterLogic.spelled(GridFilterLogic.parse(logic, 3)), logic);
        }
        System.assertEquals(null, GridFilterLogic.parse('', 3), 'No logic: every filter must hold.');
        System.assertEquals(null, GridFilterLogic.parse(null, 3));
        System.assertEquals(null, GridFilterLogic.parse('1 OR 2', 0), 'No filters: nothing to join.');
    }

    @IsTest
    static void logicBecomesSoqlAroundEachFiltersOwnCondition() {
        List<String> clauses = new List<String>{ 'A = :x', 'B LIKE :y', '(C >= :z AND C <= :zb)' };
        System.assertEquals(
            '((A = :x) AND ((B LIKE :y) OR (NOT ((C >= :z AND C <= :zb)))))',
            GridFilterLogic.soql(GridFilterLogic.parse('1 AND (2 OR NOT 3)', 3), clauses)
        );
        System.assertEquals('(A = :x)', GridFilterLogic.soql(GridFilterLogic.parse('(((1)))', 1), clauses));
    }

    @IsTest
    static void logicThatCannotWorkIsRefusedInSalesforcesWords() {
        Map<String, String> refused = new Map<String, String>{
            '1 AND 2 OR 3' => 'Your filter must use parentheses around successive AND and OR expressions.',
            '1 AND (2 OR 3' => 'Your filter is missing a parenthesis.',
            '1 AND 2) OR 3' => 'Your filter is missing a parenthesis.',
            '1 AND 2' => 'Some filter conditions are defined but not referenced in your filter logic.',
            '1 AND 2 AND 4' => 'The filter logic references an undefined filter: 4.',
            '0 OR 1 OR 2 OR 3' => 'The filter logic references an undefined filter: 0.',
            '1 AND 2 AND 99999' => 'The filter logic references an undefined filter: 99999.',
            '1 & 2 & 3' => 'Check the spelling in your filter logic.',
            '1 AND 2 XOR 3' => 'Check the spelling in your filter logic.',
            '1 AND 2 AND' => 'Check the spelling in your filter logic.',
            '1 2 3' => 'Check the spelling in your filter logic.',
            '1 AND 2 AND 3; DELETE' => 'Check the spelling in your filter logic.',
            '1 AND 2 AND 3 OR Name != null' => 'Check the spelling in your filter logic.',
            '()' => 'Check the spelling in your filter logic.'
        };
        for (String logic : refused.keySet()) {
            try {
                GridFilterLogic.parse(logic, 3);
                System.assert(false, 'Refused: ' + logic);
            } catch (GridException e) {
                System.assertEquals(refused.get(logic), e.getMessage(), logic);
            }
        }
        try {
            GridFilterLogic.parse('1' + ' AND 1'.repeat(60), 1);
            System.assert(false, 'Too long.');
        } catch (GridException e) {
            System.assert(e.getMessage().contains(String.valueOf(GridFilterLogic.MAX_LENGTH)), e.getMessage());
        }
    }
}
