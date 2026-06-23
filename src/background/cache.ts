import { tx } from './idb';

export interface CacheRecord {
  bytes: ArrayBuffer;       // KeePass ciphertext (encrypted at rest)
  basedOnRev: string;       // remote rev these bytes descend from
  lastSyncedAt: number;
  pendingUpload: boolean;   // local edits not yet pushed to remote
}

export function cacheKey(provider: string, fileId: string): string {
  return `${provider}:${fileId}`;
}

export async function getCache(key: string): Promise<CacheRecord | null> {
  return (await tx<CacheRecord | undefined>('cache', 'readonly', s => s.get(key))) ?? null;
}

export async function putCache(key: string, rec: CacheRecord): Promise<void> {
  await tx('cache', 'readwrite', s => s.put(rec, key));
}

export async function deleteCache(key: string): Promise<void> {
  await tx('cache', 'readwrite', s => s.delete(key));
}
