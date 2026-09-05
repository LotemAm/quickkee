// @vitest-environment node
import { Vault } from './vault';
import { queueCloud } from './syncQueue';

test('one Vault runs FIFO through asynchronous work, independent Vaults proceed', async () => {
  const vault = new Vault(); const other = new Vault();
  const gate = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>();
  const order: string[] = [];
  const first = queueCloud(vault, async () => {
    order.push('first'); started.resolve(); await gate.promise; order.push('done');
  });
  const second = queueCloud(vault, async () => { order.push('second'); return 2; });
  try {
    await started.promise;
    await queueCloud(other, async () => { order.push('other'); });
    expect(order).toEqual(['first', 'other']);
    gate.resolve(); expect(await second).toBe(2);
    expect(order).toEqual(['first', 'other', 'done', 'second']);
  } finally { gate.resolve(); await Promise.allSettled([first, second]); }
});

test('both synchronous throws and rejected work release the tail for recovery', async () => {
  const vault = new Vault();
  const first = queueCloud(vault, () => { throw new Error('first'); });
  const second = queueCloud(vault, async () => { throw new Error('second'); });
  const recovered = queueCloud(vault, async () => 3);
  const failures = await Promise.allSettled([first, second]);
  expect(failures.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(await recovered).toBe(3);
  expect(await queueCloud(vault, async () => 4)).toBe(4);
});
