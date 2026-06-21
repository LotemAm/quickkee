import 'fake-indexeddb/auto';
import { saveHandle, loadHandle, clearHandle } from './fileHandle';

const fakeHandle = { name: 'db.kdbx', kind: 'file' } as unknown as FileSystemFileHandle;

test('round-trips a handle through IndexedDB', async () => {
  await saveHandle(fakeHandle);
  const got = await loadHandle();
  expect(got?.name).toBe('db.kdbx');
});
test('clear removes it', async () => {
  await saveHandle(fakeHandle); await clearHandle();
  expect(await loadHandle()).toBeNull();
});
