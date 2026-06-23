import { FakeCloudProvider } from './fakeCloudProvider';

const buf = (n: number) => new Uint8Array([n]).buffer;

test('download returns set bytes and rev', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(7), 'r1');
  const { bytes, rev } = await p.download('f1');
  expect(rev).toBe('r1');
  expect(new Uint8Array(bytes)[0]).toBe(7);
});

test('getRevision reflects setRevision', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(1), 'r1');
  p.setRevision('f1', 'r2');
  expect(await p.getRevision('f1')).toBe('r2');
});

test('upload with matching rev succeeds and records bytes', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(1), 'r1');
  const res = await p.upload('f1', buf(9), 'r1');
  expect(res).toEqual({ ok: true, rev: expect.any(String) });
  expect(p.uploads).toHaveLength(1);
});

test('upload with stale basedOnRev returns conflict', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(1), 'r2');
  const res = await p.upload('f1', buf(9), 'r1'); // based on r1, remote at r2
  expect(res).toEqual({ ok: false, conflict: true });
});

test('forced conflict overrides a matching rev', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(1), 'r1');
  p.failNextUploadWithConflict();
  expect(await p.upload('f1', buf(9), 'r1')).toEqual({ ok: false, conflict: true });
});

test('offline rejects network calls', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(1), 'r1');
  p.setOffline(true);
  await expect(p.getRevision('f1')).rejects.toThrow('offline');
});

test('listKdbxFiles lists set files', async () => {
  const p = new FakeCloudProvider();
  p.setFile('f1', 'a.kdbx', buf(1), 'r1');
  const files = await p.listKdbxFiles();
  expect(files).toEqual([{ fileId: 'f1', name: 'a.kdbx', rev: 'r1' }]);
});
