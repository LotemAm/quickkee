import { act, renderHook } from '@testing-library/react';
import { useStatus } from './useStatus';
import { VAULT_STATUS_PORT, type VaultStatusSnapshot } from './vaultStatus';

function event() {
  const listeners = new Set<(message?: unknown) => void>();
  return { addListener: (fn: (message?: unknown) => void) => listeners.add(fn),
    removeListener: (fn: (message?: unknown) => void) => listeners.delete(fn),
    fire: (message?: unknown) => [...listeners].forEach(fn => fn(message)), listeners };
}
function port() {
  const onMessage = event(); const onDisconnect = event();
  return { onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn(() => onDisconnect.fire()) };
}
type Port = ReturnType<typeof port>;
let ports: Port[];
let connect: ReturnType<typeof vi.fn>;
function snapshot(p: Port, changes: Partial<VaultStatusSnapshot> = {}, requestId?: number) {
  p.onMessage.fire({ type: 'snapshot', requestId, snapshot: {
    workerIdentity: 'worker', generation: 1, sequence: 1, locked: false, dirty: false, dbName: 'vault', ...changes,
  } });
}
beforeEach(() => {
  ports = [];
  connect = vi.fn(() => { const p = port(); ports.push(p); return p; });
  vi.stubGlobal('chrome', { runtime: { connect } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('starts locked, receives ordered lock/reopen and does not key edits as new sessions', () => {
  const { result } = renderHook(useStatus);
  expect(result.current).toMatchObject({ locked: true, sessionKey: null });
  expect(connect).toHaveBeenCalledWith({ name: VAULT_STATUS_PORT });
  act(() => snapshot(ports[0]));
  expect(result.current).toMatchObject({ locked: false, sessionKey: 'worker:1:1' });
  act(() => snapshot(ports[0], { dirty: true, sequence: 2 }));
  expect(result.current).toMatchObject({ dirty: true, sessionKey: 'worker:1:1' });
  act(() => snapshot(ports[0], { locked: true, generation: 2, sequence: 3 }));
  expect(result.current).toMatchObject({ locked: true, sessionKey: null });
  act(() => snapshot(ports[0], { generation: 3, sequence: 4 }));
  expect(result.current.sessionKey).toBe('worker:3:1');
});

test('ignores older sequences and obsolete worker identities on a live connection', () => {
  const { result } = renderHook(useStatus);
  act(() => snapshot(ports[0]));
  act(() => snapshot(ports[0], { locked: true, sequence: 4, generation: 2 }));
  act(() => snapshot(ports[0], { sequence: 3 }));
  act(() => snapshot(ports[0], { sequence: 9, generation: 9, workerIdentity: 'obsolete-worker' }));
  expect(result.current).toMatchObject({ locked: true, sessionKey: null });
});

test('disconnect fails locked, never reconnects periodically, then explicit refresh accepts a new worker', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(useStatus);
  act(() => snapshot(ports[0]));
  const staleListener = [...ports[0].onMessage.listeners][0];
  act(() => ports[0].onDisconnect.fire());
  expect(result.current).toMatchObject({ locked: true, sessionKey: null, dbName: undefined, dirty: false });
  act(() => vi.advanceTimersByTime(120_000));
  expect(connect).toHaveBeenCalledOnce();
  let refreshed!: Promise<void>;
  act(() => { refreshed = result.current.refresh(); });
  expect(connect).toHaveBeenCalledTimes(2);
  const requestId = ports[1].postMessage.mock.calls[0][0].requestId;
  await act(async () => { snapshot(ports[1], { workerIdentity: 'new-worker', generation: 0 }, requestId); await refreshed; });
  act(() => staleListener({ type: 'snapshot', snapshot: { workerIdentity: 'worker', sequence: 100, generation: 10, locked: false, dirty: true } }));
  expect(result.current).toMatchObject({ sessionKey: 'new-worker:0:2', dirty: false });
});

test('focus reconnects once while locked and a fresh snapshot is required', () => {
  const { result } = renderHook(useStatus);
  act(() => snapshot(ports[0]));
  act(() => ports[0].onDisconnect.fire());
  act(() => window.dispatchEvent(new Event('focus')));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(connect).toHaveBeenCalledTimes(2);
  expect(result.current.locked).toBe(true);
  act(() => snapshot(ports[1]));
  expect(result.current.locked).toBe(false);
});

test('a batched disconnect and same-session reconnect still changes the subtree key', () => {
  const { result } = renderHook(useStatus);
  act(() => snapshot(ports[0]));
  const previous = result.current.sessionKey;
  act(() => {
    ports[0].onDisconnect.fire();
    window.dispatchEvent(new Event('focus'));
    snapshot(ports[1]);
  });
  expect(result.current.locked).toBe(false);
  expect(result.current.sessionKey).not.toBe(previous);
});

test('all refresh promises resolve on unchanged and out-of-order correlated responses', async () => {
  const { result } = renderHook(useStatus);
  act(() => snapshot(ports[0], { sequence: 3 }));
  const first = result.current.refresh(); const second = result.current.refresh();
  const [one, two] = ports[0].postMessage.mock.calls.map(([request]) => request.requestId);
  await act(async () => {
    snapshot(ports[0], { sequence: 3 }, two);
    snapshot(ports[0], { sequence: 2 }, one);
    await Promise.all([first, second]);
  });
  expect(result.current.sessionKey).toBe('worker:1:1');
});

test.each(['message', 'send', 'connect'])('%s errors fail locked and refresh does not hang', async error => {
  if (error === 'connect') connect.mockImplementationOnce(() => { throw new Error('gone'); });
  const { result } = renderHook(useStatus);
  if (error !== 'connect') {
    act(() => snapshot(ports[0]));
    if (error === 'message') act(() => ports[0].onMessage.fire({ type: 'invalid' }));
    else {
      ports[0].postMessage.mockImplementationOnce(() => { throw new Error('gone'); });
      await act(async () => { await result.current.refresh(); });
    }
  }
  expect(result.current).toMatchObject({ locked: true, sessionKey: null });
});

test('StrictMode/unmount clean listeners, settle refresh and invalidate callbacks before disconnect', async () => {
  const { result, unmount } = renderHook(useStatus, { reactStrictMode: true });
  expect(ports).toHaveLength(2);
  expect(ports[0].onMessage.listeners.size).toBe(0);
  const last = ports[1];
  const onMessage = [...last.onMessage.listeners][0];
  const pending = result.current.refresh();
  last.disconnect.mockImplementation(() => onMessage({ type: 'snapshot', snapshot: {
    workerIdentity: 'bad', generation: 9, sequence: 9, locked: false, dirty: true,
  } }));
  unmount();
  await pending;
  expect(last.onMessage.listeners.size).toBe(0);
  expect(last.onDisconnect.listeners.size).toBe(0);
  window.dispatchEvent(new Event('focus'));
  expect(connect).toHaveBeenCalledTimes(2);
});
