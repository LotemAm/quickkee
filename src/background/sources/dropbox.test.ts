import { DropboxProvider } from './dropbox';
import { afterEach, vi } from 'vitest';

const token = () => Promise.resolve('TOKEN');
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init ?? {}))) as unknown as typeof fetch;
}
afterEach(() => { vi.restoreAllMocks(); });

test('listKdbxFiles filters to .kdbx files', async () => {
  mockFetch(() => new Response(JSON.stringify({
    entries: [
      { '.tag': 'file', id: 'id:1', name: 'vault.kdbx', rev: 'r1' },
      { '.tag': 'file', id: 'id:2', name: 'notes.txt', rev: 'r2' },
    ],
  }), { status: 200 }));
  const files = await new DropboxProvider(token).listKdbxFiles();
  expect(files).toEqual([{ fileId: 'id:1', name: 'vault.kdbx', rev: 'r1' }]);
});

test('getRevision reads rev from metadata', async () => {
  mockFetch(() => new Response(JSON.stringify({ rev: 'r9' }), { status: 200 }));
  expect(await new DropboxProvider(token).getRevision('id:1')).toBe('r9');
});

test('download returns bytes + rev from the API-Result header', async () => {
  mockFetch(() => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'Dropbox-API-Result': JSON.stringify({ rev: 'r5' }) },
  }));
  const { bytes, rev } = await new DropboxProvider(token).download('id:1');
  expect(rev).toBe('r5');
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
});

test('upload success returns new rev and sends basedOnRev in update mode', async () => {
  let sentArg: { mode: { '.tag': string; update: string } } | undefined;
  mockFetch((_url, init) => {
    sentArg = JSON.parse((init.headers as Record<string, string>)['Dropbox-API-Arg']);
    return new Response(JSON.stringify({ rev: 'r6' }), { status: 200 });
  });
  const res = await new DropboxProvider(token).upload('id:1', new Uint8Array([9]).buffer, 'r5');
  expect(res).toEqual({ ok: true, rev: 'r6' });
  expect(sentArg?.mode).toEqual({ '.tag': 'update', update: 'r5' });
});

test('upload 409 conflict returns conflict result', async () => {
  mockFetch(() => new Response(JSON.stringify({ error: { '.tag': 'conflict' } }), { status: 409 }));
  const res = await new DropboxProvider(token).upload('id:1', new Uint8Array([9]).buffer, 'stale');
  expect(res).toEqual({ ok: false, conflict: true });
});
