import { clearAllDrafts, clearDraft, DRAFT_TTL_MS, loadDraft, saveDraft, type CreateDraft } from './createDraft';
import type { PwGenOpts } from './pwgen';

const opts: PwGenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true };

function draft(url: string, overrides: Partial<CreateDraft> = {}): CreateDraft {
  return {
    url,
    title: 'Example',
    username: 'alice',
    password: 'secret-password',
    groupId: 'group-1',
    entryUrl: url,
    opts,
    savedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { session: {
    get: (k: string) => Promise.resolve({ [k]: store[k] }),
    set: (o: Record<string, unknown>) => { Object.assign(store, o); return Promise.resolve(); },
    remove: (k: string) => { delete store[k]; return Promise.resolve(); } } } };
});

test('save then load round-trips the draft', async () => {
  const input = draft('https://example.com', { savedAt: 123 });

  await saveDraft(input);

  const loaded = await loadDraft(input.url);
  expect(loaded).toMatchObject({ ...input, savedAt: expect.any(Number) });
  expect(loaded?.savedAt).not.toBe(123);
});

test('two different urls are stored independently', async () => {
  const first = draft('https://a.example', { title: 'A', username: 'alice' });
  const second = draft('https://b.example', { title: 'B', username: 'bob' });

  await saveDraft(first);
  await saveDraft(second);

  expect(await loadDraft(first.url)).toMatchObject({ url: first.url, title: 'A', username: 'alice' });
  expect(await loadDraft(second.url)).toMatchObject({ url: second.url, title: 'B', username: 'bob' });
});

test('loadDraft for an unknown url returns null', async () => {
  await saveDraft(draft('https://known.example'));

  expect(await loadDraft('https://unknown.example')).toBeNull();
});

test('expired entry returns null and is pruned on next save', async () => {
  const oldUrl = 'https://old.example';
  const newUrl = 'https://new.example';
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  await saveDraft(draft(oldUrl));

  vi.setSystemTime(1_000 + DRAFT_TTL_MS + 1);
  expect(await loadDraft(oldUrl)).toBeNull();

  await saveDraft(draft(newUrl));

  const got = await chrome.storage.session.get('createDraft');
  expect(got.createDraft[oldUrl]).toBeUndefined();
  expect(await loadDraft(newUrl)).toMatchObject({ url: newUrl });
});

test('clearDraft removes only that urls entry', async () => {
  const first = draft('https://a.example');
  const second = draft('https://b.example');
  await saveDraft(first);
  await saveDraft(second);

  await clearDraft(first.url);

  expect(await loadDraft(first.url)).toBeNull();
  expect(await loadDraft(second.url)).toMatchObject({ url: second.url });
});

test('clearAllDrafts makes every url load as null', async () => {
  const first = draft('https://a.example');
  const second = draft('https://b.example');
  await saveDraft(first);
  await saveDraft(second);

  await clearAllDrafts();

  expect(await loadDraft(first.url)).toBeNull();
  expect(await loadDraft(second.url)).toBeNull();
});

test.each(['creating', 'unknown', 'created', 'saved'] as const)('TOTP and %s recovery markers round-trip in session storage', async status => {
  const input = draft('https://example.test', { totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
    submission: { status, sessionKey: 'opaque:session:key', entryId: 'known' } });
  await saveDraft(input);
  expect(await loadDraft(input.url)).toEqual({ ...input, savedAt: expect.any(Number) });
});

test('legacy drafts load without adding TOTP or submission metadata', async () => {
  const input = draft('https://legacy.test', { savedAt: Date.now() });
  await chrome.storage.session.set({ createDraft: { [input.url]: input } });
  expect(await loadDraft(input.url)).toEqual(input);
  expect((await loadDraft(input.url))?.submission).toBeUndefined();
});

test('recovery markers expire at the existing TTL and lock clearing removes their plaintext', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const input = draft('https://example.test', { submission: { status: 'created', sessionKey: 'opaque', entryId: 'known' },
    totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 } });
  await saveDraft(input);
  vi.setSystemTime(1000 + DRAFT_TTL_MS);
  expect(await loadDraft(input.url)).not.toBeNull();
  vi.setSystemTime(1001 + DRAFT_TTL_MS);
  expect(await loadDraft(input.url)).toBeNull();
  await clearAllDrafts();
  expect((await chrome.storage.session.get('createDraft')).createDraft).toBeUndefined();
});

test.each(['save', 'clear'] as const)('%s does not begin storage access for an invalid lifetime', async action => {
  const get = vi.spyOn(chrome.storage.session, 'get');
  const set = vi.spyOn(chrome.storage.session, 'set');
  if (action === 'save') await saveDraft(draft('https://example.test'), () => false);
  else await clearDraft('https://example.test', () => false);
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});

test.each(['save', 'clear'] as const)('%s does not write after lifetime loss during the map read', async action => {
  const input = draft('https://example.test');
  let resolve!: (value: Record<string, unknown>) => void;
  const late = new Promise<Record<string, unknown>>(done => { resolve = done; });
  vi.spyOn(chrome.storage.session, 'get').mockImplementation(() => late);
  const set = vi.spyOn(chrome.storage.session, 'set');
  let alive = true;
  const operation = action === 'save' ? saveDraft(input, () => alive) : clearDraft(input.url, () => alive);
  alive = false;
  resolve({ createDraft: { [input.url]: input } });
  await operation;
  expect(set).not.toHaveBeenCalled();
});
