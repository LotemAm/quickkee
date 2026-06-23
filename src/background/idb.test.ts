import 'fake-indexeddb/auto';
import { openQuickKeeDb, tx } from './idb';

test('opens quickkee DB at v2 with handles + cache stores', async () => {
  const db = await openQuickKeeDb();
  expect(db.version).toBe(2);
  expect(Array.from(db.objectStoreNames).sort()).toEqual(['cache', 'handles']);
});

test('tx round-trips a value through a named store', async () => {
  await tx('cache', 'readwrite', s => s.put({ v: 1 }, 'k'));
  const got = await tx<{ v: number }>('cache', 'readonly', s => s.get('k'));
  expect(got.v).toBe(1);
});
