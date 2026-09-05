import { VAULT_STATUS_PORT, type VaultStatusMessage, type VaultStatusRequest,
  type VaultStatusSnapshot, type VaultStatusState } from '../shared/vaultStatus';

/** A quiet, worker-local subscription. Merely observing status is never activity. */
export function createVaultStatusPublisher(read: () => VaultStatusState, workerIdentity: string = crypto.randomUUID()) {
  const subscribers = new Map<chrome.runtime.Port, () => void>();
  let snapshot: VaultStatusSnapshot | undefined;

  function send(port: chrome.runtime.Port, message: VaultStatusMessage) {
    try { port.postMessage(message); }
    catch { subscribers.get(port)?.(); }
  }

  function publish(): VaultStatusSnapshot {
    const state = read();
    if (!snapshot || state.generation !== snapshot.generation || state.locked !== snapshot.locked
      || state.dbName !== snapshot.dbName || state.dirty !== snapshot.dirty) {
      snapshot = { ...state, workerIdentity, sequence: (snapshot?.sequence ?? 0) + 1 };
      for (const port of subscribers.keys()) send(port, { type: 'snapshot', snapshot });
    }
    return snapshot;
  }

  function connect(port: chrome.runtime.Port) {
    if (port.name !== VAULT_STATUS_PORT) return;
    const sender = port.sender;
    const ownPages = ['popup', 'panel'].map(page => chrome.runtime.getURL(`src/pages/${page}/index.html`));
    let trusted = false;
    try {
      const url = new URL(sender?.url ?? '');
      url.search = ''; url.hash = '';
      trusted = sender?.id === chrome.runtime.id && (sender.frameId === undefined || sender.frameId === 0)
        && ownPages.includes(url.href);
    } catch { /* malformed sender is untrusted */ }
    if (!trusted) { port.disconnect(); return; }

    const cleanup = () => {
      subscribers.delete(port);
      port.onDisconnect.removeListener(cleanup);
      port.onMessage.removeListener(onMessage);
    };
    const onMessage = (request: VaultStatusRequest) => {
      if (request?.type !== 'refresh' || !Number.isSafeInteger(request.requestId)) return;
      const current = publish();
      if (subscribers.has(port)) send(port, { type: 'snapshot', snapshot: current, requestId: request.requestId });
    };
    port.onDisconnect.addListener(cleanup);
    port.onMessage.addListener(onMessage);
    // Register before reading, so a transition cannot fall between subscription and initial state.
    subscribers.set(port, cleanup);
    const previous = snapshot;
    const current = publish();
    if (current === previous) send(port, { type: 'snapshot', snapshot: current });
  }

  return { connect, publish };
}
