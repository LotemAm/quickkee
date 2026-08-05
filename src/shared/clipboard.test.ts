import { copyWithClear, sha256Hex } from './clipboard';
import { sendToSW } from './messages';

vi.mock('./messages', () => ({ sendToSW: vi.fn().mockResolvedValue({ ok: true }) }));

beforeEach(() => { vi.mocked(sendToSW).mockClear(); });

test('sha256Hex matches known vector for "abc"', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('copyWithClear sends scheduleClipboardClear with the text hash', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as unknown as { navigator: unknown }).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 30);
  expect(sendToSW).toHaveBeenCalledWith({
    type: 'scheduleClipboardClear',
    textHash: await sha256Hex('secret'),
    seconds: 30,
  });
  vi.useRealTimers();
});

test('copyWithClear does not send scheduleClipboardClear when clearSeconds is 0', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as unknown as { navigator: unknown }).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 0);
  expect(sendToSW).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test('clears clipboard after delay when unchanged', async () => {
  vi.useFakeTimers();
  let buf = '';
  (globalThis as unknown as { navigator: unknown }).navigator = { clipboard: {
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
  (globalThis as unknown as { navigator: unknown }).navigator = { clipboard: {
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
  (globalThis as unknown as { navigator: unknown }).navigator = { clipboard: {
    writeText: (t: string) => { buf = t; return Promise.resolve(); },
    readText: () => Promise.resolve(buf) } };
  await copyWithClear('secret', 0);
  expect(buf).toBe('secret');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(buf).toBe('secret');
  vi.useRealTimers();
});
