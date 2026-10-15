/**
 * gridConfigFile — the file the Grid Admin tab exports grids to and imports
 * them from: plain logic, no template.
 *
 * THE FILE
 * JSON, so an admin can read it, keep it in source control or share it:
 *   {
 *     "kind": "rowhouse-grids",   what the file is
 *     "version": 1,               its layout; a newer one is refused, not guessed at
 *     "exported": "2026-10-11T…", when
 *     "grids": [ … ]              each grid as the Grid Admin tab's draft, child grids first
 *   }
 * A grid is its configuration and every column, display rule, filter, action
 * and child table, turned off or not, by API name. Nothing else: no records,
 * no user's saved layout, no page, and nothing about the org it came from.
 *
 * READING
 * readGridFile refuses anything that is not such a file, in words the admin
 * can act on, and gives back the grids. It checks only the file's shape: the
 * server checks every grid in full, as it checks a grid saved on the tab.
 */

export const FILE_KIND = 'rowhouse-grids';
export const FILE_VERSION = 1;
/** Fifty grids take a fraction of this. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Grids in one file; the server allows the same. */
export const MAX_GRIDS = 50;

const LISTS = ['columns', 'rules', 'filters', 'actions', 'children'];
/** Kept by the org that saves the grid, not carried in a file. */
const ORG_ONLY = ['isNew', 'archived'];

/** The file for these drafts (the server's export), as an object. */
export function fileFor(drafts, exported) {
    return {
        kind: FILE_KIND,
        version: FILE_VERSION,
        exported: exported instanceof Date ? exported.toISOString() : String(exported || ''),
        grids: (drafts || []).map(d => {
            const config = { ...(d.config || {}) };
            ORG_ONLY.forEach(k => delete config[k]);
            const grid = { config };
            LISTS.forEach(list => {
                grid[list] = Array.isArray(d[list]) ? d[list].map(item => ({ ...item })) : [];
            });
            return grid;
        })
    };
}

/** The file's text: indented, so it reads well and compares line by line. */
export function fileText(drafts, exported) {
    return JSON.stringify(fileFor(drafts, exported), null, 2) + '\n';
}

/**
 * The file's name: the grid's API name for one grid asked for (its child
 * grids go with it), otherwise "rowhouse-grids" and the date.
 */
export function fileName(requested, exported) {
    const names = (requested || []).filter(Boolean);
    if (names.length === 1) return `${names[0]}.rowhouse.json`;
    const when = exported instanceof Date ? exported : new Date();
    const pad = n => String(n).padStart(2, '0');
    return `rowhouse-grids-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}.json`;
}

/** Said whenever a file is not one of ours. */
export const NOT_A_GRID_FILE = 'This is not a grid file. Export grids from the Grid Admin tab, then import that file.';

/** The grids in a file's text. Throws, with what to do, when it is not a grid file. */
export function readGridFile(text) {
    let file;
    // A byte order mark, if an editor added one, is not JSON. As a code point:
    // an escape in source has reached the org as the invisible character.
    const bom = String.fromCharCode(0xfeff);
    const body = String(text || '');
    try {
        file = JSON.parse(body.startsWith(bom) ? body.slice(1) : body);
    } catch {
        throw new Error(NOT_A_GRID_FILE);
    }
    if (!file || typeof file !== 'object' || Array.isArray(file) || file.kind !== FILE_KIND) {
        throw new Error(NOT_A_GRID_FILE);
    }
    if (typeof file.version !== 'number' || file.version > FILE_VERSION) {
        throw new Error('This file was exported from a newer Rowhouse. Upgrade Rowhouse in this org, then import it.');
    }
    if (!Array.isArray(file.grids) || file.grids.length === 0) {
        throw new Error('The file has no grids.');
    }
    if (file.grids.length > MAX_GRIDS) {
        throw new Error(`The file has ${file.grids.length} grids. Import at most ${MAX_GRIDS} at a time.`);
    }
    return file.grids.map((g, i) => {
        if (!g || typeof g !== 'object' || !g.config || typeof g.config !== 'object') {
            throw new Error(`Grid ${i + 1} in the file is not a grid. Export the grids again.`);
        }
        const grid = { config: { ...g.config } };
        LISTS.forEach(list => {
            if (g[list] !== undefined && g[list] !== null && !Array.isArray(g[list])) {
                throw new Error(`Grid ${i + 1} in the file is not a grid. Export the grids again.`);
            }
            grid[list] = Array.isArray(g[list]) ? g[list] : [];
        });
        return withCurrentNames(grid);
    });
}

/**
 * Values an earlier beta wrote, as they are named now, so a file exported
 * before the rename imports as it was: an Action Type, a Show In, a gray
 * look, and a display rule's on/off (once Active, now Inactive as for every
 * other entry). Anything else is left for the server to check.
 */
const EARLIER_NAMES = {
    type: { ScreenFlow: 'screen_flow', Flow: 'autolaunched_flow', QuickAction: 'quick_action' },
    showIn: { Both: 'row_menu_and_selection', Row: 'row_menu', Selection: 'selection' },
    style: { fill_grey: 'fill_gray', text_grey: 'text_gray' }
};

export function withCurrentNames(grid) {
    const renamed = (item, prop) => {
        if (!item || typeof item !== 'object') return item;
        const now = EARLIER_NAMES[prop][item[prop]];
        return now ? { ...item, [prop]: now } : item;
    };
    const rules = grid.rules.map(r => {
        let rule = renamed(r, 'style');
        if (rule && typeof rule === 'object' && 'active' in rule && !('inactive' in rule)) {
            const { active, ...rest } = rule;
            rule = { ...rest, inactive: active === false };
        }
        return rule;
    });
    const actions = grid.actions.map(a => renamed(renamed(a, 'type'), 'showIn'));
    return { ...grid, rules, actions };
}

/** A file's text, read as UTF-8. Throws when it is too large or cannot be read. */
export function readText(file) {
    if (file && file.size > MAX_FILE_BYTES) {
        return Promise.reject(new Error('The file is larger than 2 MB. Export fewer grids at a time.'));
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The file could not be read.'));
        reader.readAsText(file, 'utf-8');
    });
}

function counted(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

/** What a grid holds: "6 columns, 2 display rules and 1 child table". */
export function contents(grid) {
    const g = grid || {};
    const size = list => (Array.isArray(g[list]) ? g[list].length : 0);
    const parts = [counted(size('columns'), 'column', 'columns')];
    if (size('rules')) parts.push(counted(size('rules'), 'display rule', 'display rules'));
    if (size('filters')) parts.push(counted(size('filters'), 'filter', 'filters'));
    if (size('actions')) parts.push(counted(size('actions'), 'action', 'actions'));
    if (size('children')) parts.push(counted(size('children'), 'child table', 'child tables'));
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "A", "A and B", "A, B and C". */
export function listed(items) {
    const list = (items || []).filter(Boolean);
    if (list.length < 2) return list.join('');
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
