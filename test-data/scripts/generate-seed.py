#!/usr/bin/env python3
"""
Rowhouse — edge-case seed data generator.

Writes Consignment__c.csv: 56 consignments of Granite Coast Freight, a
fictional New England carrier. Every row exists to break one specific thing,
yet reads like a real consignment. Its PRO number (PRO-1001 to PRO-1056) is
the edge case's number in the test plan (TC-001 to TC-056), and edge-cases.md,
written alongside, lists what each one covers and what correct looks like, so
a failing check tells you which edge case broke without reading this file.

Written with the csv module on purpose: several values contain commas, quotes,
newlines and leading '=' characters. Hand-written CSV gets those wrong.
"""
import csv, os, sys

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "data", "Consignment__c.csv")
CATALOG = os.path.join(HERE, "..", "data", "edge-cases.md")

COLS = [
    "Name", "Pro_Number__c",
    "Consignee__c", "Delivery_Notes__c",
    "Pieces__c", "Weight__c", "Freight_Charge__c", "Fuel_Surcharge__c",
    "Ship_Date__c", "Picked_Up__c",
    "Delivered__c", "Contact_Email__c", "Contact_Phone__c", "Tracking_Link__c",
    "Service_Level__c", "Mode__c", "Equipment__c",
    "Handling__c",
]

# Each edge case's consignment name, by its number in the test plan.
NAMES = {
    "TC-001": "Unassigned pickup, Augusta", "TC-002": "Blank manifest, Waterville",
    "TC-003": "Empty trailer return, Lewiston", "TC-004": "Fore Street receiving, Portland",
    "TC-005": "Saco River Outfitters, 3 crates", "TC-006": "Smith & Sons lumber, Biddeford",
    "TC-007": "Pease lobster pound, Stonington", "TC-008": "Rockland Marine Supply, rear dock",
    "TC-009": "Camden Hills Brewing, kegs", "TC-010": "Down East Cooperative, Machias",
    "TC-011": "Pallet labels, Presque Isle", "TC-012": "Bangor Brick & Tile, 2 pallets",
    "TC-013": "Al-Amal Bookshop, Portland", "TC-014": "Tokyo Bussan, Boston branch",
    "TC-015": "Cafe Levesque, Brunswick", "TC-016": "Ogunquit Playhouse Shop",
    "TC-017": "Kennebunk Beach Supply", "TC-018": "Wells Harbor Bait and Tackle",
    "TC-019": "Old Orchard Arcade, invoices", "TC-020": "Scarborough Feed, statements",
    "TC-021": "O'Brien and Sons, Dockside", "TC-022": "Returned freight credit, Bath",
    "TC-023": "Brunswick Grain, partial load", "TC-024": "Bath Iron fasteners, bulk",
    "TC-025": "Fuel surcharge review, Bangor", "TC-026": "Penobscot Paper, full truck",
    "TC-027": "New Year delivery, Auburn", "TC-028": "Year-end delivery, Skowhegan",
    "TC-029": "Late pickup, Ellsworth", "TC-030": "Spring-forward pickup, Belfast",
    "TC-031": "Southampton transfer, October", "TC-032": "Leap day delivery, Rockport",
    "TC-033": "Archive manifest, Hallowell", "TC-034": "Long-term storage, Gardiner",
    "TC-035": "Standard service, Wiscasset", "TC-036": "White glove service, Kennebunkport",
    "TC-037": "Dry van load, Houlton", "TC-038": "Reefer on LTL, Calais",
    "TC-039": "Parcel drop, Eastport", "TC-040": "Glassware, Bar Harbor",
    "TC-041": "Appliance delivery, Orono", "TC-042": "Delivered, Millinocket",
    "TC-043": "Rush order, Damariscotta", "TC-044": "Phone booking, Boothbay",
    "TC-045": "Tracked shipment, Kittery", "TC-046": "Flagged link, Sanford",
    "TC-047": "Freeport Outlet, first drop", "TC-048": "Freeport Outlet, second drop",
    "TC-049": "Unnamed consignee, Topsham", "TC-050": "Acadia trail gear, 1 of 3",
    "TC-051": "Acadia trail gear, 2 of 3", "TC-052": "Acadia trail gear, 3 of 3",
    "TC-053": "Exchange Street drop, 10", "TC-054": "Exchange Street drop, 9",
    "TC-055": "Driver log, Fort Kent", "TC-056": "Portland Marine Hardware, full detail",
}

def realistic_255():
    s = ("Penobscot Bay Regional Cooperative Extension and Marine Fisheries Laboratories of "
         "Down East Maine, Receiving Department, Building 4, Attention Shipping and Receiving "
         "Supervisor, Third Floor Loading Platform, Rear Entrance off Route 1 near the Harbor "
         "Master's Office, Machias")
    s = (s + ", Washington County, Maine 04654")[:255]
    assert len(s) == 255, len(s)
    return s



R = []
CATALOG_ROWS = []
def rec(name, title, expected, **kw):
    tc = name.split()[0]
    row = {c: "" for c in COLS}
    row.update(kw)
    row.update(Name=NAMES[tc], Pro_Number__c="PRO-1" + tc.split("-")[1])
    R.append(row)
    CATALOG_ROWS.append((tc, row["Pro_Number__c"], row["Name"], title.split(" ", 1)[1], expected))

# ---------------------------------------------------------------- null vs empty
rec("TC-001", "TC-001 null vs empty string",
    "Every cell renders as empty with no placeholder text. Editing then cancelling "
    "must leave the field null, not convert it to an empty string.")
rec("TC-002", "TC-002 empty string is not null",
    "Renders identically to TC-001, but a save must not change these to null. "
    "Salesforce treats '' and null differently and a grid must not conflate them.",
    Consignee__c="", Delivery_Notes__c="")
rec("TC-003", "TC-003 zero is not blank",
    "0, 0.00 and 0% must render as '0', '0.00' and '0.00%' — never blank. "
    "Falsy-check bugs show up here first.",
    Pieces__c="0", Weight__c="0.00", Freight_Charge__c="0.00", Fuel_Surcharge__c="0",
    Delivered__c="false")

# ---------------------------------------------------------------- text handling
rec("TC-004", "TC-004 leading zeros preserved",
    "Must render and CSV-export as 00123, not 123. Text fields that look numeric "
    "are the most common export regression.",
    Consignee__c="00123 Fore Street Receiving")
rec("TC-005", "TC-005 leading and trailing whitespace",
    "Whitespace is visible on edit and preserved on save. Do not trim silently — "
    "the platform trims some field types and not others.",
    Consignee__c="  Saco River Outfitters  ")
rec("TC-006", "TC-006 comma inside a value",
    "Renders with the comma. CSV export must quote the field.",
    Consignee__c="Smith, John and Sons, Ltd.")
rec("TC-007", "TC-007 double quote inside a value",
    'Renders as typed. CSV export must escape it by doubling: "" .',
    Consignee__c='Rocco "The Lobster" Pease')
rec("TC-008", "TC-008 newline inside a long text value",
    "Grid cell shows it on one line (clipped or wrapped per config), never breaks "
    "the row. CSV export must quote so the record stays one row on re-import.",
    Consignee__c="Rockland Marine Supply",
    Delivery_Notes__c="Rear dock only.\nRing the bell twice.\n\nForklift on site after 7 AM.")
rec("TC-009", "TC-009 tab inside a value",
    "Preserved, and must not be interpreted as a column separator by TSV export.",
    Consignee__c="Camden Hills\tBrewing")
rec("TC-010", "TC-010 text field at exactly its 255 limit",
    "Saves without error. Truncation indicator appears but no data is lost.",
    Consignee__c=realistic_255())
rec("TC-011", "TC-011 long word with no spaces",
    "Must not blow out the column width or force horizontal scroll of the whole "
    "table. Truncates with slds-truncate.",
    Consignee__c="SSCC" + "00340123450000000017" * 10)

# ---------------------------------------------------------------- unicode
rec("TC-012", "TC-012 emoji and surrogate pairs",
    "Renders as one glyph each. Any character counting must use code points, not "
    "UTF-16 length, or the character counter reads double.",
    Consignee__c="Bangor Brick & Tile \U0001F9F1\U0001F3D8\uFE0F\U0001F477\U0001F3FD\u200D\u2640\uFE0F")
rec("TC-013", "TC-013 right-to-left text",
    "Renders right-to-left inside a left-to-right table without reordering "
    "neighbouring columns. Arrow-key direction constants must invert under RTL.",
    Consignee__c="مكتبة الأمل — بورتلاند")
rec("TC-014", "TC-014 double-width CJK characters",
    "Column auto-width must account for double-width glyphs. A width computed "
    "from character count will be roughly half what it needs.",
    Consignee__c="東京物産株式会社 ボストン支店")
rec("TC-015", "TC-015 combining diacritics",
    "e + combining acute must render as one grapheme and must not be truncated "
    "between the base character and the mark.",
    Consignee__c="Cafe\u0301 Le\u0301vesque, Andre\u0301 & Noe\u0308l")
rec("TC-016", "TC-016 zero-width and non-breaking characters",
    "Zero-width space and non-breaking space are preserved but must not render as "
    "visible boxes. A value that looks empty but is not.",
    Consignee__c="Ogunquit\u200bPlayhouse\u00a0Shop")

# ---------------------------------------------------------------- injection
rec("TC-017", "TC-017 HTML and script content renders as text",
    "SECURITY. Must render as literal text. If an alert fires or the markup is "
    "interpreted, the grid has an XSS hole. Test in both display and edit mode.",
    Consignee__c='<script>alert("xss")</script><b>bold?</b>')
rec("TC-018", "TC-018 attribute-break XSS attempt",
    "SECURITY. Renders as literal text. Covers the case where a value is "
    "interpolated into an attribute rather than a text node.",
    Consignee__c='"><img src=x onerror=alert(1)>')
rec("TC-019", "TC-019 CSV formula injection",
    "SECURITY. On CSV export, a value beginning = + - or @ must be neutralised "
    "(prefix with a tab or single quote) so Excel does not execute it on open. "
    "Easy to miss and a real exfiltration vector.",
    Consignee__c='=HYPERLINK("http://granitecoastfreight.com/pay?"&A1,"Pay invoice")')
rec("TC-020", "TC-020 CSV formula injection, other prefixes",
    "SECURITY. Same treatment as TC-019 for +, - and @ prefixes.",
    Consignee__c="+1234567890", Delivery_Notes__c="@SUM(A1:A9)")
rec("TC-021", "TC-021 quote and backslash in a filterable value",
    "SECURITY. Quick search for this value must not error and must not alter the "
    "query. Proves the search term is bound, not concatenated.",
    Consignee__c="O'Brien & Sons \\ \"Dockside\" 20%_off")

# ---------------------------------------------------------------- numbers
rec("TC-022", "TC-022 negative numbers and currency",
    "Negative currency renders per locale (-$1,234.56 or ($1,234.56)) and sorts "
    "below zero, not by absolute value.",
    Pieces__c="-42", Weight__c="-1234.56", Freight_Charge__c="-1234.56",
    Fuel_Surcharge__c="-12.5")
rec("TC-023", "TC-023 value with more precision than field scale",
    "Field is scale 2. Input of 3 decimal places must round consistently on both "
    "client and server — and must not show 1234.56 while saving 1234.567.",
    Weight__c="1234.567", Freight_Charge__c="0.005")
rec("TC-024", "TC-024 large number near the 18-digit limit",
    "Renders without switching to exponential notation and without JavaScript "
    "float rounding. 18 significant digits exceeds Number.MAX_SAFE_INTEGER, so "
    "the value must be carried as a string client-side.",
    Pieces__c="999999999999999999")
rec("TC-025", "TC-025 percent stored value versus displayed",
    "Salesforce stores 50 for 50%. The editor must round-trip without dividing or "
    "multiplying by 100 — the classic percent bug.",
    Fuel_Surcharge__c="50")
rec("TC-026", "TC-026 locale thousands separator on edit",
    "Displays 1,234,567.89; the edit input must accept both 1234567.89 and the "
    "grouped form without rejecting either.",
    Weight__c="1234567.89", Freight_Charge__c="1234567.89")

# ---------------------------------------------------------------- dates
rec("TC-027", "TC-027 Date field on 1 January",
    "A Date has no timezone. Must render as 2026-01-01 for a user in Auckland and "
    "a user in Los Angeles. If it shifts a day, the code is treating it as a "
    "DateTime.",
    Ship_Date__c="2026-01-01")
rec("TC-028", "TC-028 Date field on 31 December",
    "Same as TC-027 in the other direction — the day must not roll forward.",
    Ship_Date__c="2026-12-31")
rec("TC-029", "TC-029 DateTime at 23:30 on a month end",
    "Renders in the running user's timezone. Editing the time must not silently "
    "change the date unless the user crosses midnight deliberately.",
    Picked_Up__c="2026-01-31T23:30:00.000Z")
rec("TC-030", "TC-030 US DST spring-forward gap",
    "02:30 on 8 March 2026 does not exist in America/New_York. Must not throw, "
    "and must not silently become 01:30.",
    Picked_Up__c="2026-03-08T07:30:00.000Z")
rec("TC-031", "TC-031 EU DST fall-back ambiguity",
    "02:30 on 25 October 2026 occurs twice in Europe/London. Must round-trip to "
    "the same instant it was saved as.",
    Picked_Up__c="2026-10-25T01:30:00.000Z")
rec("TC-032", "TC-032 leap day",
    "29 February 2028 is valid. Date arithmetic in fill-down must not skip it.",
    Ship_Date__c="2028-02-29")
rec("TC-033", "TC-033 earliest valid Salesforce date",
    "1700-01-01 is the documented floor. Renders and sorts correctly rather than "
    "being treated as invalid.",
    Ship_Date__c="1700-01-01")
rec("TC-034", "TC-034 latest valid Salesforce date",
    "4000-12-31 is the documented ceiling. Must not overflow a 4-digit year "
    "assumption.",
    Ship_Date__c="4000-12-31")

# ---------------------------------------------------------------- picklists
rec("TC-035", "TC-035 picklist with an active value",
    "Combobox opens with Economy, Standard, Express and the current value selected.",
    Service_Level__c="Standard")
rec("TC-036", "TC-036 picklist value no longer in the value set",
    "CRITICAL and common in real orgs. 'White Glove' is not an active value. Must "
    "render the stored value, must not blank it, and the editor must show it as "
    "the current selection while offering the active values. Silently discarding "
    "it is data loss.",
    Service_Level__c="White Glove")
rec("TC-037", "TC-037 dependent picklist, valid pairing",
    "Controlling = Truckload, so the dependent list offers only Dry Van and "
    "Reefer.",
    Mode__c="Truckload", Equipment__c="Dry Van")
rec("TC-038", "TC-038 dependent picklist, invalid pairing",
    "Controlling = LTL but the stored dependent value belongs to Truckload. "
    "Must render as stored and must not auto-correct on load — only on an "
    "explicit edit of the controlling field.",
    Mode__c="LTL", Equipment__c="Reefer")
rec("TC-039", "TC-039 controlling value with no valid dependents",
    "Controlling = Parcel has no dependent values configured. The dependent "
    "editor must render disabled and empty, not throw.",
    Mode__c="Parcel")
rec("TC-040", "TC-040 multi-select picklist round-trip",
    "Stored semicolon-delimited. Must render as separate chips or a comma list, "
    "and must save back semicolon-delimited in the original order.",
    Handling__c="Fragile;Liftgate;Inside Delivery")
rec("TC-041", "TC-041 multi-select with a single value",
    "Must not render a trailing separator, and must not be confused with a plain "
    "picklist.",
    Handling__c="Liftgate")

# ---------------------------------------------------------------- other types
rec("TC-042", "TC-042 checkbox true",
    "Renders checked. A checkbox is never null in Salesforce — if the grid can "
    "produce a null checkbox, that is a bug.",
    Delivered__c="true")
rec("TC-043", "TC-043 email that is stored but unusual",
    "Salesforce accepts plus-addressing and long TLDs. The editor must not reject "
    "a value the platform already accepted.",
    Contact_Email__c="receiving+dock4@granitecoastfreight.com")
rec("TC-044", "TC-044 phone with extension and punctuation",
    "Phone is free text in Salesforce. Must not be reformatted or rejected.",
    Contact_Phone__c="+1 (555) 010-9999 x4021")
rec("TC-045", "TC-045 URL with query string and fragment",
    "Renders as a link with the display text truncated, but the href carries the "
    "full URL including the query string.",
    Tracking_Link__c="https://track.granitecoastfreight.com/consignments/history?pro=PRO-1045&view=full#delivery-events")
rec("TC-046", "TC-046 URL field containing a javascript scheme",
    "SECURITY. Must not render as a clickable javascript: link. Render as text or "
    "strip the href.",
    Tracking_Link__c="javascript:alert(document.domain)")

# ---------------------------------------------------------------- identity/keys
rec("TC-047", "TC-047 two records with identical field values",
    "Paired with TC-048. Row keys must stay distinct because they derive from Id, "
    "not from content. If they collide, the renderer will reuse the wrong row on "
    "sort and edits will land on the wrong record.",
    Consignee__c="Freeport Outlet Distribution", Pieces__c="7")
rec("TC-048", "TC-048 two records with identical field values",
    "Paired with TC-047. Edit one and assert the other is untouched.",
    Consignee__c="Freeport Outlet Distribution", Pieces__c="7")

# ---------------------------------------------------------------- sort ordering
for i, (label, txt, num) in enumerate([
    ("TC-049 sort null", "", ""),
    ("TC-050 sort lower", "acadia trail gear", "1"),
    ("TC-051 sort upper", "Acadia Trail Gear", "2"),
    ("TC-052 sort accent", "Äcadia Trail Gear", "3"),
    ("TC-053 sort numeric str", "10 Exchange Street", "10"),
    ("TC-054 sort numeric str 2", "9 Exchange Street", "9"),
], 1):
    rec(label, label + " collation and null ordering",
        "Sorting these six together must be deterministic and must match the "
        "documented rule: nulls last on ascending, case-insensitive collation, "
        "accents after their base letter, and text '10' before '9' while the "
        "numeric column sorts 9 before 10.",
        Consignee__c=txt, Pieces__c=num)

# ---------------------------------------------------------------- long text
rec("TC-055", "TC-055 long text area near its limit",
    "32,000 characters. Must not be loaded in full into the grid cell — the grid "
    "should request a truncated projection and fetch the rest only on edit. If "
    "the whole value ships to the client, 1,000 such rows is 32 MB.",
    Delivery_Notes__c=("Driver reports the rear dock door was blocked, so the load waited in the "
                                      "yard until the receiving crew cleared it at the start of the next shift. " * 300)[:32000])

# ---------------------------------------------------------------- wide row
rec("TC-056", "TC-056 all fields populated at once",
    "The widest realistic row. Used for the column-count ceiling test and for "
    "measuring render cost per row with every editor instantiated.",
    Consignee__c="Portland Marine Hardware", Delivery_Notes__c="Side door.", Pieces__c="1234",
    Weight__c="99.99", Freight_Charge__c="4999.00", Fuel_Surcharge__c="33.33",
    Ship_Date__c="2026-06-15", Picked_Up__c="2026-06-15T14:45:00.000Z", Delivered__c="true",
    Contact_Email__c="receiving@granitecoastfreight.com", Contact_Phone__c="555-0100",
    Tracking_Link__c="https://track.granitecoastfreight.com/PRO-1056",
    Service_Level__c="Express", Mode__c="Truckload", Equipment__c="Reefer",
    Handling__c="Fragile;Inside Delivery")

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        w.writerows(R)
    with open(CATALOG, "w", encoding="utf-8") as f:
        f.write("# Edge cases\n\nGenerated by `scripts/generate-seed.py`: each consignment in "
                "`Consignment__c.csv` and the edge case it exists for. The PRO number carries the "
                "test plan's case number (TC-055 is PRO-1055).\n\n"
                "| Case | PRO number | Consignment | Covers | Correct when |\n| --- | --- | --- | --- | --- |\n")
        for tc, pro, name, title, expected in CATALOG_ROWS:
            f.write("| %s | %s | %s | %s | %s |\n" % (tc, pro, name, title, " ".join(expected.split()).replace("|", "\\|")))
    print(f"wrote {len(R)} consignments to {os.path.relpath(OUT)} and the catalog to {os.path.relpath(CATALOG)}")

if __name__ == "__main__":
    main()
