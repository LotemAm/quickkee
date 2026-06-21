const DB = 'quickkee', STORE = 'handles', KEY = 'db';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(db => new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}

export async function saveHandle(h: FileSystemFileHandle): Promise<string> {
  await tx('readwrite', s => s.put(h, KEY)); return KEY;
}

export async function loadHandle(): Promise<FileSystemFileHandle | null> {
  return (await tx<FileSystemFileHandle | undefined>('readonly', s => s.get(KEY))) ?? null;
}

export async function clearHandle(): Promise<void> { await tx('readwrite', s => s.delete(KEY)); }

export async function ensurePermission(h: FileSystemFileHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const opts = { mode } as FileSystemHandlePermissionDescriptor;
  // @ts-expect-error: queryPermission is experimental
  if ((await h.queryPermission(opts)) === 'granted') return true;
  // @ts-expect-error: requestPermission is experimental
  return (await h.requestPermission(opts)) === 'granted';
}

export async function readBytes(h: FileSystemFileHandle): Promise<ArrayBuffer> {
  const file = await h.getFile(); return file.arrayBuffer();
}

export async function writeBytes(h: FileSystemFileHandle, bytes: ArrayBuffer): Promise<void> {
  const w = await h.createWritable(); await w.write(bytes); await w.close();
}
