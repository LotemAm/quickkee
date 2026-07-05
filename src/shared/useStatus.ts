import { useEffect, useState, useCallback } from 'react';
import { sendToSW } from './messages';
export function useStatus() {
  const [s, setS] = useState({ locked: true, dbName: undefined as string | undefined, dirty: false });
  const refresh = useCallback(async () => {
    const r = await sendToSW({ type: 'getStatus' });
    if (r.ok) setS({ locked: r.locked, dbName: r.dbName, dirty: r.dirty });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { ...s, refresh };
}
