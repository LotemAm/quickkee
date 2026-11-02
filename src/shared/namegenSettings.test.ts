import { DEFAULT_NAMEGEN } from './namegen';
import { loadNameGenOptions, saveNameGenOptions } from './namegenSettings';

let store: Record<string, unknown>;
beforeEach(() => {
  store = { settings: { theme: 'dark' } };
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(store, values); }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());

test('loads defaults without writing them', async () => {
  expect(await loadNameGenOptions()).toEqual(DEFAULT_NAMEGEN);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

test('persists preferences separately from other settings and normalizes partial values', async () => {
  await saveNameGenOptions({ ...DEFAULT_NAMEGEN, separator: '_', style: 'alias' });
  expect(await loadNameGenOptions()).toEqual({ ...DEFAULT_NAMEGEN, separator: '_', style: 'alias' });
  expect(store.settings).toEqual({ theme: 'dark' });
  store.nameGeneratorOptions = { digits: 4, separator: 'unsupported' };
  expect(await loadNameGenOptions()).toEqual({ ...DEFAULT_NAMEGEN, digits: 4 });
});

test('reports read and write failures to the UI caller', async () => {
  vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('read failed'));
  await expect(loadNameGenOptions()).rejects.toThrow('read failed');
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('write failed'));
  await expect(saveNameGenOptions(DEFAULT_NAMEGEN)).rejects.toThrow('write failed');
});
