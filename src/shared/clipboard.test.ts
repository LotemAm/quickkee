import { copyWithClear } from './clipboard';
test('clears clipboard after delay when unchanged', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as any).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 30);
  expect(buf).toBe('secret');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(buf).toBe('');
  vi.useRealTimers();
});

test('does NOT clear clipboard if it changed before delay', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as any).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 30);
  expect(buf).toBe('secret');
  buf = 'something else';
  await vi.advanceTimersByTimeAsync(30_000);
  expect(buf).toBe('something else');
  vi.useRealTimers();
});

test('does not schedule clear when clearSeconds is 0', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as any).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 0);
  expect(buf).toBe('secret');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(buf).toBe('secret');
  vi.useRealTimers();
});
