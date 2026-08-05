import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

beforeEach(() => {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: {
    get: (k: string) => Promise.resolve({ [k]: store[k] }),
    set: (o: Record<string, unknown>) => { Object.assign(store, o); return Promise.resolve(); } } } };
});

test('returns defaults when empty', async () => {
  expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test('persists and merges', async () => {
  await saveSettings({ ...DEFAULT_SETTINGS, autoCloseHours: 4 });
  expect((await loadSettings()).autoCloseHours).toBe(4);
});
