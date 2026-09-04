import { GDriveProvider } from './gdrive';
import { afterEach, vi } from 'vitest';

const token = () => Promise.resolve('TOKEN');
type Handler = (url: string, init: RequestInit) => Response;
let verifyFetch: () => void;
const requestAssertions: (() => void)[] = [];
function mockSequence(...handlers: Handler[]) {
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

function listPage(body: unknown, pageToken?: string): Handler {
  return listResponse(() => new Response(JSON.stringify(body), { status: 200 }), pageToken);
}

function listResponse(response: () => Response, pageToken?: string): Handler {
  return (url, init) => {
    // Provider error handling must not swallow request assertion failures.
    requestAssertions.push(() => {
      const request = new URL(url);
      expect(`${request.origin}${request.pathname}`).toBe('https://www.googleapis.com/drive/v3/files');
      expect(Object.fromEntries(request.searchParams)).toEqual({
        q: "name contains '.kdbx' and trashed = false",
        fields: 'nextPageToken,files(id,name,headRevisionId)',
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      expect(init).toEqual({ headers: { Authorization: 'Bearer TOKEN' } });
    });
    return response();
  };
}

test('listKdbxFiles maps Drive files', async () => {
  mockSequence(listPage({
    files: [{ id: 'd1', name: 'vault.kdbx', headRevisionId: 'h1' }],
  }));
  const files = await new GDriveProvider(token).listKdbxFiles();
  expect(files).toEqual([{ fileId: 'd1', name: 'vault.kdbx', rev: 'h1' }]);
});

test('listKdbxFiles follows opaque tokens through empty pages in provider order', async () => {
  const pageToken = 'opaque+/=?&#% token';
  mockSequence(
    listPage({ files: [], nextPageToken: pageToken }),
    listPage({
      files: [
        { id: 'd1', name: 'Vault.KDBX', headRevisionId: 'h1' },
        { id: 'notes', name: 'notes.txt' },
      ],
      nextPageToken: 'third',
    }, pageToken),
    listPage({ files: [], nextPageToken: 'fourth' }, 'third'),
    listPage({ files: [{ id: 'd2', name: 'later.kdbx' }], nextPageToken: '' }, 'fourth'),
  );
  expect(await new GDriveProvider(token).listKdbxFiles()).toEqual([
    { fileId: 'd1', name: 'Vault.KDBX', rev: 'h1' },
    { fileId: 'd2', name: 'later.kdbx', rev: '' },
  ]);
});

test.each([false, true])('listKdbxFiles rejects a later HTTP/network failure (network: %s)', async (network) => {
  mockSequence(
    listPage({
      files: [{ id: 'd1', name: 'vault.kdbx', headRevisionId: 'h1' }], nextPageToken: 'second',
    }),
    listResponse(() => {
      if (network) throw new TypeError('Failed to fetch');
      return new Response('', { status: 503 });
    }, 'second'),
  );
  await expect(new GDriveProvider(token).listKdbxFiles()).rejects.toThrow('gdriveList');
});

test.each([
  null,
  {},
  { files: {} },
  { files: [], nextPageToken: null },
  { files: [], nextPageToken: 42 },
  { files: [null] },
  { files: [{ name: 'vault.kdbx' }] },
  { files: [{ id: 'd1', name: 42 }] },
  { files: [{ id: 'd1', name: 'vault.kdbx', headRevisionId: 42 }] },
])('listKdbxFiles rejects a malformed later page: %j', async (page) => {
  mockSequence(
    listPage({
      files: [{ id: 'd1', name: 'vault.kdbx', headRevisionId: 'h1' }], nextPageToken: 'second',
    }),
    listPage(page, 'second'),
  );
  await expect(new GDriveProvider(token).listKdbxFiles()).rejects.toThrow('gdriveList');
});

test('listKdbxFiles rejects invalid JSON on a later page', async () => {
  mockSequence(
    listPage({ files: [], nextPageToken: 'second' }),
    listResponse(() => new Response('{', { status: 200 }), 'second'),
  );
  await expect(new GDriveProvider(token).listKdbxFiles()).rejects.toThrow('gdriveList');
});

test('getRevision reads headRevisionId', async () => {
  mockSequence(() => new Response(JSON.stringify({ headRevisionId: 'h7' }), { status: 200 }));
  expect(await new GDriveProvider(token).getRevision('d1')).toBe('h7');
});

test('download fetches media then rev', async () => {
  mockSequence(
    () => new Response(new Uint8Array([4, 5]), { status: 200 }),               // media
    () => new Response(JSON.stringify({ headRevisionId: 'h2' }), { status: 200 }), // rev
  );
  const { bytes, rev } = await new GDriveProvider(token).download('d1');
  expect(rev).toBe('h2');
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([4, 5]));
});

test('upload conflicts when remote rev moved past basedOnRev', async () => {
  mockSequence(() => new Response(JSON.stringify({ headRevisionId: 'h9' }), { status: 200 })); // rev re-check
  const res = await new GDriveProvider(token).upload('d1', new Uint8Array([1]).buffer, 'h2');
  expect(res).toEqual({ ok: false, conflict: true });
});

test('upload succeeds when rev still matches', async () => {
  mockSequence(
    () => new Response(JSON.stringify({ headRevisionId: 'h2' }), { status: 200 }), // rev re-check matches
    () => new Response(JSON.stringify({ headRevisionId: 'h3' }), { status: 200 }), // PATCH result
  );
  const res = await new GDriveProvider(token).upload('d1', new Uint8Array([1]).buffer, 'h2');
  expect(res).toEqual({ ok: true, rev: 'h3' });
});
