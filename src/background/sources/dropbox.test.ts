import { DropboxProvider } from './dropbox';
import { afterEach, vi } from 'vitest';

const token = () => Promise.resolve('TOKEN');
type Handler = (url: string, init: RequestInit) => Response;
let verifyFetch: () => void;
const requestAssertions: (() => void)[] = [];
function mockFetch(...handlers: Handler[]) {
  let i = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const handler = handlers[i++];
    if (!handler) throw new Error(`Unexpected fetch: ${String(url)}`);
    return handler(String(url), init ?? {});
  });
  verifyFetch = () => expect(fetch).toHaveBeenCalledTimes(handlers.length);
}
afterEach(() => {
  try {
    verifyFetch();
    for (const assertRequest of requestAssertions) assertRequest();
  } finally {
    requestAssertions.length = 0;
    vi.restoreAllMocks();
  }
});

function listPage(body: unknown, cursor?: string): Handler {
  return listResponse(() => new Response(JSON.stringify(body), { status: 200 }), cursor);
}

function listResponse(response: () => Response, cursor?: string): Handler {
  return (url, init) => {
    // Provider error handling must not swallow request assertion failures.
    requestAssertions.push(() => {
      expect(url).toBe(`https://api.dropboxapi.com/2/files/list_folder${cursor === undefined ? '' : '/continue'}`);
      expect(init).toEqual({
        method: 'POST',
        headers: { Authorization: 'Bearer TOKEN', 'Content-Type': 'application/json' },
        body: JSON.stringify(cursor === undefined ? { path: '', recursive: true } : { cursor }),
      });
    });
    return response();
  };
}

test('listKdbxFiles filters to .kdbx files', async () => {
  mockFetch(listPage({
    entries: [
      { '.tag': 'file', id: 'id:1', name: 'vault.kdbx', rev: 'r1' },
      { '.tag': 'file', id: 'id:2', name: 'notes.txt', rev: 'r2' },
      { '.tag': 'folder', id: 'id:3', name: 'folder.kdbx' },
    ],
    has_more: false,
    cursor: 'finished',
  }));
  const files = await new DropboxProvider(token).listKdbxFiles();
  expect(files).toEqual([{ fileId: 'id:1', name: 'vault.kdbx', rev: 'r1' }]);
});

test('listKdbxFiles consumes every page through empty pages in provider order', async () => {
  const cursor = 'opaque+/=?&#% token';
  mockFetch(
    listPage({ entries: [], has_more: true, cursor }),
    listPage({
      entries: [
        { '.tag': 'file', id: 'id:1', name: 'Vault.KDBX', rev: 'r1' },
        { '.tag': 'folder', id: 'id:folder', name: 'folder.kdbx' },
        { '.tag': 'file', id: 'id:notes', name: 'notes.txt', rev: 'r2' },
      ],
      has_more: true, cursor: 'third',
    }, cursor),
    listPage({ entries: [], has_more: true, cursor: 'fourth' }, 'third'),
    listPage({
      entries: [{ '.tag': 'file', id: 'id:2', name: 'later.kdbx' }],
      has_more: false, cursor: 'finished',
    }, 'fourth'),
  );
  expect(await new DropboxProvider(token).listKdbxFiles()).toEqual([
    { fileId: 'id:1', name: 'Vault.KDBX', rev: 'r1' },
    { fileId: 'id:2', name: 'later.kdbx', rev: '' },
  ]);
});

test.each([false, true])('listKdbxFiles rejects a later HTTP/network failure (network: %s)', async (network) => {
  mockFetch(
    listPage({
      entries: [{ '.tag': 'file', id: 'id:1', name: 'vault.kdbx', rev: 'r1' }],
      has_more: true, cursor: 'second',
    }),
    listResponse(() => {
      if (network) throw new TypeError('Failed to fetch');
      return new Response('', { status: 503 });
    }, 'second'),
  );
  await expect(new DropboxProvider(token).listKdbxFiles()).rejects.toThrow('dropboxList');
});

test.each([
  null,
  { entries: [] },
  { entries: [], has_more: 'false' },
  { entries: [], has_more: true },
  { entries: [], has_more: true, cursor: '' },
  { entries: [], has_more: true, cursor: 42 },
  { has_more: false },
  { entries: {}, has_more: false },
  { entries: [null], has_more: false },
  { entries: [{ '.tag': 'file', name: 'vault.kdbx' }], has_more: false },
  { entries: [{ '.tag': 'file', id: 'id:1', name: 42 }], has_more: false },
  { entries: [{ '.tag': 'file', id: 'id:1', name: 'vault.kdbx', rev: 42 }], has_more: false },
])('listKdbxFiles rejects a malformed later page: %j', async (page) => {
  mockFetch(
    listPage({
      entries: [{ '.tag': 'file', id: 'id:1', name: 'vault.kdbx', rev: 'r1' }],
      has_more: true, cursor: 'second',
    }),
    listPage(page, 'second'),
  );
  await expect(new DropboxProvider(token).listKdbxFiles()).rejects.toThrow('dropboxList');
});

test('listKdbxFiles rejects invalid JSON on a later page', async () => {
  mockFetch(
    listPage({ entries: [], has_more: true, cursor: 'second' }),
    listResponse(() => new Response('{', { status: 200 }), 'second'),
  );
  await expect(new DropboxProvider(token).listKdbxFiles()).rejects.toThrow('dropboxList');
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
