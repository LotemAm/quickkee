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
  const store: any = {};
  (globalThis as any).chrome = { storage: { session: {
    get: (k: string) => Promise.resolve({ [k]: store[k] }),
    set: (o: any) => { Object.assign(store, o); return Promise.resolve(); },
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
