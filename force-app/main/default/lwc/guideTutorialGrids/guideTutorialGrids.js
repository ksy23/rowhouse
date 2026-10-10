/**
 * guideTutorialGrids — the grids each Grid Guide tutorial builds, as the
 * Grid Admin tab's drafts, so a grid admin can build them in one click
 * (c/guideBuildGrid) instead of following the build steps.
 *
 * Each tutorial's grids are listed in the order they are built: a grid shown
 * as another's child table comes before that grid, because a child table can
 * only name a grid that exists. Each draft is what the tutorial's build steps
 * leave, value for value: change a tutorial's steps, change its draft here,
 * and the counts in the Jest test with them.
 *
 * Record names are left to the server (it makes free ones from the grid's
 * name), so a build never takes over a record of another grid. Child tables
 * are the exception: a child total column names its child table, so those
 * are named here, after their grid, as the Grid Admin tab would name them.
 */
import {
    emptyDraft,
    newAction,
    newChild,
    newChildTotalColumn,
    newColumn,
    newFilter,
    newFormulaColumn,
    newRule,
    toServer
} from 'c/gridAdminDraft';

// ================================================================ builders

function grid(config, lists) {
    const draft = emptyDraft();
    draft.config = { ...draft.config, ...config };
    return toServer({ ...draft, ...lists });
}

/** A column on a field: [field, { editable, columnLabel, subtotal, ... }]. */
function col(field, extra) {
    return { ...newColumn(field), ...(extra || {}) };
}

const EDIT = { editable: true };

function rule(extra) {
    return { ...newRule(), ...extra };
}

function filter(extra) {
    return { ...newFilter(), ...extra };
}

function child(extra) {
    return { ...newChild(), ...extra };
}

function childTotal(childTable, extra) {
    return { ...newChildTotalColumn(childTable), ...(extra || {}) };
}

function logACall() {
    return { ...newAction(), label: 'Log a call', type: 'QuickAction', actionName: 'LogACall', showIn: 'Row' };
}

// ================================================================ the tutorials

function leads() {
    return [
        grid(
            { name: 'Lead_Queue', label: 'Lead Queue', objectApiName: 'Lead', sortField: 'LastName' },
            {
                columns: [
                    col('Name'),
                    col('Company', EDIT),
                    col('Title', EDIT),
                    col('Status', EDIT),
                    col('Rating', EDIT),
                    col('LeadSource', EDIT),
                    col('OwnerId', EDIT)
                ],
                filters: [filter({ label: 'Open leads', field: 'Status', operator: 'not_contains', value: 'Closed' })],
                rules: [
                    rule({
                        label: 'Hot, not contacted yet',
                        formula: 'AND(ISPICKVAL(Rating, "Hot"), ISPICKVAL(Status, "Open - Not Contacted"))',
                        style: 'fill_red',
                        applyTo: 'row'
                    }),
                    rule({ label: 'Hot', field: 'Rating', value: 'Hot', style: 'icon_up' }),
                    rule({ label: 'Cold', field: 'Rating', value: 'Cold', style: 'text_grey' })
                ],
                actions: [logACall()]
            }
        )
    ];
}

function groups() {
    return [
        grid(
            { name: 'Subsidiaries', label: 'Subsidiaries', objectApiName: 'Account', sortField: 'Name' },
            {
                columns: [
                    col('Name'),
                    col('Industry', EDIT),
                    col('AnnualRevenue', { ...EDIT, subtotal: 'sum' }),
                    col('NumberOfEmployees', { ...EDIT, subtotal: 'sum' })
                ]
            }
        ),
        grid(
            { name: 'Account_Groups', label: 'Account Groups', objectApiName: 'Account', sortField: 'Name' },
            {
                columns: [
                    col('Name'),
                    col('ParentId', EDIT),
                    col('Industry', EDIT),
                    col('AnnualRevenue', { ...EDIT, subtotal: 'sum' }),
                    childTotal('Account_Groups_Subsidiaries'),
                    childTotal('Account_Groups_Subsidiaries', {
                        childTotal: 'sum',
                        childField: 'AnnualRevenue',
                        columnLabel: "Subsidiaries' revenue"
                    })
                ],
                filters: [filter({ label: 'Top-level accounts', field: 'ParentId', operator: 'is_blank' })],
                rules: [
                    rule({ label: 'Revenue', field: 'AnnualRevenue', operator: 'is_not_blank', style: 'data_bar' })
                ],
                children: [
                    child({
                        name: 'Account_Groups_Subsidiaries',
                        childConfig: 'Subsidiaries',
                        relationshipField: 'ParentId'
                    })
                ]
            }
        )
    ];
}

function contacts() {
    return [
        grid(
            {
                name: 'Account_People',
                label: 'Account People',
                objectApiName: 'Contact',
                sortField: 'LastName',
                recordPageField: 'AccountId'
            },
            {
                columns: [
                    col('Name', { alwaysShown: true }),
                    col('Title', EDIT),
                    col('Email', EDIT),
                    col('Phone', EDIT),
                    col('AccountId'),
                    {
                        ...newFormulaColumn(),
                        formula: 'TODAY() - DATEVALUE(CreatedDate)',
                        formulaType: 'number',
                        decimalPlaces: 0,
                        columnLabel: 'Days on file'
                    }
                ],
                rules: [
                    rule({ label: 'Executive', field: 'Title', operator: 'contains', value: 'VP', style: 'icon_info' })
                ],
                filters: [filter({ label: 'Has email', field: 'Email', operator: 'is_not_blank' })]
            }
        )
    ];
}

function cleanup() {
    return [
        grid(
            {
                name: 'Contact_Cleanup',
                label: 'Contact Cleanup',
                objectApiName: 'Contact',
                sortField: 'LastName',
                allowImport: true,
                logChanges: true
            },
            {
                columns: [
                    col('FirstName', EDIT),
                    col('LastName', EDIT),
                    col('AccountId', { ...EDIT, columnLabel: 'Account' }),
                    col('Title', EDIT),
                    col('Email', EDIT),
                    col('Phone', { ...EDIT, columnLabel: 'Phone' }),
                    col('Department', EDIT),
                    col('LeadSource', EDIT),
                    col('Account.Industry', EDIT)
                ]
            }
        )
    ];
}

function accounts() {
    return [
        grid(
            {
                name: 'Key_Account_Contacts',
                label: 'Key Account Contacts',
                objectApiName: 'Contact',
                sortField: 'LastName'
            },
            {
                columns: [
                    col('Name', { columnLabel: 'Name' }),
                    col('Title', EDIT),
                    col('Email', EDIT),
                    col('Phone', { ...EDIT, columnLabel: 'Phone' })
                ]
            }
        ),
        grid(
            {
                name: 'Key_Account_Deals',
                label: 'Key Account Deals',
                objectApiName: 'Opportunity',
                sortField: 'CloseDate'
            },
            {
                columns: [
                    col('Name', { columnLabel: 'Opportunity' }),
                    col('StageName', EDIT),
                    col('Amount', { ...EDIT, subtotal: 'sum' }),
                    col('CloseDate', EDIT)
                ]
            }
        ),
        grid(
            {
                name: 'Key_Accounts',
                label: 'Key Accounts',
                objectApiName: 'Account',
                sortField: 'Name',
                frozenColumns: 1
            },
            {
                columns: [
                    col('Name'),
                    col('Type', { ...EDIT, columnLabel: 'Type' }),
                    col('Industry', EDIT),
                    col('AnnualRevenue', { ...EDIT, subtotal: 'sum' }),
                    col('Phone', { ...EDIT, columnLabel: 'Phone' }),
                    col('OwnerId', { columnLabel: 'Owner' })
                ],
                children: [
                    child({
                        name: 'Key_Accounts_Contacts',
                        childConfig: 'Key_Account_Contacts',
                        relationshipField: 'AccountId',
                        tabLabel: 'Contacts'
                    }),
                    child({
                        name: 'Key_Accounts_Deals',
                        childConfig: 'Key_Account_Deals',
                        relationshipField: 'AccountId',
                        tabLabel: 'Opportunities'
                    })
                ]
            }
        )
    ];
}

function pipeline() {
    return [
        grid(
            {
                name: 'Pipeline_Review',
                label: 'Pipeline Review',
                objectApiName: 'Opportunity',
                sortField: 'CloseDate',
                frozenColumns: 1
            },
            {
                columns: [
                    col('Name', { columnLabel: 'Opportunity' }),
                    col('AccountId', { ...EDIT, columnLabel: 'Account' }),
                    col('StageName', { ...EDIT, groupLevel: 1 }),
                    col('Amount', { ...EDIT, subtotal: 'sum' }),
                    col('Probability', { columnLabel: 'Probability', subtotal: 'average' }),
                    col('CloseDate', { ...EDIT, subtotal: 'min' }),
                    col('NextStep', { ...EDIT, wrap: true }),
                    col('OwnerId', { ...EDIT, columnLabel: 'Owner' })
                ],
                rules: [
                    rule({
                        label: 'Overdue',
                        field: 'CloseDate',
                        operator: 'less_than',
                        value: 'TODAY',
                        style: 'text_red'
                    }),
                    rule({
                        label: 'Big deal',
                        field: 'Amount',
                        operator: 'greater_or_equal',
                        value: '250000',
                        style: 'fill_green'
                    }),
                    rule({
                        label: 'In negotiation',
                        field: 'StageName',
                        value: 'Negotiation/Review',
                        style: 'fill_purple',
                        applyTo: 'row'
                    })
                ]
            }
        )
    ];
}

function assets() {
    return [
        grid(
            {
                name: 'Account_Assets',
                label: 'Account Assets',
                objectApiName: 'Asset',
                sortField: 'UsageEndDate',
                recordPageField: 'AccountId'
            },
            {
                columns: [
                    col('Name', EDIT),
                    col('Product2Id', EDIT),
                    col('SerialNumber', EDIT),
                    col('Status', EDIT),
                    col('UsageEndDate', { ...EDIT, columnLabel: 'Warranty ends' })
                ],
                rules: [
                    rule({
                        label: 'Warranty ends soon',
                        field: 'UsageEndDate',
                        operator: 'between',
                        value: 'TODAY',
                        valueTo: 'TODAY+90',
                        style: 'fill_amber'
                    }),
                    rule({
                        label: 'Warranty expired',
                        field: 'UsageEndDate',
                        operator: 'less_than',
                        value: 'TODAY',
                        style: 'text_red'
                    }),
                    rule({ label: 'Retired', field: 'Status', value: 'Obsolete', style: 'text_grey', applyTo: 'row' })
                ]
            }
        ),
        grid(
            { name: 'Installed_Base', label: 'Installed Base', objectApiName: 'Account', sortField: 'Name' },
            {
                columns: [
                    col('Name'),
                    col('Type'),
                    col('Industry'),
                    childTotal('Installed_Base_Assets'),
                    childTotal('Installed_Base_Assets', {
                        childTotal: 'min',
                        childField: 'UsageEndDate',
                        columnLabel: 'Earliest warranty end'
                    })
                ],
                children: [
                    child({
                        name: 'Installed_Base_Assets',
                        childConfig: 'Account_Assets',
                        relationshipField: 'AccountId',
                        tabLabel: 'Assets'
                    })
                ]
            }
        )
    ];
}

function service() {
    return [
        grid(
            {
                name: 'Service_Triage',
                label: 'Service Triage',
                objectApiName: 'Case',
                sortField: 'CreatedDate',
                sortDirection: 'desc',
                height: 480
            },
            {
                columns: [
                    col('CaseNumber', { columnLabel: 'Case' }),
                    col('Subject', { ...EDIT, wrap: true }),
                    col('AccountId', { columnLabel: 'Account' }),
                    col('Status', EDIT),
                    col('Priority', EDIT),
                    col('Origin', { columnLabel: 'Origin' }),
                    col('OwnerId', { ...EDIT, columnLabel: 'Owner' }),
                    col('CreatedDate', { columnLabel: 'Opened' })
                ],
                rules: [
                    rule({ label: 'High priority', field: 'Priority', value: 'High', style: 'fill_red' }),
                    rule({ label: 'Needs triage', field: 'Status', value: 'New', style: 'fill_amber', applyTo: 'row' }),
                    rule({ label: 'Escalated', field: 'IsEscalated', value: 'true', style: 'bold', applyTo: 'row' })
                ],
                actions: [logACall()]
            }
        )
    ];
}

const TUTORIALS = {
    'tutorial-leads': leads,
    'tutorial-groups': groups,
    'tutorial-contacts': contacts,
    'tutorial-cleanup': cleanup,
    'tutorial-accounts': accounts,
    'tutorial-pipeline': pipeline,
    'tutorial-assets': assets,
    'tutorial-service': service
};

/** The tutorials that have grids to build, by page id. */
export const TUTORIAL_IDS = Object.freeze(Object.keys(TUTORIALS));

/** A tutorial's grids as drafts for GridAdminController.saveDraft, in the order to build them; [] for none. */
export function gridsFor(tutorial) {
    const make = TUTORIALS[tutorial];
    return make ? make() : [];
}

function counted(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

/** What a draft makes: "7 columns, 3 display rules, 1 filter and 1 action". */
export function contents(draft) {
    const parts = [counted(draft.columns.length, 'column', 'columns')];
    if (draft.rules.length) parts.push(counted(draft.rules.length, 'display rule', 'display rules'));
    if (draft.filters.length) parts.push(counted(draft.filters.length, 'filter', 'filters'));
    if (draft.actions.length) parts.push(counted(draft.actions.length, 'action', 'actions'));
    if (draft.children.length) parts.push(counted(draft.children.length, 'child table', 'child tables'));
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
