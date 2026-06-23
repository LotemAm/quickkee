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
