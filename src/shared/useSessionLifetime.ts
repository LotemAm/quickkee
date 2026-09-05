import { useCallback, useLayoutEffect, useRef } from 'react';

/** Capture once at the start of an async action; check before every continuation.
 * Each effect setup gets a distinct token so StrictMode cannot revive old work. */
export function useSessionLifetime(): () => () => boolean {
  const current = useRef({ active: false });
  useLayoutEffect(() => {
    const lifetime = { active: true };
    current.current = lifetime;
    return () => { lifetime.active = false; };
  }, []);
  return useCallback(() => {
    const lifetime = current.current;
    return () => lifetime.active;
  }, []);
}
