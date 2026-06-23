import 'fake-indexeddb/auto';
import { cacheKey, getCache, putCache, deleteCache, type CacheRecord } from './cache';

const rec: CacheRecord = {
  bytes: new Uint8Array([1, 2, 3]).buffer,
  basedOnRev: 'rev-1',
  lastSyncedAt: 1000,
  pendingUpload: false,
};

test('cacheKey composes provider and fileId', () => {
  expect(cacheKey('dropbox', 'abc')).toBe('dropbox:abc');
});

test('missing key returns null', async () => {
  expect(await getCache('dropbox:none')).toBeNull();
});

test('put then get round-trips the record', async () => {
  const k = cacheKey('gdrive', 'file1');
  await putCache(k, rec);
  const got = await getCache(k);
  expect(got?.basedOnRev).toBe('rev-1');
  expect(got?.pendingUpload).toBe(false);
  expect(new Uint8Array(got!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
});

test('delete removes the record', async () => {
  const k = cacheKey('gdrive', 'file2');
  await putCache(k, rec);
  await deleteCache(k);
  expect(await getCache(k)).toBeNull();
});
