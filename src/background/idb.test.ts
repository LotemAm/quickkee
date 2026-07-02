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

test('versionchange recovery: tx retries on InvalidStateError from closed connection', async () => {
  // Get initial connection and set up a spy to simulate InvalidStateError on first transaction attempt
  const db = await openQuickKeeDb();
  const originalTransaction = db.transaction.bind(db);
  let callCount = 0;

  const spy = vi.spyOn(db, 'transaction').mockImplementation((storeNames: string | Iterable<string>, mode?: IDBTransactionMode, options?: IDBTransactionOptions) => {
    callCount++;
    // First call throws InvalidStateError to simulate closed connection
    if (callCount === 1) {
      const error = new Error('InvalidStateError');
      error.name = 'InvalidStateError';
      throw error;
    }
    // Subsequent calls succeed normally
    return originalTransaction(storeNames, mode, options);
  });

  try {
    // This should trigger the InvalidStateError on first try, then retry and succeed
    await tx('cache', 'readwrite', s => s.put({ recovered: true }, 'recovery-test'));
    const result = await tx<{ recovered: boolean }>('cache', 'readonly', s => s.get('recovery-test'));
    expect(result.recovered).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
