import { tx } from './idb';

const KEY = 'db';

export async function saveHandle(h: FileSystemFileHandle): Promise<string> {
  await tx('handles', 'readwrite', s => s.put(h, KEY)); return KEY;
}

const TEST = import.meta.env.VITE_QK_TEST === '1';
const BYTES_KEY = 'testBytes', NAME_KEY = 'testName';

export async function loadHandle(): Promise<FileSystemFileHandle | null> {
  if (TEST) {
    const name = await tx<string | undefined>('handles', 'readonly', s => s.get(NAME_KEY));
    return name ? makeFakeHandle(name) : null;
  }
  return (await tx<FileSystemFileHandle | undefined>('handles', 'readonly', s => s.get(KEY))) ?? null;
}

export async function clearHandle(): Promise<void> { await tx('handles', 'readwrite', s => s.delete(KEY)); }

// --- Key-file handle (reference only; bytes re-read on demand, never cached) ---
const KEYFILE_KEY = 'keyfile';

export async function saveKeyHandle(h: FileSystemFileHandle): Promise<void> {
  await tx('handles', 'readwrite', s => s.put(h, KEYFILE_KEY));
}
export async function loadKeyHandle(): Promise<FileSystemFileHandle | null> {
  return (await tx<FileSystemFileHandle | undefined>('handles', 'readonly', s => s.get(KEYFILE_KEY))) ?? null;
}
export async function clearKeyHandle(): Promise<void> { await tx('handles', 'readwrite', s => s.delete(KEYFILE_KEY)); }

// --- Last loaded cloud database (provider + file id/name; auto-selected on next unlock) ---
const LAST_CLOUD_KEY = 'lastCloud';
export interface LastCloud { provider: 'dropbox' | 'gdrive'; fileId: string; fileName: string }

export async function saveLastCloud(rec: LastCloud): Promise<void> {
  await tx('handles', 'readwrite', s => s.put(rec, LAST_CLOUD_KEY));
}
export async function loadLastCloud(): Promise<LastCloud | null> {
  return (await tx<LastCloud | undefined>('handles', 'readonly', s => s.get(LAST_CLOUD_KEY))) ?? null;
}
export async function clearLastCloud(): Promise<void> { await tx('handles', 'readwrite', s => s.delete(LAST_CLOUD_KEY)); }

export async function saveTestBytes(name: string, bytes: ArrayBuffer): Promise<void> {
  await tx('handles', 'readwrite', s => s.put(bytes, BYTES_KEY));
  await tx('handles', 'readwrite', s => s.put(name, NAME_KEY));
}

function makeFakeHandle(name: string): FileSystemFileHandle {
  return {
    name, kind: 'file',
    async getFile() {
      const b = await tx<ArrayBuffer>('handles', 'readonly', s => s.get(BYTES_KEY));
      return new File([b], name);
    },
    async createWritable() {
      const parts: BlobPart[] = [];
      return {
        async write(data: BlobPart) { parts.push(data); },
        async close() { const buf = await new Blob(parts).arrayBuffer(); await tx('handles', 'readwrite', s => s.put(buf, BYTES_KEY)); },
      };
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  } as unknown as FileSystemFileHandle;
}

export async function ensurePermission(h: FileSystemFileHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const opts = { mode } as { mode: 'read' | 'readwrite' };
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
