import {
  CREDENTIAL_CAPTURE_KEY, CredentialCaptureStore, type SessionStorageArea,
} from './credentialCaptureStore';

function fakeStorage() {
  const data: Record<string, unknown> = {};
  const storage: SessionStorageArea = {
    get: vi.fn(async key => ({ [key]: data[key] })),
    set: vi.fn(async items => { Object.assign(data, items); }),
    remove: vi.fn(async key => { delete data[key]; }),
  };
  return { data, storage };
}

function input(tabId = 7, sourceUrl = 'https://login.example.test/sign-in') {
  return { tabId, sourceUrl, username: 'octocat', password: 'capture-secret', kind: 'login' as const };
}

test('expires captures and prunes expired records on a later write', async () => {
  let now = 1_000;
  const { data, storage } = fakeStorage();
  let nextId = 0;
  const store = new CredentialCaptureStore({ storage, now: () => now, randomId: () => `id-${++nextId}`, ttlMs: 500 });
  await store.stage(input(1));
  now = 1_501;
  expect(await store.pendingForPage(1, input(1).sourceUrl)).toBeNull();
  await store.stage(input(2));

  const persisted = data[CREDENTIAL_CAPTURE_KEY] as Record<string, unknown>;
  expect(Object.keys(persisted)).toEqual(['id-2']);
});

test('binds a prompt to its tab and current same-site origin', async () => {
  const { storage } = fakeStorage();
  const store = new CredentialCaptureStore({ storage, randomId: () => 'capture-id' });
  await store.stage(input());

  expect(await store.pendingForPage(8, 'https://login.example.test/home')).toBeNull();
  expect(await store.pendingForPage(7, 'https://unrelated.test/home')).toBeNull();
  expect(await store.pendingForPage(7, 'https://app.example.test/home')).toMatchObject({ captureId: 'capture-id' });

  expect(await store.authorizeAction('capture-id', { tabId: 7, url: 'https://login.example.test/home' })).toBeNull();
  expect(await store.authorizeAction('capture-id', { tabId: 7, url: 'https://app.example.test/account' })).toMatchObject({ password: 'capture-secret' });
});

test('safe prompt metadata never exposes the staged password or source path', async () => {
  const store = new CredentialCaptureStore({ storage: fakeStorage().storage, randomId: () => 'capture-id' });
  await store.stage(input());
  const safe = await store.pendingForPage(7, 'https://login.example.test/home');

  expect(safe).toEqual({ captureId: 'capture-id', site: 'login.example.test', username: 'octocat', kind: 'login' });
  expect(JSON.stringify(safe)).not.toContain('capture-secret');
  expect(JSON.stringify(safe)).not.toContain('/sign-in');
});

test('dismissal and tab cleanup require the bound authority', async () => {
  const store = new CredentialCaptureStore({ storage: fakeStorage().storage, randomId: () => 'capture-id' });
  await store.stage(input());
  await store.pendingForPage(7, 'https://login.example.test/home');

  expect(await store.dismiss('capture-id', { tabId: 9, url: 'https://login.example.test/home' })).toBe(false);
  expect(await store.pendingForPage(7, 'https://login.example.test/home')).not.toBeNull();
  await store.clearTab(7);
  expect(await store.pendingForPage(7, 'https://login.example.test/home')).toBeNull();
});

test('records an idempotent mutation marker and clears all records', async () => {
  const store = new CredentialCaptureStore({ storage: fakeStorage().storage, randomId: () => 'capture-id' });
  await store.stage(input());
  await store.pendingForPage(7, 'https://login.example.test/home');
  const authority = { tabId: 7, url: 'https://login.example.test/home' };

  expect(await store.markMutation('capture-id', authority, { type: 'create', entryId: 'entry-1' })).toBe(true);
  expect(await store.authorizeAction('capture-id', authority)).toMatchObject({ mutation: { type: 'create', entryId: 'entry-1' } });
  await store.clearAll();
  expect(await store.pendingForPage(7, authority.url)).toBeNull();
});

test('falls back to service-worker memory when storage.session is unavailable', async () => {
  const unavailable: SessionStorageArea = {
    get: vi.fn(async () => { throw new Error('unavailable'); }),
    set: vi.fn(async () => { throw new Error('unavailable'); }),
    remove: vi.fn(async () => { throw new Error('unavailable'); }),
  };
  const store = new CredentialCaptureStore({ storage: unavailable, randomId: () => 'capture-id' });
  await expect(store.stage(input())).resolves.toBe('capture-id');
  await expect(store.pendingForPage(7, 'https://login.example.test/home')).resolves.toMatchObject({ captureId: 'capture-id' });
});

test('a queued lifecycle clear wins over an in-flight stage', async () => {
  const store = new CredentialCaptureStore({ storage: fakeStorage().storage, randomId: () => 'capture-id' });
  const staged = store.stage(input());
  const cleared = store.clearAll();
  await Promise.all([staged, cleared]);
  expect(await store.pendingForPage(7, 'https://login.example.test/home')).toBeNull();
});
