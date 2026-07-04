// @vitest-environment node
import 'fake-indexeddb/auto';
import { Vault } from './vault';
import { FakeCloudProvider } from './sources/fakeCloudProvider';
import { cacheKey, getCache, putCache } from './cache';
import { openCloud, saveCloud, retryPending, type SyncDeps } from './sync';
import type { CloudFileSource } from '../shared/dbSource';
import { registerArgon2 } from './crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function baseBytes(): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, '../test/fixtures/test.kdbx'));
  const ab = new ArrayBuffer(buf.byteLength); new Uint8Array(ab).set(buf); return ab;
}
const PW = 'correct horse';

async function freshRemoteBytes(mutate?: (v: Vault) => void): Promise<ArrayBuffer> {
  const v = new Vault(); await v.open(baseBytes(), PW, null);
  if (mutate) mutate(v);
  return v.serialize();
}

function deps(provider: FakeCloudProvider, online = true): SyncDeps {
  return { vault: new Vault(), provider, online: () => online };
}
function source(fileId: string, basedOnRev: string): CloudFileSource {
  return { kind: 'cloud', provider: 'dropbox', fileId, basedOnRev };
}

beforeAll(() => registerArgon2());

test('open: same rev as cache loads from cache without download', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  const out = await openCloud(src, d, PW, null);
  expect(out).toMatchObject({ basedOnRev: 'r1', merged: false, offline: false });
  expect(d.vault.isOpen()).toBe(true);
});

test('open: newer remote with no pending edits fast-forwards', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r2');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const out = await openCloud(source('f1', 'r1'), deps(p), PW, null);
  expect(out).toMatchObject({ basedOnRev: 'r2', merged: false });
  expect((await getCache(cacheKey('dropbox', 'f1')))?.basedOnRev).toBe('r2');
});

test('open: newer remote WITH pending edits merges', async () => {
  // Cache holds local edits (pendingUpload), remote advanced independently.
  const localEdited = await freshRemoteBytes(v => {
    const id = v.entriesForUrl('https://github.com')[0].id; v.updateEntry(id, { UserName: 'local-user' });
  });
  const remoteEdited = await freshRemoteBytes(v => {
    const root = v.getTree().groupId;
    v.createEntry(root, { Title: 'RemoteOnly', URL: 'https://remote.example', UserName: 'r', Password: 'p' });
  });
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remoteEdited, 'r2');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: localEdited, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: true });
  const d = deps(p);
  const out = await openCloud(source('f1', 'r1'), d, PW, null);
  expect(out.merged).toBe(true);
  expect(out.basedOnRev).toBe('r2');
  // both edits present in the now-open vault
  expect(d.vault.entriesForUrl('https://remote.example')).toHaveLength(1);
  // still pending until the merged result is uploaded
  expect((await getCache(cacheKey('dropbox', 'f1')))?.pendingUpload).toBe(true);
});

test('open: offline loads cache and reports offline', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1'); p.setOffline(true);
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p, false);
  const out = await openCloud(source('f1', 'r1'), d, PW, null);
  expect(out.offline).toBe(true);
  expect(d.vault.isOpen()).toBe(true);
});

test('save: clean rev uploads and clears pending', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  const id = d.vault.entriesForUrl('https://github.com')[0].id;
  d.vault.updateEntry(id, { UserName: 'changed' });
  const out = await saveCloud(src, d);
  expect(out).toMatchObject({ merged: false, pendingUpload: false });
  expect(src.basedOnRev).toBe(out.basedOnRev);
  expect(p.uploads).toHaveLength(1);
});

test('save: remote advanced → download, merge, re-upload, notify', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  const id = d.vault.entriesForUrl('https://github.com')[0].id;
  d.vault.updateEntry(id, { UserName: 'local-change' });

  // Another device pushes a new remote version before our save.
  const remoteEdited = await freshRemoteBytes(v => {
    const root = v.getTree().groupId;
    v.createEntry(root, { Title: 'RemoteOnly', URL: 'https://remote.example', UserName: 'r', Password: 'p' });
  });
  p.setFile('f1', 'a.kdbx', remoteEdited, 'r2');

  const out = await saveCloud(src, d);
  expect(out.merged).toBe(true);
  expect(out.pendingUpload).toBe(false);
  // uploaded merged bytes contain BOTH edits
  const uploaded = p.uploads.at(-1)!.bytes;
  const check = new Vault(); await check.open(uploaded, PW, null);
  expect(check.entriesForUrl('https://remote.example')).toHaveLength(1);
  expect(check.getEntry(id)?.username).toBe('local-change');
});

test('save: offline keeps pendingUpload for later retry', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  d.vault.updateEntry(d.vault.entriesForUrl('https://github.com')[0].id, { UserName: 'x' });
  p.setOffline(true);
  const out = await saveCloud(src, { ...d, online: () => false });
  expect(out.pendingUpload).toBe(true);
  expect(p.uploads).toHaveLength(0);
  expect((await getCache(cacheKey('dropbox', 'f1')))?.pendingUpload).toBe(true);
});

test('retryPending uploads a deferred save once back online', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  d.vault.updateEntry(d.vault.entriesForUrl('https://github.com')[0].id, { UserName: 'y' });
  await saveCloud(src, { ...d, online: () => false }); // deferred
  const out = await retryPending(src, d);               // now online
  expect(out?.pendingUpload).toBe(false);
  expect(p.uploads).toHaveLength(1);
});

test('retryPending returns null when nothing is pending', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  expect(await retryPending(source('f1', 'r1'), deps(p))).toBeNull();
});

test('retryPending on a locked vault with drifted remote fails safe (no edits lost)', async () => {
  const localEdited = await freshRemoteBytes(v => {
    const id = v.entriesForUrl('https://github.com')[0].id; v.updateEntry(id, { UserName: 'local-user' });
  });
  const remoteEdited = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remoteEdited, 'r2'); // remote drifted to r2
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: localEdited, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: true });
  const d = deps(p); const src = source('f1', 'r1'); // FRESH unopened vault; no openCloud first
  const out = await retryPending(src, d); // merge path on a locked vault → throws inside, caught
  expect(out?.pendingUpload).toBe(true);
  expect(p.uploads).toHaveLength(0);
  const cache = await getCache(cacheKey('dropbox', 'f1'));
  expect(cache?.pendingUpload).toBe(true);
  expect(new Uint8Array(cache!.bytes)).toEqual(new Uint8Array(localEdited));
});

test('saveCloud clears dirty after cache write (online upload)', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  d.vault.updateEntry(d.vault.entriesForUrl('https://github.com')[0].id, { UserName: 'changed' });
  expect(d.vault.dirty).toBe(true);
  await saveCloud(src, d);
  expect(d.vault.dirty).toBe(false);
});

test('saveCloud clears dirty after cache write (offline deferred)', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  d.vault.updateEntry(d.vault.entriesForUrl('https://github.com')[0].id, { UserName: 'changed' });
  expect(d.vault.dirty).toBe(true);
  await saveCloud(src, { ...d, online: () => false });
  expect(d.vault.dirty).toBe(false);
});

test('dirty cleared even when upload conflicts after cache write', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  d.vault.updateEntry(d.vault.entriesForUrl('https://github.com')[0].id, { UserName: 'changed' });
  // Simulate conflict after cache write
  p.failNextUploadWithConflict();
  expect(d.vault.dirty).toBe(true);
  const out = await saveCloud(src, d);
  // dirty is cleared because cache write succeeded (durable), even though initial upload conflicted
  expect(d.vault.dirty).toBe(false);
  // conflict detected → merge path, re-upload succeeds
  expect(out.merged).toBe(true);
  expect(out.pendingUpload).toBe(false);
});

test('dirty stays cleared and pendingUpload is true when upload throws after cache write', async () => {
  const remote = await freshRemoteBytes();
  const p = new FakeCloudProvider(); p.setFile('f1', 'a.kdbx', remote, 'r1');
  await putCache(cacheKey('dropbox', 'f1'),
    { bytes: remote, basedOnRev: 'r1', lastSyncedAt: 0, pendingUpload: false });
  const d = deps(p); const src = source('f1', 'r1');
  await openCloud(src, d, PW, null);
  d.vault.updateEntry(d.vault.entriesForUrl('https://github.com')[0].id, { UserName: 'changed' });
  expect(d.vault.dirty).toBe(true);
  // Cache write succeeds (saveCloud clears dirty), but the provider then throws on the
  // network call inside pushOrMerge — deps.online() lies true so saveCloud attempts the
  // upload; the provider itself is offline and throws.
  p.setOffline(true);
  const out = await saveCloud(src, { ...d, online: () => true });
  expect(d.vault.dirty).toBe(false);
  expect(out.pendingUpload).toBe(true);
});
