import { createVaultStatusPublisher } from './vaultStatus';
import { VAULT_STATUS_PORT, type VaultStatusState } from '../shared/vaultStatus';

function event() {
  const listeners = new Set<(value?: unknown) => void>();
  return { addListener: vi.fn((fn: (value?: unknown) => void) => listeners.add(fn)),
    removeListener: vi.fn((fn: (value?: unknown) => void) => listeners.delete(fn)),
    fire: (value?: unknown) => [...listeners].forEach(fn => fn(value)), listeners };
}
function port(page = 'popup', id = 'own') {
  return { name: VAULT_STATUS_PORT, sender: { id, url: `chrome-extension://own/src/pages/${page}/index.html?test=1` },
    postMessage: vi.fn(), disconnect: vi.fn(), onMessage: event(), onDisconnect: event() };
}
beforeEach(() => vi.stubGlobal('chrome', { runtime: { id: 'own', getURL: (path: string) => `chrome-extension://own/${path}` } }));
afterEach(() => vi.unstubAllGlobals());

test('multiple views receive initial, open, dirty, lock and replacement snapshots in order without poll noise', () => {
  let state: VaultStatusState = { generation: 0, locked: true, dirty: false };
  const status = createVaultStatusPublisher(() => state, 'worker');
  const popup = port(); const panel = port('panel');
  status.connect(popup as unknown as chrome.runtime.Port);
  status.connect(panel as unknown as chrome.runtime.Port);
  state = { generation: 1, locked: false, dirty: false, dbName: 'vault.kdbx' }; status.publish();
  state = { ...state, dirty: true }; status.publish();
  for (let i = 0; i < 10; i++) status.publish();
  state = { generation: 2, locked: true, dirty: false }; status.publish();
  state = { generation: 3, locked: false, dirty: false }; status.publish();
  expect(popup.postMessage.mock.calls).toEqual(panel.postMessage.mock.calls);
  expect(popup.postMessage.mock.calls.map(([message]) => message.snapshot.sequence)).toEqual([1, 2, 3, 4, 5]);
  expect(popup.postMessage.mock.calls.map(([message]) => message.snapshot.generation)).toEqual([0, 1, 1, 2, 3]);
  expect(Object.keys(popup.postMessage.mock.calls[1][0].snapshot).sort()).toEqual(
    ['dbName', 'dirty', 'generation', 'locked', 'sequence', 'workerIdentity']);
});

test.each(['content', 'options', '../popup', 'nested/popup'])('rejects %s and foreign senders without disclosure', page => {
  const status = createVaultStatusPublisher(() => ({ generation: 1, locked: false, dirty: false }), 'worker');
  for (const p of [port(page), port('popup', 'foreign'), { ...port(), sender: { id: 'own', url: 'https://example.test/src/pages/popup/index.html' } }]) {
    status.connect(p as unknown as chrome.runtime.Port);
    expect(p.disconnect).toHaveBeenCalledOnce();
    expect(p.postMessage).not.toHaveBeenCalled();
  }
});

test('registers before the first read and correlates unchanged refresh replies only to their requester', () => {
  const p = port(); const other = port('panel');
  const read = vi.fn(() => {
    expect(p.onDisconnect.listeners.size).toBe(1);
    expect(p.onMessage.listeners.size).toBe(1);
    return { generation: 1, locked: false, dirty: false };
  });
  const status = createVaultStatusPublisher(read, 'worker');
  status.connect(p as unknown as chrome.runtime.Port);
  status.connect(other as unknown as chrome.runtime.Port);
  p.onMessage.fire({ type: 'refresh', requestId: 7 });
  expect(p.postMessage).toHaveBeenLastCalledWith({ type: 'snapshot', requestId: 7,
    snapshot: { generation: 1, locked: false, dirty: false, sequence: 1, workerIdentity: 'worker' } });
  expect(other.postMessage).toHaveBeenCalledOnce();
});

test('cleans disconnected and broken ports and ignores unrelated port names', () => {
  let generation = 1;
  const status = createVaultStatusPublisher(() => ({ generation, locked: false, dirty: false }), 'worker');
  const p = port(); const broken = port(); const unrelated = { ...port(), name: 'other' };
  status.connect(unrelated as unknown as chrome.runtime.Port);
  expect(unrelated.postMessage).not.toHaveBeenCalled();
  status.connect(p as unknown as chrome.runtime.Port);
  status.connect(broken as unknown as chrome.runtime.Port);
  p.onDisconnect.fire();
  broken.postMessage.mockImplementation(() => { throw new Error('gone'); });
  generation++; status.publish(); generation++; status.publish();
  expect(p.postMessage).toHaveBeenCalledOnce();
  expect(broken.postMessage).toHaveBeenCalledTimes(2);
  expect(broken.onMessage.listeners.size).toBe(0);
  expect(p.onDisconnect.listeners.size).toBe(0);
});
