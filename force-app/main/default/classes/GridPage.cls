/** One page of results, and how to ask for the next one. */
public with sharing class GridPage {
    public List<SObject> rows = new List<SObject>();
    public Boolean hasMore = false;
    public String cursorLocator;
    /** The open cursor, for the browser to hand back with the next request. */
    public String cursorToken;
    public Integer totalRows = 0;
    /** Local names of requested fields removed because the user cannot read them. */
    public List<String> strippedFields = new List<String>();
    /** Local names actually selected, in request order. */
    public List<String> selectedFields = new List<String>();
    /** Lookup display names read with the rows: local field name to SOQL path. */
    public Map<String, String> namePaths = new Map<String, String>();
}
