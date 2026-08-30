import { openQuickKeeDb, tx } from './idb';
import { assertQuickUnlockRecord } from './quickUnlockCrypto';
import { QUICK_UNLOCK_LOCAL_HANDLE_KEY, type QuickUnlockRecord } from '../shared/quickUnlock';
import { loadHandle } from './fileHandle';
import { quickUnlockInfo, quickUnlockWarn } from '../shared/quickUnlockDebug';

const RECORD_KEY = 'quickUnlock';
const TEST = import.meta.env.VITE_QK_TEST === '1';

export interface QuickUnlockEnrollment {
  record: QuickUnlockRecord;
  localHandle: FileSystemFileHandle | null;
}

function isTestHandle(value: unknown): value is { testHandle: true } {
  return !!value && typeof value === 'object' && (value as { testHandle?: unknown }).testHandle === true;
}

function mutateStore(run: (store: IDBObjectStore) => void): Promise<void> {
  return openQuickKeeDb().then(db => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('handles', 'readwrite');
    try { run(transaction.objectStore('handles')); }
    catch (error) { transaction.abort(); reject(error); return; }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('quick-unlock transaction aborted'));
  }));
}

export async function saveQuickUnlockEnrollment(
  recordValue: QuickUnlockRecord,
  localHandle: FileSystemFileHandle | null,
): Promise<void> {
  let sourceKind: 'local' | 'cloud' | 'unknown' = 'unknown';
  try {
    const record = assertQuickUnlockRecord(recordValue);
    sourceKind = record.source.kind;
    quickUnlockInfo('store.save-started', { sourceKind, localHandlePresent: localHandle !== null });
    if (record.source.kind === 'local' && !localHandle) throw new Error('local quick unlock requires a file handle');
    await mutateStore(store => {
      if (record.source.kind === 'local') {
        // Test builds use an IndexedDB-backed fake handle whose methods cannot be
        // structured-cloned. Production always stores the real FileSystemFileHandle.
        store.put(TEST ? { testHandle: true } : localHandle, QUICK_UNLOCK_LOCAL_HANDLE_KEY);
      }
      else store.delete(QUICK_UNLOCK_LOCAL_HANDLE_KEY);
      store.put(record, RECORD_KEY);
    });
    quickUnlockInfo('store.save-completed', { sourceKind });
  } catch (error) {
    quickUnlockWarn('store.save-failed', error, { sourceKind, localHandlePresent: localHandle !== null });
    throw error;
  }
}

export async function loadQuickUnlockEnrollment(): Promise<QuickUnlockEnrollment | null> {
  const raw = await tx<unknown>('handles', 'readonly', store => store.get(RECORD_KEY));
  if (raw === undefined) return null;
  const record = assertQuickUnlockRecord(raw);
  if (record.source.kind !== 'local') return { record, localHandle: null };
  const storedHandle = await tx<FileSystemFileHandle | { testHandle: true } | undefined>(
    'handles', 'readonly', store => store.get(QUICK_UNLOCK_LOCAL_HANDLE_KEY),
  );
  const localHandle = TEST && isTestHandle(storedHandle)
    ? await loadHandle()
    : storedHandle as FileSystemFileHandle | undefined;
  if (!localHandle) throw new Error('quick-unlock local handle missing');
  return { record, localHandle };
}

export async function clearQuickUnlockEnrollment(): Promise<void> {
  await mutateStore(store => {
    store.delete(RECORD_KEY);
    store.delete(QUICK_UNLOCK_LOCAL_HANDLE_KEY);
  });
}
