/**
 * DEVELOPMENT ONLY. Never packaged.
 * RowhouseBenchData — the benchmark rows, inserted from Anonymous Apex.
 *
 * The same rows as test-data/scripts/generate-benchmark.py writes to CSV, for
 * an org reached without the Salesforce CLI. Row N is identical either way:
 * both draw from one Park-Miller stream (multiplier 48271, modulus 2^31 - 1,
 * seed 20260918) at exactly 24 draws per row, and both turn a row's draws into
 * values the same way. RowhouseBenchDataTest and test_generate_benchmark.py
 * assert the same golden rows.
 *
 * Grow the object in the published steps, measuring after each:
 *
 *   RowhouseBenchData.insertRows(1, 1000);          // 1k
 *   RowhouseBenchData.insertRows(1001, 3000);       // then 3001-5000: 5k
 *   RowhouseBenchData.insertRows(5001, 7000);       // and so on to 10k,
 *                                                   // then on to 50k
 *
 * At most 2,000 rows per call keeps each Anonymous Apex run well inside the
 * CPU limit. Every value is built from integers (cents, day and minute
 * offsets), never from floating point, so the two languages cannot round
 * differently.
 */
public with sharing class RowhouseBenchData {

    public static final Long SEED = 20260918L;
    public static final Long MODULUS = 2147483647L;
    public static final Long MULTIPLIER = 48271L;
    public static final Integer DRAWS_PER_ROW = 24;
    public static final Integer MAX_PER_CALL = 2000;

    private static final List<String> FIRST = new List<String>{ 'Ada', 'Bea', 'Cyrus', 'Dara', 'Emil',
        'Fiona', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kira', 'Luc', 'Mara', 'Nils', 'Oona', 'Pim', 'Quinn',
        'Rhea', 'Sol', 'Tam' };
    private static final List<String> LAST = new List<String>{ 'Ashworth', 'Brandt', 'Calloway', 'Duarte',
        'Ellery', 'Fairbanks', 'Ghosh', 'Halloran', 'Ishikawa', 'Jarrett', 'Kowalski', 'Lindqvist',
        'Mbeki', 'Novak', 'Okonkwo', 'Pereira', 'Quintana', 'Rasmussen', 'Sandoval', 'Trevino' };
    private static final List<String> STREET = new List<String>{ 'Maple', 'Bellwether', 'Kiln', 'Foundry',
        'Cobble', 'Lantern', 'Rowan', 'Pitch', 'Garrick', 'Sable' };
    private static final List<String> SUFFIX = new List<String>{ 'Row', 'Terrace', 'Close', 'Yard', 'Mews', 'Lane' };
    private static final List<String> CONTROLLING = new List<String>{ 'Hardware', 'Software', 'Services' };
    private static final Map<String, List<String>> DEPENDENT = new Map<String, List<String>>{
        'Hardware' => new List<String>{ 'Keyboard', 'Monitor' },
        'Software' => new List<String>{ 'Licence', 'Subscription' },
        'Services' => new List<String>()
    };
    private static final List<String> MULTI = new List<String>{ 'Red', 'Green', 'Blue', 'Amber', 'Slate' };
    private static final Date EPOCH = Date.newInstance(2024, 1, 1);
    private static final String EM_DASH = String.fromCharArray(new List<Integer>{ 8212 });

    /** Build and insert rows firstRow..lastRow. Returns the number inserted. */
    public static Integer insertRows(Integer firstRow, Integer lastRow) {
        List<Rowhouse_Bench__c> rows = build(firstRow, lastRow);
        insert rows;
        return rows.size();
    }

    /** Rows firstRow..lastRow, 1-based and inclusive, not inserted. */
    public static List<Rowhouse_Bench__c> build(Integer firstRow, Integer lastRow) {
        if (firstRow == null || lastRow == null || firstRow < 1 || lastRow < firstRow) {
            throw new IllegalArgumentException('Rows run from 1 upwards: got ' + firstRow + ' to ' + lastRow + '.');
        }
        if (lastRow - firstRow + 1 > MAX_PER_CALL) {
            throw new IllegalArgumentException('At most ' + MAX_PER_CALL + ' rows per call.');
        }
        Long state = Math.mod(SEED, MODULUS);
        if (state == 0) {
            state = 1;
        }
        // Skip ahead to the first draw of firstRow: one multiplication by
        // MULTIPLIER^(draws before it), instead of generating the earlier rows.
        state = Math.mod(state * modPow(MULTIPLIER, (Long) DRAWS_PER_ROW * (firstRow - 1)), MODULUS);
        List<Rowhouse_Bench__c> out = new List<Rowhouse_Bench__c>();
        for (Integer i = firstRow; i <= lastRow; i++) {
            List<Long> d = new List<Long>();
            for (Integer k = 0; k < DRAWS_PER_ROW; k++) {
                state = Math.mod(state * MULTIPLIER, MODULUS);
                d.add(state);
            }
            out.add(makeRow(i, d));
        }
        return out;
    }

    /** Row i from its 24 draws. generate-benchmark.py make_row mirrors this line by line. */
    @TestVisible
    private static Rowhouse_Bench__c makeRow(Integer i, List<Long> d) {
        // Apex names are case-insensitive: a local called "first" would hide
        // the FIRST list, so every local here has a longer name.
        String streetName = pick(STREET, d[1]);
        String suffixName = pick(SUFFIX, d[2]);
        String firstName = pick(FIRST, d[3]);
        String lastName = pick(LAST, d[4]);
        Long house = 1 + Math.mod(d[5], 299);
        Long roll = Math.mod(d[0], 100);
        String text;
        if (roll < 70) {
            text = streetName + ' ' + suffixName;
        } else if (roll < 95) {
            text = firstName + ' ' + lastName + ', ' + house + ' ' + streetName + ' ' + suffixName;
        } else {
            String part = firstName + ' ' + lastName + ' ' + EM_DASH + ' ' + streetName + ' ' + suffixName;
            text = String.join(new List<String>{ part, part, part, part, part, part }, ' ');
        }

        Date day = EPOCH.addDays(Math.mod(d[10], 1096).intValue());
        Integer minute = Math.mod(d[11], 1440).intValue();
        String ctrl = pick(CONTROLLING, d[20]);
        List<String> deps = DEPENDENT.get(ctrl);

        String email = null;
        if (Math.mod(d[13], 100) < 55) {
            email = (pick(FIRST, d[14]) + '.' + pick(LAST, d[14] / 20)
                + (1 + Math.mod(d[14] / 400, 99)) + '@example.com').toLowerCase();
        }
        String phone = null;
        if (Math.mod(d[15], 100) < 40) {
            phone = '+1 555 ' + (100 + Math.mod(d[16], 900)) + ' ' + (1000 + Math.mod(d[16] / 900, 9000));
        }

        return new Rowhouse_Bench__c(
            Name = 'BM-' + String.valueOf(i).leftPad(6, '0'),
            Text_Field__c = text,
            Number_Field__c = Math.mod(d[6], 1000000),
            Decimal_Field__c = cents(d[7], 9999999),
            Currency_Field__c = cents(d[8], 25000000),
            Percent_Field__c = cents(d[9], 10000),
            Date_Field__c = day,
            DateTime_Field__c = Datetime.newInstanceGmt(day, Time.newInstance(minute / 60, Math.mod(minute, 60), 0, 0)),
            Checkbox_Field__c = Math.mod(d[12], 100) < 35,
            Email_Field__c = email,
            Phone_Field__c = phone,
            Picklist_Field__c = picklistValue(d[19]),
            Controlling_Picklist__c = ctrl,
            Dependent_Picklist__c = deps.isEmpty() ? null : pick(deps, d[21]),
            Multi_Picklist__c = Math.mod(d[17], 100) < 25 ? multiValue(d[18]) : null
        );
    }

    private static String pick(List<String> values, Long x) {
        return values[Math.mod(x, (Long) values.size()).intValue()];
    }

    /** 0.00 to top/100: whole cents, never a float. */
    private static Decimal cents(Long x, Long top) {
        return Decimal.valueOf(Math.mod(x, top + 1)).divide(100, 2);
    }

    private static String picklistValue(Long x) {
        Long r = Math.mod(x, 100);
        if (r < 50) {
            return 'Alpha';
        }
        if (r < 80) {
            return 'Beta';
        }
        return r < 95 ? 'Gamma' : 'Obsolete';
    }

    private static String multiValue(Long x) {
        Integer count = 1 + Math.mod(x, 3).intValue();
        Integer start = Math.mod(x / 3, (Long) MULTI.size()).intValue();
        List<String> picked = new List<String>();
        for (Integer k = 0; k < count; k++) {
            picked.add(MULTI[Math.mod(start + k, MULTI.size())]);
        }
        return String.join(picked, ';');
    }

    /** base^exponent mod MODULUS. Every product stays below 2^62, inside a Long. */
    @TestVisible
    private static Long modPow(Long base, Long exponent) {
        Long result = 1;
        Long b = Math.mod(base, MODULUS);
        Long e = exponent;
        while (e > 0) {
            if (Math.mod(e, 2) == 1) {
                result = Math.mod(result * b, MODULUS);
            }
            b = Math.mod(b * b, MODULUS);
            e = e / 2;
        }
        return result;
    }
}
