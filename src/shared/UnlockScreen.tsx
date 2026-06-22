import { useState, useEffect } from 'react';
import { sendToSW } from './messages';
import { pickAndStoreDb, readKeyFile } from './pickFile';
import { loadHandle, ensurePermission } from '../background/fileHandle';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [dbName, setDbName] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [keyFile, setKeyFile] = useState<number[] | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { void loadHandle().then(h => setDbName(h?.name ?? null)); }, []);

  const canUnlock = (pwd.length > 0) || (useKey && keyFile);
  async function unlock() {
    setErr('');
    // Ensure file permission in the page (this click is a user gesture) before
    // asking the SW to open — the SW cannot show the permission prompt itself.
    const h = await loadHandle();
    if (!h) { setErr('Pick a database file first'); return; }
    if (!(await ensurePermission(h, 'readwrite'))) { setErr('Grant file access to continue'); return; }
    const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: useKey ? keyFile : null });
    if (r.ok) onUnlocked();
    else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
      noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
  }
  return (
    <div className="p-4 space-y-3">
      <button className="btn" onClick={async () => { try { setDbName(await pickAndStoreDb()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
        {dbName ? `Database: ${dbName}` : 'Open .kdbx file…'}
      </button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={useKey} onChange={e => setUseKey(e.target.checked)} /> Use key file
      </label>
      {useKey && <button className="btn" onClick={async () => { try { setKeyFile(await readKeyFile()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
        {keyFile ? 'Key file selected' : 'Choose key file…'}</button>}
      <input type="password" className="input" placeholder="Master password" value={pwd}
        onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && unlock()} />
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <button className="btn-primary" disabled={!canUnlock || !dbName} onClick={unlock}>Unlock</button>
    </div>
  );
}
