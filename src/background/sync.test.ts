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
import { vi } from 'vitest';
import * as kdbxweb from 'kdbxweb';

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

async function opened(fileId: string) {
  const p = new FakeCloudProvider();
  p.setFile(fileId, 'vault.kdbx', baseBytes(), 'r1');
  const d = deps(p); const src = source(fileId, 'r1');
  await openCloud(src, d, PW, null);
  return { p, d, src, id: d.vault.entriesForUrl('https://github.com')[0].id };
}

async function expectSaved(p: FakeCloudProvider, src: CloudFileSource, id: string, username: string) {
  const remote = await p.download(src.fileId);
  const cache = (await getCache(cacheKey(src.provider, src.fileId)))!;
  expect(cache.basedOnRev).toBe(remote.rev);
  expect(src.basedOnRev).toBe(remote.rev);
  expect(cache.pendingUpload).toBe(false);
  for (const bytes of [remote.bytes, cache.bytes]) {
    const check = new Vault(); await check.open(bytes, PW, null);
    expect(check.getEntry(id)?.username).toBe(username);
  }
}

test('overlapping saves serialize in order and retain the newest remote/cache plaintext', async () => {
  const { p, d, src, id } = await opened('ordered-saves');
  d.vault.updateEntry(id, { UserName: 'older' });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const revision = p.getRevision.bind(p);
  const hold = vi.spyOn(p, 'getRevision').mockImplementationOnce(async fileId => {
    started.resolve(); await gate.promise; return revision(fileId);
  });
  const serialize = vi.spyOn(d.vault, 'serialize');
  const first = saveCloud(src, d); let second: Promise<unknown> | undefined;
  try {
    await started.promise;
    d.vault.updateEntry(id, { UserName: 'newest' });
    second = saveCloud(src, d);
    expect(serialize).toHaveBeenCalledTimes(1);
    gate.resolve(); await Promise.all([first, second]);
    await expectSaved(p, src, id, 'newest');
    expect(d.vault.dirty).toBe(false);
  } finally {
    gate.resolve(); await Promise.allSettled([first, second]);
    hold.mockRestore(); serialize.mockRestore();
  }
});

test('pending retry finishes before a manual save captures the newest edit', async () => {
  const { p, d, src, id } = await opened('ordered-retry');
  d.vault.updateEntry(id, { UserName: 'pending' });
  await saveCloud(src, { ...d, online: () => false });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const revision = p.getRevision.bind(p);
  const hold = vi.spyOn(p, 'getRevision').mockImplementationOnce(async fileId => {
    started.resolve(); await gate.promise; return revision(fileId);
  });
  const serialize = vi.spyOn(d.vault, 'serialize');
  const retry = retryPending(src, d); let save: Promise<unknown> | undefined;
  try {
    await started.promise;
    d.vault.updateEntry(id, { UserName: 'manual' });
    save = saveCloud(src, d);
    expect(serialize).not.toHaveBeenCalled();
    gate.resolve(); await Promise.all([retry, save]);
    await expectSaved(p, src, id, 'manual');
  } finally {
    gate.resolve(); await Promise.allSettled([retry, save]);
    hold.mockRestore(); serialize.mockRestore();
  }
});

test.each(['field', 'attachment removal'] as const)('a %s during real serialization leaves valid KDBX and stays dirty', async mutation => {
  const { p, d, src, id } = await opened(`serialize-${mutation}`);
  if (mutation === 'attachment removal')
    await d.vault.addAttachment(id, 'note', new Uint8Array([1, 2, 3]).buffer);
  d.vault.updateEntry(id, { UserName: 'snapshot' });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const creds = d.vault['creds']!;
  const getHash = creds.getHash.bind(creds);
  const hold = vi.spyOn(creds, 'getHash').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return getHash(...args);
  });
  const saving = saveCloud(src, d);
  try {
    await started.promise;
    if (mutation === 'field') d.vault.updateEntry(id, { UserName: 'live' });
    else d.vault.removeAttachment(id, 'note');
    gate.resolve(); await saving;
    expect(d.vault.dirty).toBe(true);
    await expectSaved(p, src, id, 'snapshot');
    await saveCloud(src, d);
    await expectSaved(p, src, id, mutation === 'field' ? 'live' : 'snapshot');
    expect(d.vault.dirty).toBe(false);
  } finally { gate.resolve(); await Promise.allSettled([saving]); hold.mockRestore(); }
});

test('request success is not the cache commit: an intervening edit is never acknowledged', async () => {
  const { p, d, src, id } = await opened('cache-commit-edit');
  d.vault.updateEntry(id, { UserName: 'snapshot' });
  const put = IDBObjectStore.prototype.put;
  let edited = false;
  const intercept = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    if (this.name === 'cache' && !edited) request.addEventListener('success', () => {
      expect(d.vault.dirty).toBe(true);
      d.vault.updateEntry(id, { UserName: 'after-request' }); edited = true;
    });
    return request;
  });
  try {
    await saveCloud(src, d);
    expect(edited).toBe(true); expect(d.vault.dirty).toBe(true);
    await expectSaved(p, src, id, 'snapshot');
    await saveCloud(src, d);
    await expectSaved(p, src, id, 'after-request');
    expect(d.vault.dirty).toBe(false);
  } finally { intercept.mockRestore(); }
});

test('aborted cache transaction rejects without acknowledgement and the next save recovers', async () => {
  const { p, d, src, id } = await opened('cache-abort');
  d.vault.updateEntry(id, { UserName: 'recover' });
  const put = IDBObjectStore.prototype.put;
  const intercept = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  try {
    await expect(saveCloud(src, d)).rejects.toMatchObject({ name: 'AbortError' });
    expect(d.vault.dirty).toBe(true); expect(p.uploads).toHaveLength(0);
    await saveCloud(src, d);
    await expectSaved(p, src, id, 'recover');
    expect(d.vault.dirty).toBe(false);
  } finally { intercept.mockRestore(); }
});

test.each(['save', 'retry'] as const)('%s upload acknowledges only its own bytes and preserves a later live edit', async mode => {
  const { p, d, src, id } = await opened(`late-edit-${mode}`);
  d.vault.updateEntry(id, { UserName: 'snapshot' });
  if (mode === 'retry') await saveCloud(src, { ...d, online: () => false });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const upload = p.upload.bind(p);
  const hold = vi.spyOn(p, 'upload').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return upload(...args);
  });
  const work = mode === 'save' ? saveCloud(src, d) : retryPending(src, d);
  try {
    await started.promise;
    d.vault.updateEntry(id, { UserName: 'unsaved' });
    gate.resolve(); await work;
    await expectSaved(p, src, id, 'snapshot');
    expect(d.vault.dirty).toBe(true);
    await saveCloud(src, d);
    await expectSaved(p, src, id, 'unsaved');
    expect(d.vault.dirty).toBe(false);
  } finally { gate.resolve(); await Promise.allSettled([work]); hold.mockRestore(); }
});

test('retry uses the cache revision and never acknowledges live edits already present at request time', async () => {
  const { p, d, src, id } = await opened('retry-revision');
  d.vault.updateEntry(id, { UserName: 'cached' });
  await saveCloud(src, { ...d, online: () => false });
  src.basedOnRev = 'unrelated-mutable-revision';
  d.vault.updateEntry(id, { UserName: 'live' });
  const download = vi.spyOn(p, 'download');
  try {
    expect(await retryPending(src, d)).toMatchObject({ merged: false, pendingUpload: false });
    expect(download).not.toHaveBeenCalled();
    await expectSaved(p, src, id, 'cached');
    expect(d.vault.dirty).toBe(true);
  } finally { download.mockRestore(); }
});

test('a captured save pairs its bytes with the original base revision across awaits', async () => {
  const { p, d, src, id } = await opened('immutable-target');
  p.setFile('other-target', 'other.kdbx', baseBytes(), 'r-other');
  d.vault.updateEntry(id, { UserName: 'original-target' });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const revision = p.getRevision.bind(p);
  const hold = vi.spyOn(p, 'getRevision').mockImplementationOnce(async fileId => {
    const rev = await revision(fileId); started.resolve(); await gate.promise; return rev;
  });
  const work = saveCloud(src, d);
  try {
    await started.promise;
    src.basedOnRev = 'r-other';
    gate.resolve(); await work;
    expect(p.uploads).toHaveLength(1); expect(p.uploads[0].fileId).toBe('immutable-target');
    expect((await p.download('other-target')).rev).toBe('r-other');
    expect(await getCache(cacheKey('dropbox', 'other-target'))).toBeNull();
    await expectSaved(p, src, id, 'original-target');
  } finally { gate.resolve(); await Promise.allSettled([work]); hold.mockRestore(); }
});

test.each(['fileId', 'provider'] as const)('changing source %s in place cancels before another provider effect', async field => {
  const { p, d, src, id } = await opened(`changed-${field}`);
  d.vault.updateEntry(id, { UserName: 'old-target' });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const hold = vi.spyOn(p, 'getRevision').mockImplementationOnce(async () => {
    started.resolve(); await gate.promise; return 'r1';
  });
  const work = saveCloud(src, d);
  try {
    await started.promise;
    if (field === 'fileId') src.fileId = 'new-target';
    else src.provider = 'gdrive';
    src.basedOnRev = 'revB';
    const rejected = expect(work).rejects.toThrow('staleSession'); gate.resolve(); await rejected;
    expect(p.uploads).toHaveLength(0); expect(src.basedOnRev).toBe('revB');
    expect(await getCache(cacheKey(src.provider, src.fileId))).toBeNull();
  } finally { gate.resolve(); await Promise.allSettled([work]); hold.mockRestore(); }
});

test.each(['revision', 'download', 'upload', 'merge'] as const)('lock/replacement during %s cancels active and queued work', async phase => {
  const { p, d, src, id } = await opened(`stale-${phase}`);
  d.vault.updateEntry(id, { UserName: 'old-session' });
  if (phase === 'download' || phase === 'merge') p.setRevision(src.fileId, 'r2');
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const hold = phase === 'revision' ? vi.spyOn(p, 'getRevision').mockImplementationOnce(async () => {
    started.resolve(); await gate.promise; throw new Error('offline-after-lock');
  }) : phase === 'download' ? vi.spyOn(p, 'download').mockImplementationOnce(async () => {
    started.resolve(); await gate.promise; return { bytes: baseBytes(), rev: 'r2' };
  }) : phase === 'upload' ? (() => {
    const upload = p.upload.bind(p);
    return vi.spyOn(p, 'upload').mockImplementationOnce(async (...args) => {
      started.resolve(); await gate.promise; return upload(...args);
    });
  })() : (() => {
    const load = kdbxweb.Kdbx.load.bind(kdbxweb.Kdbx);
    return vi.spyOn(kdbxweb.Kdbx, 'load').mockImplementationOnce(async (...args) => {
      started.resolve(); await gate.promise; return load(...args);
    });
  })();
  const work = saveCloud(src, d);
  let queued: Promise<unknown> | undefined;
  try {
    await started.promise;
    queued = saveCloud(src, d);
    d.vault.lock();
    expect(d.vault.isOpen()).toBe(false);
    await d.vault.open(baseBytes(), PW, null);
    d.vault.updateEntry(id, { UserName: 'replacement' });
    const generation = d.vault.lifecycleGeneration;
    const version = d.vault.mutationVersion;
    const results = Promise.allSettled([work, queued]);
    gate.resolve();
    for (const result of await results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ message: 'staleSession' });
    }
    expect(d.vault.lifecycleGeneration).toBe(generation); expect(d.vault.mutationVersion).toBe(version);
    expect(d.vault.getEntry(id)?.username).toBe('replacement'); expect(d.vault.dirty).toBe(true);
    expect(src.basedOnRev).toBe('r1');
    expect(p.uploads).toHaveLength(phase === 'upload' ? 1 : 0);
    expect((await getCache(cacheKey('dropbox', src.fileId)))?.pendingUpload).toBe(true);
  } finally { gate.resolve(); await Promise.allSettled([work, queued]); hold.mockRestore(); }
});

test('source supersession during remote decryption cannot merge into the still-open Vault', async () => {
  const { p, d, src, id } = await opened('source-during-merge');
  d.vault.updateEntry(id, { UserName: 'local' }); p.setRevision(src.fileId, 'r2');
  let current = src;
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const load = kdbxweb.Kdbx.load.bind(kdbxweb.Kdbx);
  const hold = vi.spyOn(kdbxweb.Kdbx, 'load').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return load(...args);
  });
  const work = saveCloud(src, { ...d, isCurrent: () => current === src });
  try {
    await started.promise;
    const version = d.vault.mutationVersion;
    current = source('B', 'revB');
    const rejected = expect(work).rejects.toThrow('staleSession'); gate.resolve(); await rejected;
    expect(d.vault.mutationVersion).toBe(version);
    expect(current.basedOnRev).toBe('revB'); expect(p.uploads).toHaveLength(0);
    expect(d.vault.getEntry(id)?.username).toBe('local');
  } finally { gate.resolve(); await Promise.allSettled([work]); hold.mockRestore(); }
});

test('a lock at cache request success prevents provider work and a stale dirty acknowledgement', async () => {
  const { p, d, src, id } = await opened('lock-cache');
  d.vault.updateEntry(id, { UserName: 'cached-old-session' });
  const put = IDBObjectStore.prototype.put;
  const intercept = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    request.addEventListener('success', () => d.vault.lock());
    return request;
  });
  try {
    await expect(saveCloud(src, d)).rejects.toThrow('staleSession');
    expect(p.uploads).toHaveLength(0); expect(src.basedOnRev).toBe('r1');
    expect(d.vault.isOpen()).toBe(false);
    expect((await getCache(cacheKey('dropbox', src.fileId)))?.pendingUpload).toBe(true);
  } finally { intercept.mockRestore(); }
});

test('merge includes a live edit arriving during download and preserves an edit after the merged snapshot', async () => {
  const { p, d, src, id } = await opened('merge-live-edit');
  d.vault.updateEntry(id, { UserName: 'first' });
  const remote = await freshRemoteBytes(v => {
    v.createEntry(v.getTree().groupId, { Title: 'Remote', URL: 'https://remote.example' });
  });
  p.setFile(src.fileId, 'vault.kdbx', remote, 'r2');
  const downloadGate = Promise.withResolvers<void>(); const downloadStarted = Promise.withResolvers<void>();
  const uploadGate = Promise.withResolvers<void>(); const uploadStarted = Promise.withResolvers<void>();
  const download = p.download.bind(p); const upload = p.upload.bind(p);
  const heldDownload = vi.spyOn(p, 'download').mockImplementationOnce(async fileId => {
    downloadStarted.resolve(); await downloadGate.promise; return download(fileId);
  });
  const heldUpload = vi.spyOn(p, 'upload').mockImplementationOnce(async (...args) => {
    uploadStarted.resolve(); await uploadGate.promise; return upload(...args);
  });
  const work = saveCloud(src, d);
  try {
    await downloadStarted.promise;
    d.vault.updateEntry(id, { UserName: 'during-download' }); downloadGate.resolve();
    await uploadStarted.promise;
    d.vault.updateEntry(id, { UserName: 'after-merge-snapshot' }); uploadGate.resolve();
    expect(await work).toMatchObject({ merged: true, pendingUpload: false });
    await expectSaved(p, src, id, 'during-download');
    const check = new Vault(); await check.open((await download(src.fileId)).bytes, PW, null);
    expect(check.entriesForUrl('https://remote.example')).toHaveLength(1);
    expect(d.vault.dirty).toBe(true);
    await saveCloud(src, d); await expectSaved(p, src, id, 'after-merge-snapshot');
    expect(d.vault.dirty).toBe(false);
  } finally {
    downloadGate.resolve(); uploadGate.resolve(); await Promise.allSettled([work]);
    heldDownload.mockRestore(); heldUpload.mockRestore();
  }
});

test('provider failure preserves pending bytes, rapid queued saves recover to the newest plaintext', async () => {
  const { p, d, src, id } = await opened('rapid-recovery');
  d.vault.updateEntry(id, { UserName: 'offline' }); p.setOffline(true);
  expect(await saveCloud(src, d)).toMatchObject({ pendingUpload: true });
  const pending = (await getCache(cacheKey('dropbox', src.fileId)))!;
  expect(pending.pendingUpload).toBe(true);
  expect(await retryPending(src, d)).toMatchObject({ pendingUpload: true });
  expect(new Uint8Array((await getCache(cacheKey('dropbox', src.fileId)))!.bytes)).toEqual(new Uint8Array(pending.bytes));
  p.setOffline(false);
  const saves = Array.from({ length: 6 }, (_, i) => {
    d.vault.updateEntry(id, { UserName: `latest-${i}` }); return saveCloud(src, d);
  });
  await Promise.all(saves); await expectSaved(p, src, id, 'latest-5');
  expect(d.vault.dirty).toBe(false);
});

test('retry queued behind an upload reads the committed clean cache and performs no duplicate upload', async () => {
  const { p, d, src, id } = await opened('retry-after-save');
  d.vault.updateEntry(id, { UserName: 'saved' });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const upload = p.upload.bind(p);
  const hold = vi.spyOn(p, 'upload').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return upload(...args);
  });
  const saving = saveCloud(src, d); let retry: Promise<unknown> | undefined;
  try {
    await started.promise; retry = retryPending(src, d);
    gate.resolve(); await saving;
    expect(await retry).toBeNull(); expect(p.uploads).toHaveLength(1);
    await expectSaved(p, src, id, 'saved');
  } finally { gate.resolve(); await Promise.allSettled([saving, retry]); hold.mockRestore(); }
});

test('cloud open waits for the prior save and adopts only its own session', async () => {
  const { p, d, src, id } = await opened('save-before-open');
  d.vault.updateEntry(id, { UserName: 'saved-before-replacement' });
  p.setFile('open-next', 'next.kdbx', baseBytes(), 'rB');
  const next = source('open-next', 'rB');
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const upload = p.upload.bind(p);
  const hold = vi.spyOn(p, 'upload').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return upload(...args);
  });
  const saved = saveCloud(src, d); let opening: Promise<unknown> | undefined;
  let ownSession: number | undefined;
  try {
    await started.promise;
    const oldSession = d.vault.lifecycleGeneration;
    opening = openCloud(next, { ...d, onOpened: token => { ownSession = token; } }, PW, null);
    expect(ownSession).toBeUndefined();
    gate.resolve(); await Promise.all([saved, opening]);
    expect(d.vault.lifecycleGeneration).toBe(ownSession); expect(ownSession).toBeGreaterThan(oldSession);
    await expectSaved(p, src, id, 'saved-before-replacement');
    await expectSaved(p, next, id, 'octocat');
  } finally { gate.resolve(); await Promise.allSettled([saved, opening]); hold.mockRestore(); }
});

test.each(['revision', 'download', 'load', 'cache'] as const)('cloud open canceled at %s never installs its revision or starts subsequent work', async phase => {
  const p = new FakeCloudProvider(); const fileId = `open-cancel-${phase}`;
  p.setFile(fileId, 'vault.kdbx', baseBytes(), 'r2');
  const d = deps(p); const src = source(fileId, 'r1');
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const hold = phase === 'revision' ? vi.spyOn(p, 'getRevision').mockImplementationOnce(async () => {
    started.resolve(); await gate.promise; throw new Error('offline');
  }) : phase === 'download' ? vi.spyOn(p, 'download').mockImplementationOnce(async () => {
    started.resolve(); await gate.promise; return { bytes: baseBytes(), rev: 'r2' };
  }) : phase === 'load' ? (() => {
    const load = kdbxweb.Kdbx.load.bind(kdbxweb.Kdbx);
    return vi.spyOn(kdbxweb.Kdbx, 'load').mockImplementationOnce(async (...args) => {
      started.resolve(); await gate.promise; return load(...args);
    });
  })() : (() => {
    const put = IDBObjectStore.prototype.put;
    return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      request.addEventListener('success', () => { d.vault.lock(); started.resolve(); });
      return request;
    });
  })();
  const work = openCloud(src, d, PW, null);
  const rejected = expect(work).rejects.toThrow('staleSession');
  try {
    await started.promise;
    if (phase !== 'cache') d.vault.lock();
    gate.resolve(); await rejected;
    expect(src.basedOnRev).toBe('r1'); expect(d.vault.isOpen()).toBe(false);
    expect(p.uploads).toHaveLength(0);
    expect(!!(await getCache(cacheKey('dropbox', fileId)))).toBe(phase === 'cache');
  } finally { gate.resolve(); await Promise.allSettled([work, rejected]); hold.mockRestore(); }
});

test('a blocked Vault does not delay a cloud save on another Vault', async () => {
  const a = await opened('independent-a'); const b = await opened('independent-b');
  a.d.vault.updateEntry(a.id, { UserName: 'A' }); b.d.vault.updateEntry(b.id, { UserName: 'B' });
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const hold = vi.spyOn(a.p, 'getRevision').mockImplementationOnce(async () => {
    started.resolve(); await gate.promise; return 'r1';
  });
  const work = saveCloud(a.src, a.d);
  try {
    await started.promise;
    await saveCloud(b.src, b.d); await expectSaved(b.p, b.src, b.id, 'B');
    expect(a.p.uploads).toHaveLength(0);
    gate.resolve(); await work; await expectSaved(a.p, a.src, a.id, 'A');
  } finally { gate.resolve(); await Promise.allSettled([work]); hold.mockRestore(); }
});

test('lock during serialization prevents the first cache transaction and provider access', async () => {
  const { p, d, src, id } = await opened('lock-serialize');
  d.vault.updateEntry(id, { UserName: 'old' });
  const previous = (await getCache(cacheKey('dropbox', src.fileId)))!;
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const serialize = d.vault.serialize.bind(d.vault);
  const hold = vi.spyOn(d.vault, 'serialize').mockImplementationOnce(async () => {
    const bytes = await serialize(); started.resolve(); await gate.promise; return bytes;
  });
  const revision = vi.spyOn(p, 'getRevision');
  const work = saveCloud(src, d);
  try {
    await started.promise; d.vault.lock();
    const rejected = expect(work).rejects.toThrow('staleSession'); gate.resolve(); await rejected;
    expect(revision).not.toHaveBeenCalled(); expect(p.uploads).toHaveLength(0);
    const cache = (await getCache(cacheKey('dropbox', src.fileId)))!;
    expect(cache.pendingUpload).toBe(false);
    expect(new Uint8Array(cache.bytes)).toEqual(new Uint8Array(previous.bytes));
  } finally { gate.resolve(); await Promise.allSettled([work]); hold.mockRestore(); revision.mockRestore(); }
});

test('a repeated conflict durably caches the merged snapshot for a later retry', async () => {
  const { p, d, src, id } = await opened('repeat-conflict');
  d.vault.updateEntry(id, { UserName: 'local' });
  const remote = await freshRemoteBytes(v => {
    v.createEntry(v.getTree().groupId, { Title: 'Remote', URL: 'https://remote.example' });
  });
  p.setFile(src.fileId, 'vault.kdbx', remote, 'r2'); p.failNextUploadWithConflict();
  expect(await saveCloud(src, d)).toEqual({ basedOnRev: 'r2', merged: true, pendingUpload: true });
  const pending = (await getCache(cacheKey('dropbox', src.fileId)))!;
  const cached = new Vault(); await cached.open(pending.bytes, PW, null);
  expect(cached.getEntry(id)?.username).toBe('local');
  expect(cached.entriesForUrl('https://remote.example')).toHaveLength(1);
  expect(pending.basedOnRev).toBe('r2'); expect(pending.pendingUpload).toBe(true);
  expect(d.vault.dirty).toBe(false);
  expect(await retryPending(src, d)).toMatchObject({ pendingUpload: false });
  await expectSaved(p, src, id, 'local');
  const check = new Vault(); await check.open((await p.download(src.fileId)).bytes, PW, null);
  expect(check.entriesForUrl('https://remote.example')).toHaveLength(1);
});

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

describe.each(['locked', 'dirty replacement'] as const)('atomic cloud open from %s', initial => {
  test.each(['cached decrypt', 'remote decrypt', 'merge', 'serialize', 'cache abort'] as const)(
    '%s failure retains the live session', async phase => {
      const p = new FakeCloudProvider();
      const fileId = `atomic-${initial}-${phase}`;
      p.setFile(fileId, 'candidate.kdbx', baseBytes(), 'r2');
      const d = deps(p); const src = source(fileId, 'original');
      let id: string | undefined;
      if (initial === 'dirty replacement') {
        await d.vault.open(baseBytes(), PW, null);
        id = d.vault.entriesForUrl('https://github.com')[0].id;
        d.vault.updateEntry(id, { UserName: 'old unsaved secret' });
      }
      const before = { generation: d.vault.lifecycleGeneration, version: d.vault.mutationVersion,
        dirty: d.vault.dirty, entry: id ? d.vault.getEntry(id) : null };
      if (phase !== 'remote decrypt' && phase !== 'cache abort') await putCache(cacheKey('dropbox', fileId), {
        bytes: baseBytes(), basedOnRev: phase === 'cached decrypt' ? 'r2' : 'r1',
        pendingUpload: phase !== 'cached decrypt', lastSyncedAt: 0,
      });
      const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
      const failure = new Error(`failed ${phase}`);
      const hold = phase.includes('decrypt') ? vi.spyOn(kdbxweb.Kdbx, 'load').mockImplementationOnce(async () => {
        started.resolve(); await gate.promise; throw failure;
      }) : phase === 'merge' ? vi.spyOn(Vault.prototype, 'mergeRemote').mockImplementationOnce(async () => {
        started.resolve(); await gate.promise; throw failure;
      }) : phase === 'serialize' ? vi.spyOn(Vault.prototype, 'serialize').mockImplementationOnce(async () => {
        started.resolve(); await gate.promise; throw failure;
      }) : (() => {
        const put = IDBObjectStore.prototype.put;
        return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
          const request = put.call(this, value, key);
          request.addEventListener('success', () => { this.transaction.abort(); started.resolve(); });
          return request;
        });
      })();
      const onOpened = vi.fn();
      const opening = openCloud(src, { ...d, onOpened }, PW, null);
      const rejected = expect(opening).rejects.toBeDefined();
      try {
        await started.promise;
        // Even after decryption, a preparing candidate cannot expose plaintext through live reads.
        expect(d.vault.isOpen()).toBe(initial !== 'locked');
        expect(d.vault.lifecycleGeneration).toBe(before.generation);
        if (id) expect(d.vault.getEntry(id)).toEqual(before.entry);
        else expect(() => d.vault.getTree()).toThrow('locked');
        gate.resolve(); await rejected;
        expect(d.vault.lifecycleGeneration).toBe(before.generation);
        expect(d.vault.mutationVersion).toBe(before.version);
        expect(d.vault.dirty).toBe(before.dirty);
        expect(src.basedOnRev).toBe('original'); expect(onOpened).not.toHaveBeenCalled();
        if (id) expect(d.vault.getEntry(id)).toEqual(before.entry);
      } finally { gate.resolve(); await Promise.allSettled([opening, rejected]); hold.mockRestore(); }
    },
  );
});

describe.each(['revision', 'decrypt', 'merge', 'serialize', 'cache commit'] as const)('cloud preparation waiting at %s', phase => {
  test.each(['lock', 'new open', 'source', 'edit'] as const)('%s discards the late candidate and preserves intervening state', async action => {
    const p = new FakeCloudProvider(); const fileId = `late-open-${phase}-${action}`;
    p.setFile(fileId, 'candidate.kdbx', baseBytes(), 'r2');
    const d = deps(p); const src = source(fileId, 'original');
    await d.vault.open(baseBytes(), PW, null);
    const id = d.vault.entriesForUrl('https://github.com')[0].id; d.vault.updateEntry(id, { UserName: 'old dirty' });
    const replacement = await d.vault.prepareOpen(baseBytes(), PW, null);
    let current = true;
    if (phase === 'merge' || phase === 'serialize') await putCache(cacheKey('dropbox', fileId), {
      bytes: baseBytes(), basedOnRev: 'r1', pendingUpload: true, lastSyncedAt: 0,
    });
    const intervene = () => {
      if (action === 'lock') d.vault.lock();
      else if (action === 'new open') { d.vault.adoptPrepared(replacement); d.vault.updateEntry(id, { UserName: 'new dirty' }); }
      else if (action === 'source') current = false;
      else d.vault.updateEntry(id, { UserName: 'intervening edit' });
    };
    const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
    const hold = phase === 'revision' ? vi.spyOn(p, 'getRevision').mockImplementationOnce(async () => {
      started.resolve(); await gate.promise; return 'r2';
    }) : phase === 'decrypt' ? (() => {
      const load = kdbxweb.Kdbx.load.bind(kdbxweb.Kdbx);
      return vi.spyOn(kdbxweb.Kdbx, 'load').mockImplementationOnce(async (...args) => {
        started.resolve(); await gate.promise; return load(...args);
      });
    })() : phase === 'merge' ? (() => {
      const merge = Vault.prototype.mergeRemote;
      return vi.spyOn(Vault.prototype, 'mergeRemote').mockImplementationOnce(async function (this: Vault, ...args) {
        started.resolve(); await gate.promise; return merge.apply(this, args);
      });
    })() : phase === 'serialize' ? (() => {
      const serialize = Vault.prototype.serialize;
      return vi.spyOn(Vault.prototype, 'serialize').mockImplementationOnce(async function (this: Vault) {
        const bytes = await serialize.call(this); started.resolve(); await gate.promise; return bytes;
      });
    })() : (() => {
      const put = IDBObjectStore.prototype.put;
      return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
        const request = put.call(this, value, key);
        request.addEventListener('success', () => { intervene(); started.resolve(); }); return request;
      });
    })();
    const onOpened = vi.fn();
    const opening = openCloud(src, { ...d, isCurrent: () => current, onOpened }, PW, null);
    const rejected = expect(opening).rejects.toThrow('staleSession');
    try {
      await started.promise; if (phase !== 'cache commit') intervene();
      const generation = d.vault.lifecycleGeneration; const version = d.vault.mutationVersion;
      const entry = d.vault.getEntry(id); const dirty = d.vault.dirty;
      gate.resolve(); await rejected;
      expect(d.vault.lifecycleGeneration).toBe(generation); expect(d.vault.mutationVersion).toBe(version);
      expect(d.vault.getEntry(id)).toEqual(entry); expect(d.vault.dirty).toBe(dirty);
      expect(d.vault.isOpen()).toBe(action !== 'lock'); expect(src.basedOnRev).toBe('original');
      expect(onOpened).not.toHaveBeenCalled(); expect(p.uploads).toHaveLength(0);
    } finally { gate.resolve(); await Promise.allSettled([opening, rejected]); hold.mockRestore(); replacement.discard(); }
  });
});

test('an edit while cloud open waits behind a save cancels before preparing the candidate', async () => {
  const { p, d, src, id } = await opened('edit-before-queued-open');
  d.vault.updateEntry(id, { UserName: 'saving' });
  p.setFile('queued-candidate', 'candidate.kdbx', baseBytes(), 'r2');
  const next = source('queued-candidate', 'original');
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const upload = p.upload.bind(p);
  const hold = vi.spyOn(p, 'upload').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return upload(...args);
  });
  const saving = saveCloud(src, d); let opening: Promise<unknown> | undefined;
  const prepare = vi.spyOn(d.vault, 'prepareOpen');
  try {
    await started.promise; opening = openCloud(next, d, PW, null);
    d.vault.updateEntry(id, { UserName: 'later unsaved edit' });
    const rejected = expect(opening).rejects.toThrow('staleSession');
    gate.resolve(); await saving; await rejected;
    expect(prepare).not.toHaveBeenCalled(); expect(d.vault.getEntry(id)?.username).toBe('later unsaved edit');
    expect(d.vault.dirty).toBe(true); expect(next.basedOnRev).toBe('original');
  } finally { gate.resolve(); await Promise.allSettled([saving, opening]); hold.mockRestore(); prepare.mockRestore(); }
});

test.each(['save', 'retry'] as const)('%s queued behind an open cannot acknowledge the adopted session', async mode => {
  const { p, d, src, id } = await opened(`queued-after-open-${mode}`);
  d.vault.updateEntry(id, { UserName: 'old pending' });
  await saveCloud(src, { ...d, online: () => false });
  p.setFile(`replacement-${mode}`, 'candidate.kdbx', baseBytes(), 'r2');
  const next = source(`replacement-${mode}`, 'original');
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const revision = p.getRevision.bind(p);
  const hold = vi.spyOn(p, 'getRevision').mockImplementationOnce(async fileId => {
    started.resolve(); await gate.promise; return revision(fileId);
  });
  const opening = openCloud(next, { ...d, onOpened: () => d.vault.updateEntry(id, { UserName: 'new unsaved' }) }, PW, null);
  let queued: Promise<unknown> | undefined;
  try {
    await started.promise;
    queued = mode === 'save' ? saveCloud(src, d) : retryPending(src, d);
    const rejected = expect(queued).rejects.toThrow('staleSession'); gate.resolve();
    await opening; await rejected;
    expect(d.vault.getEntry(id)?.username).toBe('new unsaved'); expect(d.vault.dirty).toBe(true);
    expect(p.uploads).toHaveLength(0); expect((await getCache(cacheKey('dropbox', src.fileId)))?.pendingUpload).toBe(true);
  } finally { gate.resolve(); await Promise.allSettled([opening, queued]); hold.mockRestore(); }
});
