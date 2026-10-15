/**
 * gridImportDialog — imports a CSV or Excel file into the grid's object.
 *
 * Three steps in one dialog:
 *   1. Choose a file. CSV is read as UTF-8 (as Windows-1252 when it is not
 *      valid UTF-8, which is how Excel's plain "CSV" is saved on Windows);
 *      .xlsx is read by c/gridXlsx. Nothing is sent yet.
 *   2. Preview (c/gridImport): which file columns feed which grid columns and
 *      which are ignored, how many rows update a record and how many create
 *      one, the first rows as they will be written, and every row held back,
 *      with its line number and the reason.
 *   3. Import: the rows that can go, in batches of IMPORT_BATCH rows and at
 *      most IMPORT_CELLS values (batchesOf), one server call each
 *      (GridController.importRows), with a progress bar. Then what
 *      happened: updated, created, and each row the server refused, by line.
 * Closing reports whether anything was written, so the grid reloads.
 *
 * The dialog is the SLDS modal blueprint, as c/gridUpdateField is: focus starts
 * on the file choice and stays inside, and Escape closes it, except while
 * rows are being written.
 *
 * CHOICES AND UNDO
 * - A workbook with more than one sheet offers its sheets; the first is read
 *   until another is chosen.
 * - Each file column can be mapped by hand to a grid column, to the record Id
 *   or to nothing; the check follows at once.
 * - With an External Id column in the file, records can be matched by it
 *   instead of the record Id: the server updates the record that has the
 *   value, or creates one.
 * - When the import is done, Undo import puts back what the updated records
 *   held and deletes the records it created (GridController.undoImport), in
 *   this dialog, before it closes.
 *
 * AFTER THE UX REVIEW
 * - The steps are shown along the top (a progress indicator, and the step in
 *   words), so the user knows a check comes before anything is written.
 * - The file is chosen from a large drop zone (SLDS's file selector), or
 *   dropped on it; the three rules of a file are three short lines with icons,
 *   not a paragraph; and a template, the grid's column names with an Id
 *   column, can be downloaded to fill in.
 * - The check leads with three figures (update, create, problems). An update
 *   shows what changes, old → new. Figures are right-aligned. Problems are a
 *   table (line, column, what the file says, what is wrong), and the rows
 *   with problems can be downloaded, to fix and import again. When nothing
 *   can be imported, it says so, not just a disabled button.
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';
import importRows from '@salesforce/apex/GridController.importRows';
import undoImport from '@salesforce/apex/GridController.undoImport';
import findLookupNames from '@salesforce/apex/GridController.findLookupNames';
import {
    parseCsv,
    planImport,
    payloadFor,
    mappingChoices,
    mappedTo,
    importableColumns,
    lookupTexts
} from 'c/gridImport';
import { readXlsx } from 'c/gridXlsx';
import { formatValue, isNumericType } from 'c/gridFormat';
import { isLookup, lookupText, unknownNames, namesFound } from 'c/gridFields';
import { toCsv, downloadCsv } from 'c/gridCsv';

/** Rows per server call: one DML statement's worth (GridImportService.MAX_ROWS). */
export const IMPORT_BATCH = 200;
/**
 * Values per server call, the Id aside. A grid that logs its changes writes a
 * log entry for each, and one call may write at most GridEditLog.MAX_ENTRIES.
 * Only a file with more than 25 columns makes a batch smaller.
 */
export const IMPORT_CELLS = 5000;

/** The rows in batches of at most IMPORT_BATCH rows and IMPORT_CELLS values, in order; a row is never split. */
export function batchesOf(payload) {
    const out = [];
    let batch = [];
    let cells = 0;
    payload.forEach(row => {
        const n = Object.keys(row).filter(key => key !== 'Id').length;
        if (batch.length && (batch.length >= IMPORT_BATCH || cells + n > IMPORT_CELLS)) {
            out.push(batch);
            batch = [];
            cells = 0;
        }
        batch.push(row);
        cells += n;
    });
    if (batch.length) out.push(batch);
    return out;
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Rows shown in the preview. */
export const PREVIEW_ROWS = 10;
/** Problems listed; the count says how many there are in all. */
export const PROBLEMS_SHOWN = 100;
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
/** In the check, when no header names a column of the grid. */
const UNMAPPED_TEXT =
    'None of the file’s column names is a column of this grid. Choose below what each column is imported as.';
/** The steps along the top: reading a file is still the first. */
const STEP_OF = { choose: 'choose', reading: 'choose', preview: 'preview', running: 'running', done: 'done' };
const STEP_TEXT = {
    choose: 'Step 1 of 4: choose a file. Nothing is written until you have checked the rows.',
    preview: 'Step 2 of 4: check the rows. Nothing has been written yet.',
    running: 'Step 3 of 4: importing.',
    done: 'Step 4 of 4: done.'
};
/** A file cell as text: CSV cells are text, Excel's are { v }. */
const cellText = cell => (cell == null ? '' : typeof cell === 'string' ? cell : String(cell.v));

/** Said when the browser refuses the file (see gridCsv.downloadCsv). */
const DOWNLOAD_REFUSED = 'This browser did not allow the file to be downloaded.';

function messageOf(error) {
    if (!error) return 'Unknown error.';
    const body = error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    return error.message || String(error);
}

/**
 * What Undo import writes back to an updated record: the server's
 * `previous`, and blank for each field the import wrote that `previous` does
 * not name. A field that was blank comes back from the server without its
 * key, as Apex leaves out null values.
 */
export function previousOf(previous, sent) {
    const out = { ...previous };
    Object.keys(sent || {}).forEach(field => {
        if (field !== 'Id' && !Object.prototype.hasOwnProperty.call(out, field)) out[field] = null;
    });
    return out;
}

/** A file's contents: text in an encoding, or an ArrayBuffer. */
export function readFile(file, encoding) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The file could not be read.'));
        if (encoding) reader.readAsText(file, encoding);
        else reader.readAsArrayBuffer(file);
    });
}

/**
 * The file as read: { table, sheets, sheet, bytes }. A workbook also gives
 * its sheets' names, the one read (the first) and its bytes, to read another
 * sheet from. Throws with a message the user can act on.
 */
export async function readWorkbook(file) {
    const name = String(file.name || '').toLowerCase();
    if (file.size > MAX_FILE_BYTES)
        throw new Error('The file is larger than 20 MB. Split it, or import fewer columns.');
    if (name.endsWith('.xls')) {
        throw new Error(
            'This is an old Excel .xls file. Save it from Excel as "Excel Workbook (.xlsx)" or as CSV, then try again.'
        );
    }
    if (name.endsWith('.xlsx')) {
        const bytes = await readFile(file);
        const book = readXlsx(bytes);
        return { table: book.rows, sheets: book.sheets || [book.sheet], sheet: book.sheet, bytes };
    }
    let text = await readFile(file, 'utf-8');
    if (text.includes(REPLACEMENT_CHARACTER)) text = await readFile(file, 'windows-1252');
    return { table: parseCsv(text), sheets: [], sheet: null, bytes: null };
}

/** The file's rows: CSV text or Excel's typed cells (the first sheet). */
export async function readTable(file) {
    return (await readWorkbook(file)).table;
}

export default class GridImportDialog extends LightningElement {
    /** The grid's columns, as the server sent them. */
    @api columns = [];
    /** The loaded rows, for the object's Id prefix and current values. */
    @api rows = [];
    /** Lookup names { [recordId]: name }, so a lookup can be given by name. */
    @api refNames = {};
    /** The user may create records of the object. */
    @api canCreate = false;
    @api configName;
    /**
     * In a child table, its tab and parent record: { link, id }. The
     * server fills in the parent on every row it creates.
     */
    @api parent;
    /**
     * On a record page, the page's record: the server fills it into
     * the Record Page Field of every record the import creates.
     */
    @api recordId;

    step = 'choose'; // choose | reading | preview | running | done
    fileName = '';
    error = '';
    plan = null;
    progress = { done: 0, total: 0 };
    outcome = null;
    /** The user's hand mappings, { [file column]: MAP_ID | MAP_SKIP | field }. */
    overrides = {};
    /** An External Id column to match records by, instead of the record Id. */
    matchField = null;
    /** A workbook's sheets, and the one read. */
    sheets = [];
    /** Records the server found by the names in the file's lookup columns: { [id]: name }. */
    foundNames = {};
    /** The server is looking up names: Import waits for it. */
    findingNames = false;
    // Non-reactive: the names already asked about (field and lower-case name), and the latest search (HR-20).
    _names = { asked: new Set(), token: 0 };
    sheet = null;
    /** Undo import: null, 'confirm', 'running' or 'done'; and what it did. */
    undoState = null;
    undoOutcome = null;

    dragOver = false;

    // Non-reactive (HR-20).
    _layout = { focused: false };
    _run = { changed: false };
    /** The file as read, for the rows-with-problems download, and a workbook's bytes, to read another sheet. */
    _file = { table: null, bytes: null };

    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector('[data-first]');
        if (first && typeof first.focus === 'function') {
            this._layout.focused = true;
            first.focus();
        }
    }

    /** The parent of a child table, as the server takes it; nothing for a top-level grid. */
    get parentParams() {
        const p = this.parent;
        return p && p.link && p.id ? { parentLink: p.link, parentId: p.id } : {};
    }

    // ============================================================ steps

    get isChoose() {
        return this.step === 'choose' || this.step === 'reading';
    }

    get isReading() {
        return this.step === 'reading';
    }

    get isPreview() {
        return this.step === 'preview';
    }

    get isRunning() {
        return this.step === 'running';
    }

    get isDone() {
        return this.step === 'done';
    }

    get heading() {
        return this.isDone ? 'Import finished' : 'Import from a file';
    }

    /** The step the progress indicator shows. */
    get currentStep() {
        return STEP_OF[this.step] || 'choose';
    }

    /**
     * The step in words, under the indicator: its dots show a step's
     * name only on hover, and the point of showing them is that nothing is
     * written before the rows are checked (found in Lightning Experience).
     */
    get stepText() {
        return STEP_TEXT[this.currentStep];
    }

    get createRule() {
        return this.canCreate === true
            ? 'A row with a record Id updates that record; a row without one creates a record.'
            : 'Every row needs a record Id, which it updates: you cannot create records here.';
    }

    get dropzoneClass() {
        return 'slds-file-selector__dropzone rh-import-drop' + (this.dragOver ? ' slds-has-drag-over' : '');
    }

    handleDragOver(event) {
        event.preventDefault();
        if (!this.dragOver) this.dragOver = true;
    }

    handleDragLeave() {
        this.dragOver = false;
    }

    /** A file dropped on the zone is read as a chosen one. */
    handleDrop(event) {
        event.preventDefault();
        this.dragOver = false;
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length && !this.isReading) this.readChosen(files[0]);
    }

    /** The grid's importable columns, with an Id first: a file to fill in. */
    handleTemplate() {
        const editable = importableColumns(this.columns);
        const columns = [{ field: 'Id', label: 'Id' }].concat(editable.map(c => ({ field: c.field, label: c.label })));
        if (
            !downloadCsv(toCsv([], columns), 'import-template.csv', this.template.querySelector('.rh-import-download'))
        ) {
            this.error = DOWNLOAD_REFUSED;
        }
    }

    format(n) {
        return new Intl.NumberFormat(LOCALE).format(n);
    }

    // ============================================================ choose

    async handleFile(event) {
        const files = (event.detail && event.detail.files) || (event.target && event.target.files) || [];
        const file = files[0];
        if (!file) return;
        await this.readChosen(file);
    }

    async readChosen(file) {
        this.fileName = file.name;
        this.error = '';
        this.step = 'reading';
        this.overrides = {};
        this.matchField = null;
        try {
            const book = this.firstUsableSheet(await readWorkbook(file));
            this._file = { table: book.table, bytes: book.bytes };
            this.sheets = book.sheets || [];
            this.sheet = book.sheet;
            const plan = this.planFor(book.table);
            if (plan.error && !plan.unmapped) {
                this.error = plan.error;
                this.step = 'choose';
                return;
            }
            // No header names a column: the check opens anyway, so the user
            // can map the columns by hand, or choose another sheet.
            this.error = plan.unmapped ? UNMAPPED_TEXT : '';
            this.plan = plan;
            this.matchByKeyWithoutIds();
            this.step = 'preview';
            this.findNames();
        } catch (e) {
            this.error = messageOf(e);
            this.step = 'choose';
        }
    }

    /**
     * A workbook whose first sheet names none of the grid's columns (a sheet of
     * notes, say) opens on its first sheet that does, if any.
     */
    firstUsableSheet(book) {
        if (!book.bytes || (book.sheets || []).length < 2 || !this.planFor(book.table).unmapped) return book;
        for (const name of book.sheets) {
            if (name !== book.sheet) {
                const other = readXlsx(book.bytes, name);
                if (!this.planFor(other.rows).unmapped) return { ...book, table: other.rows, sheet: other.sheet };
            }
        }
        return book;
    }

    /** The plan for the file's rows, with the user's choices. */
    planFor(table) {
        return planImport(table, {
            columns: this.columns,
            rows: this.rows,
            refNames: this.allNames,
            canCreate: this.canCreate === true,
            overrides: this.overrides,
            matchField: this.matchField
        });
    }

    /** The check again, after a choice: an error stays in the check, so the user can choose again. */
    replan() {
        const plan = this.planFor(this._file.table);
        this.error = plan.unmapped ? UNMAPPED_TEXT : plan.error || '';
        this.plan = plan;
        if (plan.matchField !== undefined && plan.matchField !== this.matchField)
            this.matchField = plan.matchField || null;
        this.findNames();
    }

    /** The grid's names and the ones the server found: { [id]: name }. */
    get allNames() {
        return { ...(this.refNames || {}), ...this.foundNames };
    }

    /**
     * A name in a lookup column of the file that no row of the grid points
     * to is looked up on the server, once: the records it names are any the
     * user can see. When some are found the file is checked again, and the
     * grid is told their names (namesfound). Import waits until then.
     */
    async findNames() {
        if (!this.configName || !this.plan || !this._file) return;
        const asked = this._names.asked;
        const asks = lookupTexts(this._file.table, this.plan.mapping)
            .map(({ field, texts }) => ({
                field,
                names: unknownNames(texts, this.allNames).filter(n => !asked.has(field + '\n' + n.toLowerCase()))
            }))
            .filter(a => a.names.length);
        if (!asks.length) return;
        asks.forEach(a => a.names.forEach(n => asked.add(a.field + '\n' + n.toLowerCase())));
        const token = ++this._names.token;
        this.findingNames = true;
        const answers = await Promise.all(
            asks.map(a =>
                findLookupNames({ configName: this.configName, field: a.field, names: a.names }).then(
                    namesFound,
                    () => ({})
                )
            )
        );
        if (token !== this._names.token) return;
        this.findingNames = false;
        const found = Object.assign({}, ...answers);
        if (!Object.keys(found).length || !this._file) return;
        this.foundNames = { ...this.foundNames, ...found };
        this.dispatchEvent(new CustomEvent('namesfound', { detail: { names: found } }));
        this.replan();
    }

    // ============================================================ choices

    get hasSheets() {
        return this.sheets.length > 1;
    }

    get sheetOptions() {
        return this.sheets.map(name => ({ value: name, label: name, selected: name === this.sheet }));
    }

    /** Another sheet of the workbook: read it, and check it as a new file. */
    handleSheet(event) {
        const name = event.target.value;
        if (!this._file.bytes || name === this.sheet) return;
        try {
            const book = readXlsx(this._file.bytes, name);
            this._file = { ...this._file, table: book.rows };
            this.sheet = book.sheet;
            this.overrides = {};
            this.matchField = null;
            this.replan();
            this.matchByKeyWithoutIds();
        } catch (e) {
            this.error = messageOf(e);
        }
    }

    /**
     * A file with no record Id column but an External Id column matches records
     * by that column to begin with, so updating by a key does not create
     * a copy of every record by mistake. The user can still choose Record Id,
     * which creates a record for every row.
     */
    matchByKeyWithoutIds() {
        const plan = this.plan;
        if (!plan || plan.error || this.matchField || plan.mapping.idIndex >= 0) return;
        const key = plan.mapping.fields.find(f => f.column.externalId);
        if (!key) return;
        this.matchField = key.column.field;
        this.replan();
    }

    /** Each file column, and what it is imported as, with the choices. */
    get mappingRows() {
        const header = (this.plan && this.plan.header) || [];
        const choices = mappingChoices(this.columns);
        const out = [];
        header.forEach((cell, index) => {
            const name = cellText(cell).trim();
            if (!name && !Object.prototype.hasOwnProperty.call(this.overrides, index)) return;
            const value = mappedTo(this.plan.mapping, index);
            const ignored = this.plan.mapping.ignored.find(g => g.index === index);
            out.push({
                key: 'm' + index,
                index,
                header: name || `Column ${index + 1}`,
                label: `Import ${name || 'column ' + (index + 1)} as`,
                note: ignored && ignored.reason !== 'You chose not to import it.' ? ignored.reason : '',
                options: choices.map(c => ({ ...c, selected: c.value === value }))
            });
        });
        return out;
    }

    handleMapping(event) {
        const index = Number(event.target.dataset.index);
        this.overrides = { ...this.overrides, [index]: event.target.value };
        this.replan();
    }

    /** External Id columns in the file, to match records by instead of the record Id. */
    get matchOptions() {
        const mapped = this.plan ? this.plan.mapping.fields.filter(f => f.column.externalId) : [];
        if (!mapped.length) return null;
        return [{ value: '', label: 'Record Id', selected: !this.matchField }].concat(
            mapped.map(f => ({
                value: f.column.field,
                label: f.column.label,
                selected: this.matchField === f.column.field
            }))
        );
    }

    handleMatch(event) {
        this.matchField = event.target.value || null;
        this.replan();
    }

    // ============================================================ preview

    get summary() {
        const c = this.plan.counts;
        const parts = [];
        if (c.update)
            parts.push(`${this.format(c.update)} ${c.update === 1 ? 'row updates a record' : 'rows update records'}`);
        if (c.create)
            parts.push(`${this.format(c.create)} ${c.create === 1 ? 'row creates a record' : 'rows create records'}`);
        if (c.match)
            parts.push(
                `${this.format(c.match)} ${c.match === 1 ? 'row updates the record' : 'rows update the records'} with ${this.matchLabel}, or ${c.match === 1 ? 'creates one' : 'create them'}`
            );
        if (c.error)
            parts.push(
                `${this.format(c.error)} ${c.error === 1 ? 'row has' : 'rows have'} problems and will not be imported`
            );
        return parts.length ? parts.join('; ') + '.' : 'There are no rows to import.';
    }

    /** The plan can be imported as it stands: no error over the whole file. */
    get planReady() {
        return Boolean(this.plan) && !this.plan.error;
    }

    get mappedText() {
        return this.plan.mapping.fields.map(f => f.column.label).join(', ');
    }

    get idText() {
        if (this.plan.matchField)
            return `Records are matched by ${this.matchLabel}: a row whose value a record has updates it; any other row creates a record.`;
        return this.plan.mapping.idIndex >= 0
            ? 'Rows with a record Id update that record; rows without one create a record.'
            : 'The file has no Id column, so every row creates a record.';
    }

    get matchLabel() {
        const c = (this.columns || []).find(x => x.field === this.matchField);
        return c ? c.label : this.matchField;
    }

    get ignored() {
        return this.plan.mapping.ignored.map((g, i) => ({ key: 'i' + i, text: `${g.header}: ${g.reason}` }));
    }

    get hasIgnored() {
        return this.plan.mapping.ignored.length > 0;
    }

    get previewColumns() {
        return this.plan.mapping.fields.map(f => ({
            key: f.column.field,
            label: f.column.label,
            cls: isNumericType(f.column.type) ? 'slds-text-align_right' : ''
        }));
    }

    /**
     * The first rows as they will be written. An update shows what changes,
     * "old → new", against the row as loaded; a value that stays is
     * shown once. Figures are right-aligned, as in the grid.
     */
    get previewRows() {
        const fields = this.plan.mapping.fields.map(f => f.column);
        const names = this.allNames;
        const loaded = new Map((this.rows || []).map(r => [String(r.Id).slice(0, 15), r]));
        // An amount is in its record's currency: the loaded row's, or a new record's own.
        const shown = (value, c, row) => (isLookup(c.type) ? lookupText(value, names) : formatValue(value, c, row));
        return this.plan.items
            .filter(item => !item.errors.length)
            .slice(0, PREVIEW_ROWS)
            .map(item => {
                const before = item.action === 'update' && item.id ? loaded.get(item.id.slice(0, 15)) : null;
                return {
                    key: 'p' + item.line,
                    line: item.line,
                    action:
                        item.action === 'update' ? 'Update' : item.action === 'match' ? 'Update or create' : 'Create',
                    cells: fields.map(c => {
                        const text = shown(item.values[c.field], c, before || item.values);
                        const old = before ? shown(before[c.field], c, before) : null;
                        const changed = before !== null && old !== text;
                        return {
                            key: c.field,
                            text: changed ? `${old || '(blank)'} → ${text || '(blank)'}` : text,
                            cls:
                                (isNumericType(c.type) ? 'slds-text-align_right' : '') +
                                (changed ? ' rh-import-changed' : '')
                        };
                    })
                };
            });
    }

    /** The three figures at the top of the check. */
    get countFigures() {
        const c = this.plan.counts;
        const box = 'slds-box slds-box_x-small slds-text-align_center rh-import-count';
        // Matched by an External Id: only the server knows which update and which create.
        const matched = c.match
            ? [{ key: 'match', value: this.format(c.match), label: 'update or create', cls: box }]
            : [];
        return matched
            .concat([
                {
                    key: 'update',
                    value: this.format(c.update),
                    label: c.update === 1 ? 'update' : 'updates',
                    cls: 'slds-box slds-box_x-small slds-text-align_center rh-import-count'
                },
                {
                    key: 'create',
                    value: this.format(c.create),
                    label: c.create === 1 ? 'new record' : 'new records',
                    cls: 'slds-box slds-box_x-small slds-text-align_center rh-import-count'
                },
                {
                    key: 'error',
                    value: this.format(c.error),
                    label: c.error === 1 ? 'row with problems' : 'rows with problems',
                    cls:
                        'slds-box slds-box_x-small slds-text-align_center rh-import-count' +
                        (c.error ? ' slds-text-color_error' : '')
                }
            ])
            .filter(f => !(c.match && (f.key === 'update' || f.key === 'create') && !c[f.key]));
    }

    /** Nothing can be imported: said, not only shown by a disabled button. */
    get nothingToImport() {
        return this.isPreview && !this.importCount;
    }

    get nothingText() {
        return this.plan && this.plan.counts.error
            ? 'Nothing in this file can be imported. Fix the rows with problems, then choose the file again.'
            : 'This file has no rows to import.';
    }

    get hasPreviewRows() {
        return this.importCount > 0;
    }

    /**
     * Every problem, one row each: the line, the column, what the file
     * says there, and what is wrong. The first PROBLEMS_SHOWN rows with
     * problems.
     */
    get problems() {
        const out = [];
        this.plan.items
            .filter(item => item.errors.length)
            .slice(0, PROBLEMS_SHOWN)
            .forEach(item => {
                item.errors.forEach((e, i) => {
                    out.push({
                        key: 'e' + item.line + ':' + i,
                        line: item.line,
                        column: e.column || '',
                        raw: e.raw || '',
                        problem: e.problem || e.message
                    });
                });
            });
        return out;
    }

    /** The rows with problems, as they are in the file, with a Problem column: to fix and import again. */
    handleDownloadProblems() {
        const table = this._file.table || [];
        const headerIndex = table.findIndex(r => r && r.some(c => cellText(c).trim() !== ''));
        if (headerIndex < 0) return;
        const header = table[headerIndex].map(cellText);
        const columns = header
            .map((h, i) => ({ field: 'c' + i, label: h }))
            .concat([{ field: 'problem', label: 'Problem' }]);
        const rows = this.plan.items
            .filter(item => item.errors.length)
            .map(item => {
                const cells = table[item.line - 1] || [];
                const row = { problem: item.errors.map(e => e.message).join(' ') };
                header.forEach((h, i) => {
                    row['c' + i] = cellText(cells[i]);
                });
                return row;
            });
        const base = String(this.fileName || 'import').replace(/\.[^.]+$/, '');
        if (
            !downloadCsv(
                toCsv(rows, columns),
                `${base}-problems.csv`,
                this.template.querySelector('.rh-import-download')
            )
        ) {
            this.error = DOWNLOAD_REFUSED;
        }
    }

    get hasProblems() {
        return this.plan.counts.error > 0;
    }

    get problemsTitle() {
        const n = this.plan.counts.error;
        const shown = Math.min(n, PROBLEMS_SHOWN);
        return n > shown ? `Rows held back (the first ${shown} of ${this.format(n)})` : 'Rows held back';
    }

    get importCount() {
        return this.plan ? this.plan.counts.update + this.plan.counts.create + (this.plan.counts.match || 0) : 0;
    }

    get importLabel() {
        const n = this.importCount;
        return `Import ${this.format(n)} ${n === 1 ? 'row' : 'rows'}`;
    }

    get importDisabled() {
        return !this.importCount || this.findingNames;
    }

    handleBack() {
        this.plan = null;
        this.error = '';
        this.step = 'choose';
        this.overrides = {};
        this.matchField = null;
        this.sheets = [];
        this.sheet = null;
        this._layout.focused = false;
    }

    // ============================================================ import

    get percent() {
        return this.progress.total ? Math.round((this.progress.done / this.progress.total) * 100) : 0;
    }

    get progressText() {
        return `Importing… ${this.format(this.progress.done)} of ${this.format(this.progress.total)} rows`;
    }

    async handleImport() {
        if (!this.importCount || this.isRunning) return;
        const items = this.plan.items.filter(item => !item.errors.length);
        const payload = payloadFor(items);
        this.progress = { done: 0, total: payload.length };
        this.step = 'running';
        const outcome = {
            updated: 0,
            created: 0,
            failed: [],
            stopped: null,
            rejected: new Set(),
            stripped: new Set(),
            undo: { updates: [], created: [] }
        };
        const match = this.plan.matchField ? { matchField: this.plan.matchField } : {};
        let start = 0;
        for (const batch of batchesOf(payload)) {
            let result;
            try {
                // Batches are sequential by design: each is its own transaction.
                // eslint-disable-next-line no-await-in-loop
                result = await importRows({
                    configName: this.configName,
                    rows: batch,
                    ...this.parentParams,
                    recordId: this.recordId || null,
                    ...match
                });
            } catch (e) {
                outcome.stopped = messageOf(e);
                break;
            }
            const offset = start; // this batch's first row, fixed for the callback
            (result.rows || []).forEach(r => {
                const item = items[offset + r.index];
                if (r.success) {
                    this._run.changed = true;
                    // What Undo import puts back, or takes away.
                    if (r.created) {
                        outcome.created++;
                        if (r.recordId) outcome.undo.created.push(r.recordId);
                    } else {
                        outcome.updated++;
                        if (r.recordId && r.previous)
                            outcome.undo.updates.push({ Id: r.recordId, ...previousOf(r.previous, batch[r.index]) });
                    }
                } else if (item) {
                    outcome.failed.push({ key: 'f' + item.line, line: item.line, text: r.message || 'Not saved.' });
                }
            });
            (result.rejectedFields || []).forEach(f => outcome.rejected.add(f));
            (result.strippedFields || []).forEach(f => outcome.stripped.add(f));
            start += batch.length;
            this.progress = { done: start, total: payload.length };
        }
        this.outcome = outcome;
        this.step = 'done';
        this._layout.focused = false;
    }

    // ============================================================ done

    get resultText() {
        const o = this.outcome;
        const parts = [];
        if (o.updated) parts.push(`updated ${this.format(o.updated)} ${o.updated === 1 ? 'record' : 'records'}`);
        if (o.created) parts.push(`created ${this.format(o.created)} ${o.created === 1 ? 'record' : 'records'}`);
        let text = parts.length ? `The import ${parts.join(' and ')}.` : 'Nothing was imported.';
        if (o.stopped) text += ` It stopped early: ${o.stopped}`;
        return text;
    }

    get fieldsText() {
        const o = this.outcome;
        const label = f => ((this.columns || []).find(c => c.field === f) || {}).label || f;
        const parts = [];
        if (o.stripped.size) parts.push(`not written because of your access: ${[...o.stripped].map(label).join(', ')}`);
        if (o.rejected.size) parts.push(`not editable in this grid: ${[...o.rejected].map(label).join(', ')}`);
        return parts.length ? `Some columns were skipped, ${parts.join('; ')}.` : '';
    }

    get failures() {
        return this.outcome.failed.slice(0, PROBLEMS_SHOWN);
    }

    get hasFailures() {
        return this.outcome.failed.length > 0;
    }

    get failuresTitle() {
        const n = this.outcome.failed.length;
        return `${this.format(n)} ${n === 1 ? 'row was' : 'rows were'} not saved`;
    }

    // ============================================================ undo

    /** Undo import is offered once the import wrote something, until it is undone. */
    get canUndo() {
        const u = this.outcome && this.outcome.undo;
        return Boolean(u) && u.updates.length + u.created.length > 0 && this.undoState === null;
    }

    get undoConfirming() {
        return this.undoState === 'confirm';
    }

    get undoRunning() {
        return this.undoState === 'running';
    }

    get undoDone() {
        return this.undoState === 'done';
    }

    get undoText() {
        const u = this.outcome.undo;
        const parts = [];
        if (u.updates.length)
            parts.push(
                `puts the ${this.format(u.updates.length)} ${u.updates.length === 1 ? 'record' : 'records'} it updated back as they were`
            );
        if (u.created.length)
            parts.push(
                `deletes the ${this.format(u.created.length)} ${u.created.length === 1 ? 'record' : 'records'} it created (to the Recycle Bin)`
            );
        return `Undo ${parts.join(' and ')}. Any change made to those records since the import is overwritten.`;
    }

    handleUndo() {
        this.undoState = 'confirm';
    }

    handleKeep() {
        this.undoState = null;
    }

    /** Put back what the import changed: the old values through the import's own path, then the new records deleted. */
    async handleUndoConfirm() {
        const u = this.outcome.undo;
        this.undoState = 'running';
        const result = { restored: 0, deleted: 0, failed: [], stopped: null };
        for (const batch of batchesOf(u.updates)) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const r = await importRows({
                    configName: this.configName,
                    rows: batch,
                    ...this.parentParams,
                    recordId: this.recordId || null
                });
                (r.rows || []).forEach(row => {
                    if (row.success) result.restored++;
                    else
                        result.failed.push({
                            key: 'u' + result.failed.length,
                            text: `${batch[row.index].Id}: ${row.message || 'Not put back.'}`
                        });
                });
            } catch (e) {
                result.stopped = messageOf(e);
                break;
            }
        }
        for (let i = 0; i < u.created.length && !result.stopped; i += IMPORT_BATCH) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const r = await undoImport({
                    configName: this.configName,
                    recordIds: u.created.slice(i, i + IMPORT_BATCH)
                });
                result.deleted += (r.deletedIds || []).length;
                (r.errors || []).forEach(e =>
                    result.failed.push({ key: 'd' + result.failed.length, text: `${e.recordId}: ${e.message}` })
                );
            } catch (e) {
                result.stopped = messageOf(e);
            }
        }
        this._run.changed = true;
        this.undoOutcome = result;
        this.undoState = 'done';
    }

    get undoResultText() {
        const o = this.undoOutcome;
        const parts = [];
        if (o.restored) parts.push(`put back ${this.format(o.restored)} ${o.restored === 1 ? 'record' : 'records'}`);
        if (o.deleted) parts.push(`deleted ${this.format(o.deleted)} new ${o.deleted === 1 ? 'record' : 'records'}`);
        let text = parts.length ? `Undo ${parts.join(' and ')}.` : 'Nothing was undone.';
        if (o.stopped) text += ` It stopped early: ${o.stopped}`;
        return text;
    }

    get undoFailures() {
        return this.undoOutcome ? this.undoOutcome.failed.slice(0, PROBLEMS_SHOWN) : [];
    }

    get hasUndoFailures() {
        return this.undoFailures.length > 0;
    }

    // ============================================================ closing and focus

    handleClose() {
        if (this.isRunning || this.undoRunning) return;
        this.dispatchEvent(new CustomEvent('close', { detail: { changed: this._run.changed } }));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.handleClose();
        }
    }

    handleGuardStart() {
        const buttons = this.template.querySelectorAll('.slds-modal__footer button:not([disabled])');
        const last = buttons[buttons.length - 1];
        if (last) last.focus();
    }

    /** Tab from the last control goes round to the first, the close button. */
    handleGuardEnd() {
        const close = this.template.querySelector('.slds-modal__close');
        if (close && typeof close.focus === 'function') close.focus();
    }

    /** After the file step, focus starts on the heading, so the summary is read next. */
    get focusHeading() {
        return this.isChoose ? null : '';
    }
}
