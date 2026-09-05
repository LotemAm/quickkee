import type { Vault } from './vault';
import type { CloudProvider } from './sources/cloudProvider';
import type { CloudFileSource } from '../shared/dbSource';
import { cacheKey, getCache, putCache, type CacheRecord } from './cache';
import { queueCloud } from './syncQueue';

export interface SyncDeps {
  vault: Vault;
  provider: CloudProvider;
  online: () => boolean;
  /** Saves/retries require the active source; opens guard the preceding source instead. */
  isCurrent?: () => boolean;
  /** Carries this open's own lifecycle token to its caller without changing OpenOutcome. */
  onOpened?: (session: number) => void;
}

export interface OpenOutcome { basedOnRev: string; merged: boolean; offline: boolean }
export interface SaveOutcome { basedOnRev: string; merged: boolean; pendingUpload: boolean }

interface Operation {
  readonly session: number;
  readonly provider: CloudProvider;
  readonly providerId: CloudFileSource['provider'];
  readonly fileId: string;
  readonly key: string;
  readonly src: CloudFileSource;
  readonly deps: SyncDeps;
}
interface Snapshot {
  readonly bytes: ArrayBuffer;
  readonly baseRev: string;
  /** Only a newly serialized live snapshot can acknowledge live mutations. */
  readonly mutationVersion?: number;
}

function operation(src: CloudFileSource, deps: SyncDeps): Operation {
  return { session: deps.vault.lifecycleGeneration, provider: deps.provider, providerId: src.provider,
    fileId: src.fileId, key: cacheKey(src.provider, src.fileId), src, deps };
}

function isCurrent(op: Operation): boolean {
  // Equality also allows a cold retry to keep encrypted pending bytes while locked.
  return op.deps.vault.lifecycleGeneration === op.session
    && op.src.fileId === op.fileId && op.src.provider === op.providerId
    && (op.deps.isCurrent?.() ?? true);
}
function guard(op: Operation): void {
  if (!isCurrent(op)) throw new Error('staleSession');
}

async function writeCache(op: Operation, snapshot: Snapshot, basedOnRev: string, pendingUpload: boolean): Promise<void> {
  guard(op);
  const rec: CacheRecord = { bytes: snapshot.bytes, basedOnRev, lastSyncedAt: Date.now(), pendingUpload };
  await putCache(op.key, rec);
  guard(op);
  if (snapshot.mutationVersion !== undefined)
    op.deps.vault.acknowledgeCached(op.session, snapshot.mutationVersion);
}

async function serialize(op: Operation, baseRev: string): Promise<Snapshot> {
  guard(op);
  const mutationVersion = op.deps.vault.mutationVersion;
  const bytes = await op.deps.vault.serialize();
  guard(op);
  return { bytes, baseRev, mutationVersion };
}

/** Open a cloud file, guarding the pre-open phase before adopting our own new session. */
export function openCloud(
  src: CloudFileSource, deps: SyncDeps, password: string | null, keyFile: ArrayBuffer | null,
): Promise<OpenOutcome> {
  const requested = operation(src, deps);
  return queueCloud(deps.vault, async () => {
    guard(requested);
    const cache = await getCache(requested.key);
    guard(requested);
    let remoteRev: string;
    let offline = false;
    try {
      remoteRev = await requested.provider.getRevision(requested.fileId);
    } catch {
      guard(requested);
      if (!cache) throw new Error('offlineNoCache');
      remoteRev = cache.basedOnRev;
      offline = true;
    }
    guard(requested);
    let bytes = cache?.bytes;
    let rev = remoteRev;
    let remoteBytes: ArrayBuffer | undefined;
    if (!cache || remoteRev !== cache.basedOnRev) {
      const remote = await requested.provider.download(requested.fileId);
      guard(requested);
      rev = remote.rev;
      if (cache?.pendingUpload) remoteBytes = remote.bytes;
      else bytes = remote.bytes;
    }
    guard(requested);
    const session = await deps.vault.open(bytes!, password, keyFile);
    const opened = { ...requested, session };
    guard(opened);
    deps.onOpened?.(session);
    if (remoteBytes) {
      await deps.vault.mergeRemote(remoteBytes, () => isCurrent(opened));
      guard(opened);
      await writeCache(opened, await serialize(opened, rev), rev, true);
    } else if (!cache || remoteRev !== cache.basedOnRev) {
      await writeCache(opened, { bytes: bytes!, baseRev: rev }, rev, false);
    }
    guard(opened);
    src.basedOnRev = rev;
    return { basedOnRev: rev, merged: !!remoteBytes, offline };
  });
}

/** Save serialization and both cache commits belong to one queued operation. */
export function saveCloud(src: CloudFileSource, deps: SyncDeps): Promise<SaveOutcome> {
  const requested = operation(src, deps);
  return queueCloud(deps.vault, async () => {
    guard(requested);
    const snapshot = await serialize(requested, src.basedOnRev);
    await writeCache(requested, snapshot, snapshot.baseRev, true);
    if (!deps.online()) return { basedOnRev: snapshot.baseRev, merged: false, pendingUpload: true };
    return pushOrMerge(requested, snapshot);
  });
}

/** Read pending bytes only after earlier operations finish, paired with their cached revision. */
export function retryPending(src: CloudFileSource, deps: SyncDeps): Promise<SaveOutcome | null> {
  const requested = operation(src, deps);
  return queueCloud(deps.vault, async () => {
    guard(requested);
    const cache = await getCache(requested.key);
    guard(requested);
    if (!cache?.pendingUpload) return null;
    if (!deps.online()) return { basedOnRev: cache.basedOnRev, merged: false, pendingUpload: true };
    return pushOrMerge(requested, { bytes: cache.bytes, baseRev: cache.basedOnRev });
  });
}

/** Internal only: never enqueue behind the operation already owning this Vault. */
async function pushOrMerge(op: Operation, snapshot: Snapshot): Promise<SaveOutcome> {
  guard(op);
  try {
    const remoteRev = await op.provider.getRevision(op.fileId);
    guard(op);
    if (remoteRev === snapshot.baseRev) {
      const res = await op.provider.upload(op.fileId, snapshot.bytes, snapshot.baseRev);
      guard(op);
      if (res.ok) {
        await writeCache(op, snapshot, res.rev, false);
        guard(op);
        op.src.basedOnRev = res.rev;
        return { basedOnRev: res.rev, merged: false, pendingUpload: false };
      }
    }
    const remote = await op.provider.download(op.fileId);
    guard(op);
    // A cold locked retry cannot merge: keep its pending ciphertext unchanged on failure.
    await op.deps.vault.mergeRemote(remote.bytes, () => isCurrent(op));
    guard(op);
    const merged = await serialize(op, remote.rev);
    guard(op);
    const res = await op.provider.upload(op.fileId, merged.bytes, merged.baseRev);
    guard(op);
    const rev = res.ok ? res.rev : merged.baseRev;
    await writeCache(op, merged, rev, !res.ok);
    guard(op);
    op.src.basedOnRev = rev;
    return { basedOnRev: rev, merged: true, pendingUpload: !res.ok };
  } catch {
    // Cancellation must reject, even when the provider rejects after a lock/source change.
    guard(op);
    return { basedOnRev: snapshot.baseRev, merged: false, pendingUpload: true };
  }
}
