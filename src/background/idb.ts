const DB = 'quickkee';
const VERSION = 2;
const STORES = ['handles', 'cache'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openQuickKeeDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onblocked = () => { dbPromise = null; rej(new Error('quickkee idb open blocked by another connection')); };
    r.onsuccess = () => {
      const db = r.result;
      // Another context is upgrading: close so it can proceed, and re-open lazily next time.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      res(db);
    };
    r.onerror = () => { dbPromise = null; rej(r.error); };
  });
  return dbPromise;
}

export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return txAttempt(store, mode, fn, /* retried */ false);
}

function txAttempt<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
  retried: boolean,
): Promise<T> {
  return openQuickKeeDb().then(db => new Promise<T>((res, rej) => {
    let req: IDBRequest<T>;
    try {
      req = fn(db.transaction(store, mode).objectStore(store));
    } catch (error) {
      if (!retried && (error as Error)?.name === 'InvalidStateError') {
        // Connection was closed by versionchange between memoization and use, reset and retry once.
        dbPromise = null;
        return txAttempt(store, mode, fn, true).then(res, rej);
      }
      return rej(error);
    }
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}
