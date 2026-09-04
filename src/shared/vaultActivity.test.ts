import { createVaultActivityListener, recordVaultActivity } from './vaultActivity';
import { sendToSW } from './messages';

vi.mock('./messages', () => ({ sendToSW: vi.fn().mockResolvedValue({ ok: true }) }));

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

test('records the typed activity signal and tolerates a closing surface', async () => {
  await recordVaultActivity();
  expect(sendToSW).toHaveBeenCalledWith({ type: 'vaultActivity' });
  vi.mocked(sendToSW).mockRejectedValueOnce(new Error('Extension context invalidated'));
  await expect(recordVaultActivity()).resolves.toBeUndefined();
});

test('only trusted pointerdown and keydown qualify without overriding DOM trust', () => {
  const record = vi.fn();
  const listen = createVaultActivityListener(record, () => 0);
  for (const type of ['pointerdown', 'keydown', 'focus', 'focusin', 'mousemove', 'pointermove', 'click']) {
    listen({ type, isTrusted: false });
    if (type !== 'pointerdown' && type !== 'keydown') listen({ type, isTrusted: true });
  }
  expect(record).not.toHaveBeenCalled();
  listen({ type: 'pointerdown', isTrusted: true });
  expect(record).toHaveBeenCalledOnce();
});

test('counts the first input at time zero and throttles both input types without trailing work', () => {
  vi.useFakeTimers();
  const record = vi.fn();
  const listen = createVaultActivityListener(record, () => Date.now());
  vi.setSystemTime(0);
  listen({ type: 'keydown', isTrusted: true });
  vi.advanceTimersByTime(999);
  listen({ type: 'pointerdown', isTrusted: true });
  expect(record).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1);
  listen({ type: 'pointerdown', isTrusted: true });
  expect(record).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_000);
  expect(record).toHaveBeenCalledTimes(2);
});

test('each surface gets its own first interaction', () => {
  const record = vi.fn();
  const first = createVaultActivityListener(record, () => 0);
  const second = createVaultActivityListener(record, () => 0);
  first({ type: 'keydown', isTrusted: true });
  second({ type: 'pointerdown', isTrusted: true });
  expect(record).toHaveBeenCalledTimes(2);
});
