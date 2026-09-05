import { useEffect, useState, useCallback, useRef } from 'react';
import { VAULT_STATUS_PORT, isVaultStatusMessage, type VaultStatusRequest } from './vaultStatus';

const lockedStatus = { locked: true, dbName: undefined as string | undefined, dirty: false, sessionKey: null as string | null };

export function useStatus() {
  const [status, setStatus] = useState(lockedStatus);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const connectionNumber = useRef(0);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let nextRequestId = 0;
    let current: { port: chrome.runtime.Port; dispose: () => void } | null = null;

    function connect() {
      if (!active || current) return;
      setStatus(lockedStatus);
      try {
        const port = chrome.runtime.connect({ name: VAULT_STATUS_PORT });
        const connection = ++connectionNumber.current;
        let obsolete = false;
        let workerIdentity: string | undefined;
        let sequence = -1;
        let generation = -1;
        const pending = new Map<number, () => void>();
        const isCurrent = () => active && !obsolete && current?.port === port;
        const dispose = () => {
          // Invalidate before disconnect: Chrome/test adapters may call back synchronously.
          obsolete = true;
          if (current?.port === port) current = null;
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
          for (const resolve of pending.values()) resolve();
          pending.clear();
          try { port.disconnect(); } catch { /* already gone */ }
        };
        const fail = () => {
          if (!isCurrent()) return;
          dispose();
          setStatus(lockedStatus);
        };
        const onDisconnect = () => { void chrome.runtime.lastError; fail(); };
        const onMessage = (message: unknown) => {
          if (!isCurrent()) return;
          if (!isVaultStatusMessage(message)) { fail(); return; }
          const snapshot = message.snapshot;
          if (workerIdentity !== undefined && workerIdentity !== snapshot.workerIdentity) return;
          workerIdentity = snapshot.workerIdentity;
          if (snapshot.sequence > sequence && snapshot.generation >= generation) {
            sequence = snapshot.sequence;
            generation = snapshot.generation;
            setStatus({ locked: snapshot.locked, dbName: snapshot.dbName, dirty: snapshot.dirty,
              sessionKey: snapshot.locked ? null : `${workerIdentity}:${generation}:${connection}` });
          }
          // An unchanged snapshot has the same sequence but must still complete refresh().
          if (message.requestId !== undefined) {
            pending.get(message.requestId)?.();
            pending.delete(message.requestId);
          }
        };
        current = { port, dispose };
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        refreshRef.current = () => {
          if (!isCurrent()) return reconnectAndRefresh();
          return new Promise<void>(resolve => {
            const requestId = ++nextRequestId;
            pending.set(requestId, resolve);
            try { port.postMessage({ type: 'refresh', requestId } satisfies VaultStatusRequest); }
            catch { fail(); }
          });
        };
      } catch {
        current?.dispose();
        setStatus(lockedStatus);
        refreshRef.current = reconnectAndRefresh;
      }
    }

    function reconnectAndRefresh(): Promise<void> {
      if (!active) return Promise.resolve();
      connect();
      return current ? refreshRef.current() : Promise.resolve();
    }
    const onFocus = () => { if (!current) connect(); };
    refreshRef.current = reconnectAndRefresh;
    connect();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      refreshRef.current = () => Promise.resolve();
      current?.dispose();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { ...status, refresh };
}
