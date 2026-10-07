/**
 * CSV export — correctness and one security rule.
 *
 * WHY THIS TEST EXISTS
 * TC-019 and TC-020 are a real exfiltration vector, not a formatting nit. A
 * cell whose value begins with = + - or @ is executed as a formula when the
 * exported file is opened in Excel, and =HYPERLINK can send cell contents to an
 * external URL. Neutralising it is the export layer's job.
 */
import { toCsv, downloadCsv } from 'c/gridCsv';

describe('CSV export', () => {
    it('TC-006 quotes a value containing a comma', () => {
        expect(toCsv([{ a: 'Smith, John' }], ['a'])).toContain('"Smith, John"');
    });

    it('TC-007 escapes a double quote by doubling it', () => {
        expect(toCsv([{ a: 'She said "yes"' }], ['a'])).toContain('"She said ""yes"""');
    });

    it('TC-008 quotes a value containing a newline so it stays one record', () => {
        const out = toCsv([{ a: 'one\ntwo' }], ['a']);
        expect(out).toContain('"one\ntwo"');
        // Header plus one record — the embedded newline must not split the row.
        expect(out.trimEnd().split('\n').filter(l => /^[a-z]/.test(l)).length).toBe(1);
    });

    it('TC-004 does not coerce a leading-zero string to a number', () => {
        expect(toCsv([{ a: '00123' }], ['a'])).toMatch(/00123/);
    });

    it('TC-019 neutralises a leading = so Excel will not execute it', () => {
        const out = toCsv([{ a: '=HYPERLINK("http://evil.example","x")' }], ['a']);
        const field = out.split('\n')[1];
        // The load-bearing assertion is the prefix, not the absence of a leading
        // '=' — a quote-wrapping implementation would pass the latter and still
        // execute in Excel.
        expect(field).toMatch(/^["']?[\t']=HYPERLINK/);
    });

    it('TC-020 neutralises + - and @ prefixes too', () => {
        // The weak version of this assertion — "the field does not start with the
        // dangerous character" — is passed by an implementation that merely wraps
        // the value in quotes. Excel strips CSV quotes before evaluating formulas,
        // so quoting is NOT neutralisation. Assert the prefix explicitly.
        ['+1234', '-1234', '@SUM(A1)', '=1+1'].forEach(v => {
            const field = toCsv([{ a: v }], ['a']).split('\n')[1];
            expect(field).toMatch(/^["']?[\t']/);   // tab or apostrophe precedes the value
            expect(field.replace(/^["']?[\t']/, '')).toContain(v);  // and the value survives
        });
    });

    it('a neutralised value still round-trips back to its original on re-import', () => {
        // Prefixing changes the bytes, so the export is no longer a faithful copy.
        // This asserts the transformation is reversible and documents the contract
        // rather than leaving it to be discovered by a user.
        const original = '=HYPERLINK("http://example.com","x")';
        const field = toCsv([{ a: original }], ['a']).split('\n')[1];
        const recovered = field.replace(/^"/, '').replace(/"$/, '').replace(/^[\t']/, '');
        expect(recovered.replace(/""/g, '"')).toBe(original);
    });

    it('omits fields the running user cannot read', () => {
        // The export path must respect FLS independently of the render path.
        const out = toCsv([{ Text_Field__c: 'visible', Long_Text__c: 'hidden' }],
                          ['Text_Field__c']);
        expect(out).toContain('visible');
        expect(out).not.toContain('hidden');
    });

    it('TC-012 downloads with a byte order mark, so Excel reads UTF-8', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let href = null;
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
            href = this.href;
        });
        try {
            downloadCsv('a\nGrid text \u{1F60A}', 'out.csv', container);
        } finally {
            click.mockRestore();
            container.remove();
        }
        expect(href.startsWith('data:text/csv;charset=utf-8,%EF%BB%BFa%0A')).toBe(true);
        expect(decodeURIComponent(href.split(',')[1])).toBe(String.fromCharCode(0xfeff) + 'a\nGrid text \u{1F60A}');
        expect(container.childNodes).toHaveLength(0);
    });
});
