/**
 * Handing a CSV file to the browser: through a Blob where the runtime allows
 * one (Lightning Web Security refuses a data: URL on a link), and as a data:
 * URL where the Blob or its URL is refused (Lightning Locker).
 */
import { downloadCsv } from 'c/gridCsv';

const BOM = String.fromCharCode(0xfeff);

/**
 * Reads a Blob's bytes (jsdom's Blob has no text() everywhere). Decoding as
 * text would drop the byte order mark, which is the thing to check.
 */
const bytesOf = blob =>
    new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.readAsArrayBuffer(blob);
    });

let host;
let clicked;
const savedCreate = URL.createObjectURL;
const savedRevoke = URL.revokeObjectURL;

beforeEach(() => {
    jest.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    clicked = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
        clicked.push({ href: this.href, download: this.download, inHost: this.parentNode === host });
    });
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    URL.createObjectURL = savedCreate;
    URL.revokeObjectURL = savedRevoke;
    host.remove();
});

describe('downloadCsv', () => {
    it('hands the file over as a Blob with a byte order mark, and lets the URL go afterwards', async () => {
        let blob;
        URL.createObjectURL = jest.fn(b => {
            blob = b;
            return 'blob:https://example.test/1';
        });
        URL.revokeObjectURL = jest.fn();

        expect(downloadCsv('Id,Name\n1,A\n', 'Test-Records.csv', host)).toBe(true);

        expect(clicked).toEqual([{ href: 'blob:https://example.test/1', download: 'Test-Records.csv', inHost: true }]);
        expect(host.childNodes.length).toBe(0);
        expect(blob.type).toBe('application/octet-stream'); // LWS refuses a URL for text/csv
        const bytes = await bytesOf(blob);
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // the byte order mark, in UTF-8
        expect(String.fromCharCode(...bytes.slice(3))).toBe('Id,Name\n1,A\n'); // ASCII after the mark
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        jest.runAllTimers();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://example.test/1');
    });

    it('falls back to a data: URL when the runtime refuses the Blob URL (Lightning Locker)', () => {
        URL.createObjectURL = jest.fn(() => {
            throw new Error('createObjectURL is not supported');
        });
        URL.revokeObjectURL = jest.fn();

        expect(downloadCsv('a,b\n', 'x.csv', host)).toBe(true);

        expect(clicked).toHaveLength(1);
        expect(clicked[0].href).toBe('data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + 'a,b\n'));
        jest.runAllTimers();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('falls back to a data: URL when there is no URL.createObjectURL at all', () => {
        URL.createObjectURL = undefined;
        expect(downloadCsv('a\n', 'x.csv', host)).toBe(true);
        expect(clicked[0].href.startsWith('data:text/csv;charset=utf-8,')).toBe(true);
    });

    it('reports false, and clicks nothing, when both ways are refused', () => {
        URL.createObjectURL = jest.fn(() => {
            throw new Error('refused');
        });
        jest.spyOn(HTMLAnchorElement.prototype, 'href', 'set').mockImplementation(() => {
            throw new Error('HTMLAnchorElement href does not support data:');
        });
        expect(downloadCsv('a\n', 'x.csv', host)).toBe(false);
        expect(clicked).toHaveLength(0);
        expect(host.childNodes.length).toBe(0);
    });

    it('names the file export.csv when no name is given, and uses the page when no container is', () => {
        URL.createObjectURL = jest.fn(() => 'blob:x');
        URL.revokeObjectURL = jest.fn();
        downloadCsv('a\n');
        expect(clicked).toEqual([{ href: 'blob:x', download: 'export.csv', inHost: false }]);
    });
});
