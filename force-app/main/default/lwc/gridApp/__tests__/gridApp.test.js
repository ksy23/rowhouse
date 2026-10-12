/**
 * gridApp is the exposed shell (HR-2): it hands its setting, and on a record
 * page the page's record, to a top-level c/gridView, which is tested
 * in gridView.test.js and gridView.recordPage.test.js.
 */
import { createElement } from 'lwc';
import GridApp from 'c/gridApp';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from '../../gridView/__tests__/openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import getLayout from '@salesforce/apex/GridController.getLayout';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.getLayout', () => ({ default: jest.fn(() => Promise.resolve(null)) }), {
    virtual: true
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('gridApp', () => {
    beforeEach(() => {
        openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    });

    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        jest.clearAllMocks();
    });

    it('shows one top-level grid for its configuration, with no parent record', async () => {
        getGridConfig.mockReturnValue(new Promise(() => {})); // still loading: only the hand-over is under test
        const el = createElement('c-grid-app', { is: GridApp });
        el.configName = '  Consignments ';
        document.body.appendChild(el);
        await flush();
        const views = el.shadowRoot.querySelectorAll('c-grid-view');
        expect(views.length).toBe(1);
        expect(views[0].configName).toBe('Consignments');
        expect(views[0].parent).toBeFalsy();
        expect(getGridConfig).toHaveBeenCalledWith({ configName: 'Consignments' });
    });

    it('passes a new configuration name on', async () => {
        getGridConfig.mockReturnValue(new Promise(() => {}));
        const el = createElement('c-grid-app', { is: GridApp });
        el.configName = 'Consignments';
        document.body.appendChild(el);
        await flush();
        el.configName = 'Consignments_By_Mode';
        await flush();
        expect(el.shadowRoot.querySelector('c-grid-view').configName).toBe('Consignments_By_Mode');
    });

    describe('on a record page', () => {
        const RECORD = '001000000000001AAA';
        const mount = props => {
            const el = createElement('c-grid-app', { is: GridApp });
            Object.assign(el, { configName: 'Account_Deals', ...props });
            document.body.appendChild(el);
            return el;
        };

        it("hands its grid the page's record, trimmed", async () => {
            getGridConfig.mockReturnValue(new Promise(() => {}));
            const el = mount({ recordId: ` ${RECORD} ` });
            await flush();
            expect(el.recordId).toBe(RECORD);
            expect(el.shadowRoot.querySelector('c-grid-view').recordId).toBe(RECORD);
        });

        it('hands it no record off a record page', async () => {
            getGridConfig.mockReturnValue(new Promise(() => {}));
            const el = mount();
            await flush();
            expect(el.recordId).toBe('');
            expect(el.shadowRoot.querySelector('c-grid-view').recordId).toBe('');
        });

        it("passes a new record on, and its grid asks for that record's rows", async () => {
            getGridConfig.mockResolvedValue({
                definition: {
                    name: 'Account_Deals',
                    label: 'Deals',
                    sortField: 'Name',
                    sortDirection: 'asc',
                    recordPageField: 'Account__c',
                    columns: [{ field: 'Name', label: 'Name', type: 'text', sortable: true }]
                },
                diagnostics: false
            });
            fetchRows.mockResolvedValue({
                rows: [],
                hasMore: false,
                cursorLocator: null,
                cursorToken: null,
                totalRows: 0
            });
            const el = mount({ recordId: RECORD });
            await flush();
            expect(getLayout).toHaveBeenCalledWith({ configName: 'Account_Deals' });
            expect(fetchRows).toHaveBeenCalledWith(
                expect.objectContaining({ configName: 'Account_Deals', recordId: RECORD })
            );

            el.recordId = '001000000000002AAA';
            await flush();
            expect(el.shadowRoot.querySelector('c-grid-view').recordId).toBe('001000000000002AAA');
            expect(fetchRows).toHaveBeenLastCalledWith(expect.objectContaining({ recordId: '001000000000002AAA' }));
        });
    });
});
