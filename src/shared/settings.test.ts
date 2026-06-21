import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

beforeEach(() => {
  let store: any = {};
  (globalThis as any).chrome = { storage: { local: {
    get: (k: string) => Promise.resolve({ [k]: store[k] }),
    set: (o: any) => { Object.assign(store, o); return Promise.resolve(); } } } };
});

test('returns defaults when empty', async () => {
  expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test('persists and merges', async () => {
  await saveSettings({ ...DEFAULT_SETTINGS, autoCloseHours: 4 });
  expect((await loadSettings()).autoCloseHours).toBe(4);
});
