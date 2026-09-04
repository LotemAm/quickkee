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

test('tx rejects an abort after request success without retrying or committing the write', async () => {
  const write = vi.fn((store: IDBObjectStore) => {
    const transaction = store.transaction;
    const request = store.put({ v: 2 }, 'aborted-write');
    request.addEventListener('success', () => transaction.abort());
    return request;
  });

  const result = await tx('cache', 'readwrite', write).then(
    value => ({ value, error: null }),
    error => ({ value: undefined, error }),
  );
  const stored = await tx('cache', 'readonly', store => store.get('aborted-write'));

  expect(stored).toBeUndefined();
  expect(write).toHaveBeenCalledTimes(1);
  expect(result.error).toMatchObject({ name: 'AbortError' });
});

test('tx returns the request result only after the write transaction completes', async () => {
  const events: string[] = [];
  const result = await tx('cache', 'readwrite', store => {
    store.transaction.addEventListener('complete', () => events.push('complete'));
    const request = store.put({ v: 3 }, 'completed-write');
    request.addEventListener('success', () => events.push('success'));
    return request;
  });
  events.push('resolved');

  expect(result).toBe('completed-write');
  expect(events).toEqual(['success', 'complete', 'resolved']);
});

test.each([
  ['readonly-existing', { v: 4 }],
  ['readonly-missing', undefined],
] as const)('tx returns %s only after readonly completion', async (key, expected) => {
  if (expected !== undefined) await tx('cache', 'readwrite', store => store.put(expected, key));
  let completed = false;

  const result = await tx<{ v: number } | undefined>('cache', 'readonly', store => {
    store.transaction.addEventListener('complete', () => { completed = true; });
    return store.get(key);
  });

  expect(result).toEqual(expected);
  expect(completed).toBe(true);
});

test('tx preserves a failed request error and the previously committed value', async () => {
  await tx('cache', 'readwrite', store => store.put({ v: 5 }, 'duplicate-key'));
  let requestError: DOMException | null = null;

  const result = await tx('cache', 'readwrite', store => {
    const request = store.add({ v: 6 }, 'duplicate-key');
    request.addEventListener('error', () => { requestError = request.error; });
    return request;
  }).catch(error => error);

  expect(requestError).toMatchObject({ name: 'ConstraintError' });
  expect(result).toBe(requestError);
  expect(await tx('cache', 'readonly', store => store.get('duplicate-key'))).toEqual({ v: 5 });
});

test('tx preserves a later request error when the returned request succeeded', async () => {
  let requestError: DOMException | null = null;
  const write = vi.fn((store: IDBObjectStore) => {
    const request = store.put({ v: 7 }, 'secondary-request-failure');
    const duplicate = store.add({ v: 8 }, 'secondary-request-failure');
    duplicate.addEventListener('error', () => { requestError = duplicate.error; });
    return request;
  });

  const result = await tx('cache', 'readwrite', write).catch(error => error);

  expect(requestError).toMatchObject({ name: 'ConstraintError' });
  expect(result).toBe(requestError);
  expect(write).toHaveBeenCalledTimes(1);
  expect(await tx('cache', 'readonly', store => store.get('secondary-request-failure'))).toBeUndefined();
});

test('tx does not retry an InvalidStateError thrown after the operation starts', async () => {
  const error = new DOMException('operation failed', 'InvalidStateError');
  const write = vi.fn((store: IDBObjectStore) => {
    store.put({ v: 9 }, 'operation-error');
    store.transaction.abort();
    throw error;
  });

  await expect(tx('cache', 'readwrite', write)).rejects.toBe(error);
  expect(write).toHaveBeenCalledTimes(1);
  expect(await tx('cache', 'readonly', store => store.get('operation-error'))).toBeUndefined();
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
