import type { Vault } from './vault';

const tails = new WeakMap<Vault, Promise<void>>();

/** Queue whole cloud operations; callers must use unqueued helpers for nested work. */
export function queueCloud<T>(vault: Vault, work: () => Promise<T>): Promise<T> {
  const result = (tails.get(vault) ?? Promise.resolve()).then(work);
  const tail = result.then(() => {}, () => {});
  tails.set(vault, tail);
  void tail.then(() => { if (tails.get(vault) === tail) tails.delete(vault); });
  return result;
}
