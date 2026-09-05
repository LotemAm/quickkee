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

function listPage(body: unknown, pageToken?: string, accessToken = 'TOKEN'): Handler {
  return listResponse(() => new Response(JSON.stringify(body), { status: 200 }), pageToken, accessToken);
}

function listResponse(response: () => Response, pageToken?: string, accessToken = 'TOKEN'): Handler {
  return (url, init) => {
    // Provider error handling must not swallow request assertion failures.
    requestAssertions.push(() => {
      const request = new URL(url);
      expect(`${request.origin}${request.pathname}`).toBe('https://www.googleapis.com/drive/v3/files');
      expect(Object.fromEntries(request.searchParams)).toEqual({
        q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
        fields: 'nextPageToken,files(id,name,headRevisionId)',
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      if (pageToken !== undefined) expect(url).toContain(`&pageToken=${encodeURIComponent(pageToken)}`);
      expect(init).toEqual({ headers: { Authorization: `Bearer ${accessToken}` } });
    });
    return response();
  };
}

function downloadResponse(query: string, response: () => Response): Handler {
  return (url, init) => {
    requestAssertions.push(() => {
      expect(url).toBe(`https://www.googleapis.com/drive/v3/files/d1?${query}`);
      expect(init).toEqual({ headers: { Authorization: 'Bearer TOKEN' }, cache: 'no-store' });
    });
    return response();
  };
}

function revision(rev: string): Handler {
  return downloadResponse('fields=headRevisionId', () => new Response(JSON.stringify({ headRevisionId: rev })));
}

function media(bytes: number[]): Handler {
  return downloadResponse('alt=media', () => new Response(new Uint8Array(bytes)));
}

test('listKdbxFiles maps Drive files', async () => {
  mockSequence(listPage({
    files: [{ id: 'd1', name: 'vault.kdbx', headRevisionId: 'h1' }],
  }));
  const files = await new GDriveProvider(token).listKdbxFiles();
  expect(files).toEqual([{ fileId: 'd1', name: 'vault.kdbx', rev: 'h1' }]);
});

test('listKdbxFiles filters mixed filenames by case-insensitive suffix across pages', async () => {
  mockSequence(
    listPage({
      files: [
        { id: 'personal', name: 'Personal.kdbx', headRevisionId: 'h1' },
        { id: 'notes', name: 'notes.txt' },
      ],
      nextPageToken: 'second',
    }),
    listPage({
      files: [
        { id: 'team', name: 'TEAM.KDBX', headRevisionId: 'h2' },
        { id: 'backup', name: 'archive.kdbx.bak' },
        { id: 'prefix', name: '.kdbx-not-a-vault.txt' },
      ],
    }, 'second'),
  );
  expect(await new GDriveProvider(token).listKdbxFiles()).toEqual([
    { fileId: 'personal', name: 'Personal.kdbx', rev: 'h1' },
    { fileId: 'team', name: 'TEAM.KDBX', rev: 'h2' },
  ]);
});

test.each([
  { firstPage: 'empty', files: [] },
  { firstPage: 'non-vault', files: [{ id: 'notes', name: 'notes.txt' }] },
])('listKdbxFiles finds later vaults after an $firstPage page with refreshed auth', async ({ files }) => {
  const pageToken = 'opaque+/=?&#% token';
  const getToken = vi.fn().mockResolvedValueOnce('FIRST').mockResolvedValueOnce('SECOND');
  mockSequence(
    listPage({ files, nextPageToken: pageToken }, undefined, 'FIRST'),
    listPage({ files: [{ id: 'personal', name: 'Personal.kdbx' }] }, pageToken, 'SECOND'),
  );
  expect(await new GDriveProvider(getToken).listKdbxFiles()).toEqual([
    { fileId: 'personal', name: 'Personal.kdbx', rev: '' },
  ]);
  expect(getToken).toHaveBeenCalledTimes(2);
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
  mockSequence(revision('h7'));
  expect(await new GDriveProvider(token).getRevision('d1')).toBe('h7');
});

test('download returns exact bytes bracketed by a stable revision', async () => {
  mockSequence(
    revision('h2'),
    media([0, 4, 5, 255]),
    revision('h2'),
  );
  const { bytes, rev } = await new GDriveProvider(token).download('d1');
  expect(rev).toBe('h2');
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0, 4, 5, 255]));
});

test('download discards changed bytes and fetches fresh media for a stable revision', async () => {
  mockSequence(
    revision('h1'), media([1, 2]), revision('h2'),
    revision('h2'), media([3, 4]), revision('h2'),
  );
  const { bytes, rev } = await new GDriveProvider(token).download('d1');
  expect(rev).toBe('h2');
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([3, 4]));
});

test('download rejects continuous revision drift after exactly three complete attempts', async () => {
  mockSequence(
    revision('h1'), media([1]), revision('h2'),
    revision('h2'), media([2]), revision('h3'),
    revision('h3'), media([3]), revision('h4'),
  );
  await expect(new GDriveProvider(token).download('d1')).rejects.toThrow('gdriveDownloadChanged');
});

test('download can return fresh bytes from its third attempt', async () => {
  mockSequence(
    revision('h1'), media([1]), revision('h2'),
    revision('h2'), media([2]), revision('h3'),
    revision('h3'), media([3]), revision('h3'),
  );
  const { bytes, rev } = await new GDriveProvider(token).download('d1');
  expect(rev).toBe('h3');
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([3]));
});

test('download fully buffers media before reading the second revision', async () => {
  const response = new Response();
  let finishMedia!: (bytes: ArrayBuffer) => void;
  const readBody = vi.spyOn(response, 'arrayBuffer').mockImplementation(() => new Promise(resolve => {
    finishMedia = resolve;
  }));
  mockSequence(revision('h1'), downloadResponse('alt=media', () => response), revision('h1'));
  const downloading = new GDriveProvider(token).download('d1');
  await vi.waitFor(() => expect(readBody).toHaveBeenCalledOnce());
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  const bytes = new Uint8Array([4, 5]).buffer;
  finishMedia(bytes);
  expect(await downloading).toEqual({ bytes, rev: 'h1' });
});

describe.each(['before', 'after'] as const)('download metadata %s media', (position) => {
  test.each([null, {}, { headRevisionId: '' }, { headRevisionId: null }, { headRevisionId: 42 }])(
    'rejects absent, empty, or malformed revision data: %j', async (body) => {
      mockSequence(
        ...(position === 'after' ? [revision('h1'), media([1])] : []),
        downloadResponse('fields=headRevisionId', () => new Response(JSON.stringify(body))),
      );
      await expect(new GDriveProvider(token).download('d1')).rejects.toThrow('gdriveMetadata');
    },
  );

  test('propagates invalid JSON without retrying', async () => {
    mockSequence(
      ...(position === 'after' ? [revision('h1'), media([1])] : []),
      downloadResponse('fields=headRevisionId', () => new Response('{')),
    );
    await expect(new GDriveProvider(token).download('d1')).rejects.toThrow(SyntaxError);
  });
});

describe.each([
  { stage: 'first metadata', index: 0, query: 'fields=headRevisionId', error: 'gdriveMetadata' },
  { stage: 'media', index: 1, query: 'alt=media', error: 'gdriveDownload' },
  { stage: 'second metadata', index: 2, query: 'fields=headRevisionId', error: 'gdriveMetadata' },
])('download failure at $stage', ({ index, query, error }) => {
  test.each([401, 503])('rejects HTTP %s without retrying', async (status) => {
    mockSequence(
      ...[revision('h1'), media([1])].slice(0, index),
      downloadResponse(query, () => new Response('', { status })),
    );
    await expect(new GDriveProvider(token).download('d1')).rejects.toThrow(error);
  });

  test('propagates network rejection without retrying', async () => {
    const failure = new TypeError('Failed to fetch');
    mockSequence(
      ...[revision('h1'), media([1])].slice(0, index),
      downloadResponse(query, () => { throw failure; }),
    );
    await expect(new GDriveProvider(token).download('d1')).rejects.toBe(failure);
  });

  test('propagates token rejection without retrying', async () => {
    const failure = new Error('oauthDenied');
    let requests = 0;
    const getToken = vi.fn(async () => {
      if (requests++ === index) throw failure;
      return 'TOKEN';
    });
    mockSequence(...[revision('h1'), media([1])].slice(0, index));
    await expect(new GDriveProvider(getToken).download('d1')).rejects.toBe(failure);
    expect(getToken).toHaveBeenCalledTimes(index + 1);
  });
});

test('download propagates a media body failure without reading metadata or retrying', async () => {
  const response = new Response();
  const failure = new TypeError('Body stream failed');
  vi.spyOn(response, 'arrayBuffer').mockRejectedValue(failure);
  mockSequence(revision('h1'), downloadResponse('alt=media', () => response));
  await expect(new GDriveProvider(token).download('d1')).rejects.toBe(failure);
});

test('download does not retry an HTTP failure after an earlier revision drift', async () => {
  mockSequence(
    revision('h1'), media([1]), revision('h2'),
    revision('h2'), downloadResponse('alt=media', () => new Response('', { status: 503 })),
  );
  await expect(new GDriveProvider(token).download('d1')).rejects.toThrow('gdriveDownload');
});

test('upload conflicts when remote rev moved past basedOnRev', async () => {
  mockSequence(revision('h9'));
  const res = await new GDriveProvider(token).upload('d1', new Uint8Array([1]).buffer, 'h2');
  expect(res).toEqual({ ok: false, conflict: true });
});

test('upload succeeds when rev still matches', async () => {
  const bytes = new Uint8Array([1]).buffer;
  mockSequence(
    revision('h2'),
    (url, init) => {
      expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files/d1?uploadType=media&fields=headRevisionId');
      expect(init).toEqual({
        method: 'PATCH',
        headers: { Authorization: 'Bearer TOKEN', 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
      return new Response(JSON.stringify({ headRevisionId: 'h3' }), { status: 200 });
    },
  );
  const res = await new GDriveProvider(token).upload('d1', bytes, 'h2');
  expect(res).toEqual({ ok: true, rev: 'h3' });
});
