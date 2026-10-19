/**
 * gridImport — reads a CSV file and plans an import from it or from an Excel
 * sheet. Plain functions, no DOM (HR-28).
 *
 *   parseCsv(text)             the rows of a CSV file, as text
 *   planImport(table, options) what the import will do, row by row, before
 *                              anything is sent
 *
 * THE FILE
 * The first row that is not empty is the header. A header matches a column
 * by its label or its field API name, in any case; "Id" or "Record ID" is the
 * record Id. The grid's own CSV export writes exactly these headers, so an
 * exported file comes back in unchanged. A lookup column also answers to its
 * label with " ID" after it ("Account ID"), as earlier versions headed it, so
 * an older export comes back in too. A header that matches no column, or
 * a column that is not editable, is listed as ignored and never sent. So is a
 * column that shows a field of a related record (Account Industry on a
 * Contact grid): an import writes the grid's own records only.
 *
 * EACH ROW
 * A row with a record Id updates that record; a row without one creates a
 * record. Values are read by the column's type with the rules a paste uses
 * (c/gridClipboard parseCell): the user's decimal separator for CSV text, a
 * picklist value by label or API name, a lookup by record Id or by the name
 * of a record already shown in the grid. Excel numbers, dates and booleans
 * arrive typed (c/gridXlsx) and are read as such; a number Excel shows as a
 * percent (12.5% is 0.125 there) goes into a percent field as 12.5. An empty cell clears the
 * field; a column not in the file is left as it is. A checkbox cell that is
 * empty is unchecked (TC-042: a checkbox is never blank).
 *
 * THE USER'S CHOICES
 * The user may map a file column by hand to a grid column, to the record
 * Id, or to nothing (`overrides`, by the column's position in the file),
 * and may match records by an External Id column instead of the record Id
 * (`matchField`): a row with a value then updates the record that has it,
 * or creates one when none does, which only the server can tell, so such a
 * row is planned as 'match'. With a match field the Id column is not read.
 *
 * A row is not sent when anything in it is wrong: a value that cannot be read,
 * a required field left empty in the file, an Id that is not of this grid's
 * object or appears twice, a new record where the user may not create one, or
 * a dependent picklist value its controlling value does not offer. The server
 * checks everything again (HR-6).
 */
import LOCALE from '@salesforce/i18n/locale';
import { parseCell } from 'c/gridClipboard';
import { isLookup, nameIndex, isValidDependent } from 'c/gridFields';
import { isBlank } from 'c/gridFormat';

/** The most data rows one import takes: the most one save sends. */
export const MAX_IMPORT_ROWS = 10000;
/** Values read from Excel's typed cells are written this way, whatever the user's locale. */
const CANONICAL_LOCALE = 'en-US';
const RECORD_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const ID_HEADERS = new Set(['id', 'record id', 'recordid', 'record_id']);
/** A hand mapping: the file column is the record Id. */
export const MAP_ID = '__id';
/** A hand mapping: the file column is not imported. */
export const MAP_SKIP = '__skip';
const BOM = String.fromCharCode(0xfeff);
export const REQUIRED_MESSAGE = 'Complete this field.';

// ------------------------------------------------------------------ CSV

/** The field separator: whichever of comma, semicolon and tab the first line uses most, outside quotes. */
export function detectDelimiter(text) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') quoted = !quoted;
        else if (!quoted && (ch === '\n' || ch === '\r')) break;
        else if (!quoted && counts[ch] !== undefined) counts[ch]++;
    }
    return Object.keys(counts).reduce((best, d) => (counts[d] > counts[best] ? d : best), ',');
}

/**
 * RFC 4180, as spreadsheets write it: fields in double quotes may hold the
 * separator, line breaks and doubled quotes; lines end in LF, CRLF or CR; a
 * byte order mark is dropped. Excel saves CSV with semicolons where the comma
 * is the decimal separator, so the separator is detected.
 */
export function parseCsv(input) {
    let text = String(input == null ? '' : input);
    if (text.startsWith(BOM)) text = text.slice(1);
    const delimiter = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                quoted = false;
            } else {
                field += ch;
            }
            i++;
            continue;
        }
        if (ch === '"' && field === '') {
            quoted = true;
        } else if (ch === delimiter) {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            if (ch === '\r' && text[i + 1] === '\n') i++;
        } else {
            field += ch;
        }
        i++;
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// ------------------------------------------------------------------ plan

const norm = s =>
    String(s == null ? '' : s)
        .trim()
        .toLowerCase();
const cellText = cell => (cell == null ? '' : typeof cell === 'string' ? cell : String(cell.v));
const isEmptyRow = row => !row || row.every(c => cellText(c).trim() === '');

/**
 * Which file column feeds which grid column: { idIndex, fields: [{ index,
 * column }], ignored: [{ index, header, reason }] }. `overrides` maps a file
 * column's position to MAP_ID, MAP_SKIP or a grid column's field; a
 * position not in it is matched by its header, as before.
 */
export function mapHeaders(header, columns, overrides = {}) {
    const byName = new Map();
    (columns || []).forEach(c => {
        [c.label, c.field].forEach(name => {
            if (name && !byName.has(norm(name))) byName.set(norm(name), c);
        });
    });
    // A lookup headed "Account" was headed "Account ID" in earlier versions.
    (columns || []).forEach(c => {
        const old = isLookup(c.type) && c.label ? norm(c.label + ' ID') : null;
        if (old && !byName.has(old)) byName.set(old, c);
    });
    const byField = new Map((columns || []).map(c => [c.field, c]));
    const out = { idIndex: -1, fields: [], ignored: [] };
    const used = new Set();
    const chosen = overrides || {};
    // Hand mappings first, so a header matched automatically never takes a
    // column the user gave to another file column.
    const order = (header || []).map((cell, index) => index);
    order.sort(
        (a, b) =>
            Number(Object.prototype.hasOwnProperty.call(chosen, b)) -
            Number(Object.prototype.hasOwnProperty.call(chosen, a))
    );
    order.forEach(index => {
        const name = cellText((header || [])[index]).trim();
        const choice = Object.prototype.hasOwnProperty.call(chosen, index) ? chosen[index] : undefined;
        if (!name && choice === undefined) return;
        const label = name || `Column ${index + 1}`;
        if (choice === MAP_SKIP) {
            out.ignored.push({ index, header: label, reason: 'You chose not to import it.' });
            return;
        }
        if (choice === MAP_ID || (choice === undefined && ID_HEADERS.has(norm(name)))) {
            if (out.idIndex < 0) out.idIndex = index;
            else out.ignored.push({ index, header: label, reason: 'The record Id is already in another column.' });
            return;
        }
        const column = choice !== undefined ? byField.get(choice) : byName.get(norm(name));
        if (!column) out.ignored.push({ index, header: label, reason: 'Not a column of this grid.' });
        else if (!column.editable)
            out.ignored.push({ index, header: label, reason: `${column.label} is read-only here.` });
        else if (column.isPath)
            out.ignored.push({
                index,
                header: label,
                reason: `${column.label} is a field of a related record. An import changes this grid’s own records only.`
            });
        else if (used.has(column.field))
            out.ignored.push({ index, header: label, reason: `${column.label} is already in another column.` });
        else {
            used.add(column.field);
            out.fields.push({ index, column });
        }
    });
    out.fields.sort((a, b) => a.index - b.index);
    out.ignored.sort((a, b) => a.index - b.index);
    return out;
}

/** The grid's columns an import can write: editable, and fields of the grid's own records. */
export function importableColumns(columns) {
    return (columns || []).filter(c => c.editable && !c.isPath);
}

/** The choices a file column can be mapped to by hand: not imported, the record Id, or an importable column. */
export function mappingChoices(columns) {
    return [
        { value: MAP_SKIP, label: '(Not imported)' },
        { value: MAP_ID, label: 'Record Id' }
    ].concat(importableColumns(columns).map(c => ({ value: c.field, label: c.label || c.field })));
}

/** What a file column is mapped to in a mapping: MAP_ID, MAP_SKIP or a field. */
export function mappedTo(mapping, index) {
    if (mapping.idIndex === index) return MAP_ID;
    const f = mapping.fields.find(x => x.index === index);
    return f ? f.column.field : MAP_SKIP;
}

/**
 * What an import will do: { mapping, items, counts, error }.
 *
 *   table     the file's rows, header included: text (CSV) or typed cells (Excel)
 *   columns   the grid's columns, as the server sent them
 *   rows      the loaded rows, for the object's Id prefix and current values
 *   refNames  { [recordId]: name }, so a lookup can be given by name
 *   canCreate the user may create records of the object
 *   locale    how CSV numbers and dates are written; the user's by default
 *   overrides the user's hand mappings (mapHeaders)
 *   matchField an External Id column mapped in the file to match records by,
 *             instead of the record Id; null for the Id
 *
 * Each item: { line, id, action ('update' | 'create' | 'match'), values: { field:
 * value }, errors: [{ field, message }] }; `line` is the file line (1 is the
 * header). `error` is set, and nothing is planned, when the file as a whole
 * cannot be imported; `unmapped` too when that is only because no header
 * names a column, which a hand mapping can put right.
 */
export function planImport(
    table,
    {
        columns = [],
        rows = [],
        refNames = {},
        canCreate = false,
        locale = LOCALE,
        overrides = {},
        matchField = null
    } = {}
) {
    const all = table || [];
    const start = all.findIndex(r => !isEmptyRow(r));
    const empty = {
        mapping: { idIndex: -1, fields: [], ignored: [] },
        items: [],
        counts: { update: 0, create: 0, match: 0, error: 0 },
        header: []
    };
    if (start < 0) return { ...empty, error: 'The file is empty.' };
    const mapping = mapHeaders(all[start], columns, overrides);
    // Matching by an External Id needs that column in the file.
    const match =
        matchField && mapping.fields.some(f => f.column.field === matchField && f.column.externalId)
            ? matchField
            : null;
    if (!mapping.fields.length) {
        // The user can still map the columns by hand: `unmapped` says so.
        return {
            ...empty,
            mapping,
            header: all[start],
            unmapped: true,
            error: 'None of the file’s columns is an editable column of this grid. The first row must hold the column names.'
        };
    }
    const body = [];
    for (let i = start + 1; i < all.length; i++) if (!isEmptyRow(all[i])) body.push({ line: i + 1, cells: all[i] });
    if (body.length > MAX_IMPORT_ROWS) {
        return {
            ...empty,
            mapping,
            header: all[start],
            error: `The file has ${body.length} rows; one import takes at most ${MAX_IMPORT_ROWS}.`
        };
    }

    const loaded = new Map(rows.map(r => [String(r.Id).slice(0, 15), r])); // a file may hold 15- or 18-character Ids
    const prefix = rows.length ? String(rows[0].Id).slice(0, 3) : null;
    const names = nameIndex(refNames);
    const byField = new Map(columns.map(c => [c.field, c]));
    const seenIds = new Map();
    const seenKeys = new Map();
    const counts = { update: 0, create: 0, match: 0, error: 0 };

    const items = body.map(({ line, cells }) => {
        const item = { line, id: null, action: 'create', values: {}, errors: [] };
        const rawId = mapping.idIndex >= 0 && !match ? cellText(cells[mapping.idIndex]).trim() : '';
        if (match) {
            // Matched by the External Id: the server finds the record, or creates one.
            const keyCell = mapping.fields.find(f => f.column.field === match);
            const key = cellText(cells[keyCell.index]).trim();
            if (key) {
                item.action = 'match';
                if (seenKeys.has(key.toLowerCase())) {
                    item.errors.push(
                        problem(
                            match,
                            keyCell.column.label,
                            key,
                            `Also on line ${seenKeys.get(key.toLowerCase())}.`,
                            `${key} is also on line ${seenKeys.get(key.toLowerCase())}.`
                        )
                    );
                } else seenKeys.set(key.toLowerCase(), line);
            } else if (!canCreate) {
                item.errors.push(
                    problem(
                        match,
                        keyCell.column.label,
                        '',
                        'No value to match, and you cannot create records here.',
                        'This row has nothing to match by, and you cannot create records here.'
                    )
                );
            }
        } else if (rawId) {
            item.action = 'update';
            item.id = rawId;
            if (!RECORD_ID.test(rawId))
                item.errors.push(problem(null, 'Id', rawId, 'Not a record Id.', `Not a record Id: ${rawId}`));
            else if (prefix && rawId.slice(0, 3) !== prefix)
                item.errors.push(
                    problem(
                        null,
                        'Id',
                        rawId,
                        "Not a record of this grid's object.",
                        `${rawId} is not a record of this grid's object.`
                    )
                );
            else if (seenIds.has(rawId.slice(0, 15)))
                item.errors.push(
                    problem(
                        null,
                        'Id',
                        rawId,
                        `Also on line ${seenIds.get(rawId.slice(0, 15))}.`,
                        `This record is also on line ${seenIds.get(rawId.slice(0, 15))}.`
                    )
                );
            else seenIds.set(rawId.slice(0, 15), line);
        } else if (!canCreate) {
            item.errors.push(
                problem(
                    null,
                    'Id',
                    '',
                    'No record Id, and you cannot create records here.',
                    'This row has no record Id, and you cannot create records here.'
                )
            );
        }
        // A required field the file leaves out is not checked here: on a new
        // record the platform fills some (Owner is the importing user) and
        // refuses the rest, row by row, when the import runs.
        mapping.fields.forEach(({ index, column }) => {
            const read = readValue(cells[index], column, names, locale);
            const raw = cellText(cells[index]);
            if (read.error)
                item.errors.push(
                    problem(column.field, column.label, raw, read.error, `${column.label}: ${read.error}`)
                );
            else if (column.required && isBlank(read.value))
                item.errors.push(
                    problem(column.field, column.label, raw, REQUIRED_MESSAGE, `${column.label}: ${REQUIRED_MESSAGE}`)
                );
            else item.values[column.field] = read.value;
        });
        checkDependents(item, byField, item.id ? loaded.get(item.id.slice(0, 15)) : null);
        if (item.errors.length) counts.error++;
        else counts[item.action]++;
        return item;
    });
    return { mapping, items, counts, error: null, header: all[start], matchField: match };
}

/**
 * One problem on a row: `field` (null for the record Id), the column's
 * `column` label, the `raw` text in the file, the `problem` alone, and the
 * whole `message` as one sentence, for a list.
 */
function problem(field, column, raw, text, message) {
    return { field, column, raw: raw == null ? '' : String(raw), problem: text, message };
}

/**
 * A plain decimal times 100, exactly, by moving the point: "0.125" is
 * "12.5". Anything else comes back as it was.
 */
export function hundredTimes(text) {
    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(String(text).trim());
    if (!m || (!m[2] && !m[3])) return text;
    const fraction = (m[3] || '').padEnd(2, '0');
    const whole = ((m[2] || '') + fraction.slice(0, 2)).replace(/^0+(?=\d)/, '');
    const rest = fraction.slice(2).replace(/0+$/, '');
    const out = whole + (rest ? '.' + rest : '');
    return m[1] && /[1-9]/.test(out) ? '-' + out : out;
}

/** One cell as a value for its column: { value } or { error }. */
function readValue(cell, column, names, locale) {
    const typed = cell && typeof cell === 'object';
    const type = column.type || 'text';
    // Excel keeps 12.5% as 0.125; a percent field keeps 12.5.
    const text = typed && cell.pct && type === 'percent' ? hundredTimes(cellText(cell)) : cellText(cell);
    if ((type === 'checkbox' || type === 'boolean') && text.trim() === '') return { value: false };
    const c = isLookup(type) ? { ...column, nameIndex: names } : column;
    // Excel's typed cells are written one way whatever the user's locale;
    // its text cells, like CSV, are what the user typed.
    return parseCell(text, c, typed && cell.t !== 's' ? CANONICAL_LOCALE : locale);
}

/**
 * A dependent picklist value must go with its row's controlling value: the
 * one in the file, else the loaded record's. Unknown for a record not
 * loaded, so left to the server.
 */
function checkDependents(item, byField, record) {
    Object.keys(item.values).forEach(field => {
        const column = byField.get(field);
        if (!column || !column.dependentOn) return;
        let controlling;
        if (Object.prototype.hasOwnProperty.call(item.values, column.dependentOn))
            controlling = item.values[column.dependentOn];
        else if (record) controlling = record[column.dependentOn];
        else if (item.action === 'create') controlling = null;
        else return;
        if (!isValidDependent(column, item.values[field], controlling)) {
            const controller = (byField.get(column.dependentOn) || {}).label || column.dependentOn;
            const why = `Not offered when ${controller} is ${isBlank(controlling) ? 'blank' : controlling}.`;
            item.errors.push(
                problem(
                    field,
                    column.label,
                    String(item.values[field]),
                    why,
                    `${column.label}: ${item.values[field]} is not offered when ${controller} is ${isBlank(controlling) ? 'blank' : controlling}.`
                )
            );
            delete item.values[field];
        }
    });
}

/** The rows the server is sent for the items that can go: [{ Id?, field: value }]. */
/**
 * For each lookup column the file is mapped to: its texts, row by row, for
 * finding by name the records no row of the grid points to
 * ([{ field, texts }]). The header row is left out.
 */
export function lookupTexts(table, mapping) {
    const all = table || [];
    const start = all.findIndex(r => !isEmptyRow(r));
    if (start < 0 || !mapping) return [];
    return (mapping.fields || [])
        .filter(f => isLookup(f.column.type))
        .map(f => ({
            field: f.column.field,
            texts: all.slice(start + 1).map(row => cellText((row || [])[f.index]).trim())
        }));
}

export function payloadFor(items) {
    return items
        .filter(item => !item.errors.length)
        .map(item => (item.id ? { Id: item.id, ...item.values } : { ...item.values }));
}
