import 'fake-indexeddb/auto';
import { openQuickKeeDb, tx } from './idb';
import { vi } from 'vitest';

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

test('memoizes connection', async () => {
  const a = await openQuickKeeDb();
  const b = await openQuickKeeDb();
  expect(b).toBe(a);
});

test('versionchange recovery: tx discards the stale connection and retries on a fresh one', async () => {
  // Permanently break db1.transaction so the test can only pass if the retry
  // actually opened a *different* connection, not just called db1.transaction again.
  const db1 = await openQuickKeeDb();
  const spy = vi.spyOn(db1, 'transaction').mockImplementation(() => {
    const error = new Error('InvalidStateError');
    error.name = 'InvalidStateError';
    throw error;
  });

  try {
    // Would hang/reject forever if the retry kept reusing db1's broken transaction().
    await tx('cache', 'readwrite', s => s.put({ recovered: true }, 'recovery-test'));
    expect(spy).toHaveBeenCalledTimes(1);

    const db2 = await openQuickKeeDb();
    expect(db2).not.toBe(db1);

    const result = await tx<{ recovered: boolean }>('cache', 'readonly', s => s.get('recovery-test'));
    expect(result.recovered).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test('onversionchange handler closes the connection and resets the memoized promise', async () => {
  // fake-indexeddb doesn't reliably fire a real cross-connection versionchange event in this
  // single-process test environment, so we invoke the handler our own code installed directly
  // (captured from the real db.onversionchange property, not a re-implementation) and verify
  // its real effects: the connection is closed, and the next open gets a genuinely new one.
  const db = await openQuickKeeDb();
  const closeSpy = vi.spyOn(db, 'close');
  expect(db.onversionchange).toBeTruthy();

  db.onversionchange!(new Event('versionchange') as IDBVersionChangeEvent);

  expect(closeSpy).toHaveBeenCalledTimes(1);
  const db2 = await openQuickKeeDb();
  expect(db2).not.toBe(db);
});
