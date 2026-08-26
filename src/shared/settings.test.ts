import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
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

test('old partial settings gain the credential-offer default', async () => {
  store.settings = { autoCloseHours: 4 };
  expect(await loadSettings()).toMatchObject({ autoCloseHours: 4, offerToSaveCredentials: true });
});

test('an explicit disabled credential offer persists', async () => {
  await saveSettings({ ...DEFAULT_SETTINGS, offerToSaveCredentials: false });
  expect((await loadSettings()).offerToSaveCredentials).toBe(false);
});
