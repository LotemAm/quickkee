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
