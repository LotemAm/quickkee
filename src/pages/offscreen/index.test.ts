// The module under test registers a chrome.runtime.onMessage listener at import time,
// so chrome must be stubbed before the (dynamic) import runs.
let mod: typeof import('./index');

beforeAll(async () => {
  (globalThis as any).chrome = { runtime: { onMessage: { addListener: () => {} } } };
  mod = await import('./index');
});

test('shouldClear returns true when the clipboard hash matches the expected hash', () => {
  expect(mod.shouldClear('abc', 'abc')).toBe(true);
});

test('shouldClear returns false when the clipboard hash does not match', () => {
  expect(mod.shouldClear('abc', 'def')).toBe(false);
});
