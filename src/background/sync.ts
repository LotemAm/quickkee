import type { Vault } from './vault';
import type { CloudProvider } from './sources/cloudProvider';
import type { CloudFileSource } from '../shared/dbSource';
import { cacheKey, getCache, putCache, type CacheRecord } from './cache';

export interface SyncDeps {
  vault: Vault;
  provider: CloudProvider;
  online: () => boolean;
}

export interface OpenOutcome { basedOnRev: string; merged: boolean; offline: boolean }
export interface SaveOutcome { basedOnRev: string; merged: boolean; pendingUpload: boolean }

function key(src: CloudFileSource): string { return cacheKey(src.provider, src.fileId); }

async function writeCache(
  src: CloudFileSource, bytes: ArrayBuffer, basedOnRev: string, pendingUpload: boolean,
): Promise<void> {
  const rec: CacheRecord = { bytes, basedOnRev, lastSyncedAt: Date.now(), pendingUpload };
  await putCache(key(src), rec);
}

/** Open a cloud file into the vault, reconciling cache vs. remote revision. */
export async function openCloud(
  src: CloudFileSource, deps: SyncDeps, password: string | null, keyFile: ArrayBuffer | null,
): Promise<OpenOutcome> {
  const { vault, provider } = deps;
  const cache = await getCache(key(src));

  let remoteRev: string;
  try {
    remoteRev = await provider.getRevision(src.fileId);
  } catch {
    // Offline: load whatever the cache has.
    if (!cache) throw new Error('offlineNoCache');
    await vault.open(cache.bytes, password, keyFile);
    src.basedOnRev = cache.basedOnRev;
    return { basedOnRev: cache.basedOnRev, merged: false, offline: true };
  }

  // Cache is current with remote → no download.
  if (cache && remoteRev === cache.basedOnRev) {
    await vault.open(cache.bytes, password, keyFile);
    src.basedOnRev = cache.basedOnRev;
    return { basedOnRev: cache.basedOnRev, merged: false, offline: false };
  }

  // Remote differs (or no cache) → download.
  const { bytes: remoteBytes, rev } = await provider.download(src.fileId);

  if (!cache || !cache.pendingUpload) {
    // Fast-forward: adopt remote as the new base.
    await vault.open(remoteBytes, password, keyFile);
    await writeCache(src, remoteBytes, rev, false);
    src.basedOnRev = rev;
    return { basedOnRev: rev, merged: false, offline: false };
  }

  // Conflict: local cached edits + advanced remote → merge.
  await vault.open(cache.bytes, password, keyFile);
  await vault.mergeRemote(remoteBytes);
  const merged = await vault.serialize();
  await writeCache(src, merged, rev, true); // still pending until uploaded
  src.basedOnRev = rev;
  return { basedOnRev: rev, merged: true, offline: false };
}

/** Save the in-memory vault back to the cloud, merging on conflict. */
export async function saveCloud(src: CloudFileSource, deps: SyncDeps): Promise<SaveOutcome> {
  const { vault, online } = deps;

  // 1) Durable local first: serialize and write cache, marked pending.
  const bytes = await vault.serialize();
  await writeCache(src, bytes, src.basedOnRev, true);

  if (!online()) return { basedOnRev: src.basedOnRev, merged: false, pendingUpload: true };

  // 2) Attempt upload, handling rev drift + conflict via merge.
  return pushOrMerge(src, deps, bytes);
}

/** Retry a previously-deferred upload. Returns null if nothing is pending. */
export async function retryPending(src: CloudFileSource, deps: SyncDeps): Promise<SaveOutcome | null> {
  const cache = await getCache(key(src));
  if (!cache || !cache.pendingUpload) return null;
  if (!deps.online()) return { basedOnRev: src.basedOnRev, merged: false, pendingUpload: true };
  return pushOrMerge(src, deps, cache.bytes);
}

/** Shared upload path: check rev, upload, and merge+re-upload on conflict. */
async function pushOrMerge(src: CloudFileSource, deps: SyncDeps, bytes: ArrayBuffer): Promise<SaveOutcome> {
  const { vault, provider } = deps;
  try {
    const remoteRev = await provider.getRevision(src.fileId);
    if (remoteRev === src.basedOnRev) {
      const res = await provider.upload(src.fileId, bytes, src.basedOnRev);
      if (res.ok) {
        await writeCache(src, bytes, res.rev, false);
        src.basedOnRev = res.rev;
        return { basedOnRev: res.rev, merged: false, pendingUpload: false };
      }
      // fall through to merge on conflict
    }
    // Remote drifted or upload conflicted → download, merge, re-upload.
    const { bytes: remoteBytes, rev } = await provider.download(src.fileId);
    // vault already holds the local edits in memory; mergeRemote folds in the remote additions. If the vault is locked (cold retry), mergeRemote throws and the catch below keeps pendingUpload=true — no edits lost.
    await vault.mergeRemote(remoteBytes);
    const mergedBytes = await vault.serialize();
    const res = await provider.upload(src.fileId, mergedBytes, rev);
    if (res.ok) {
      await writeCache(src, mergedBytes, res.rev, false);
      src.basedOnRev = res.rev;
      return { basedOnRev: res.rev, merged: true, pendingUpload: false };
    }
    // Still conflicting (race) → defer, keep pending.
    await writeCache(src, mergedBytes, rev, true);
    src.basedOnRev = rev;
    return { basedOnRev: rev, merged: true, pendingUpload: true };
  } catch {
    // Provider/IO error → leave pending for the next retry.
    return { basedOnRev: src.basedOnRev, merged: false, pendingUpload: true };
  }
}
