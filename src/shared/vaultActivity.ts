import { sendToSW } from './messages';

/** Call only from trusted input or the inline picker's protected selection callback. */
export async function recordVaultActivity(): Promise<void> {
  try { await sendToSW({ type: 'vaultActivity' }); }
  catch { /* Closing an extension surface must not leave an unhandled rejection. */ }
}

/** One leading signal per second; no timer can extend activity after input stops. */
export function createVaultActivityListener(
  record: () => void = recordVaultActivity,
  now: () => number = () => performance.now(),
): (event: Pick<Event, 'type' | 'isTrusted'>) => void {
  let lastActivity = -Infinity;
  return event => {
    if (!event.isTrusted || (event.type !== 'pointerdown' && event.type !== 'keydown')) return;
    const time = now();
    if (time - lastActivity < 1000) return;
    lastActivity = time;
    record();
  };
}
