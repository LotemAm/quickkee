import { useState, useEffect } from 'react';
import { ShieldCheck, FileKey, KeyRound, Lock } from 'lucide-react';
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
    const h = await loadHandle();
    if (!h) { setErr('Pick a database file first'); return; }
    if (!(await ensurePermission(h, 'readwrite'))) { setErr('Grant file access to continue'); return; }
    const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: useKey ? keyFile : null });
    if (r.ok) onUnlocked();
    else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
      noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
  }

  return (
    <div className="p-4">
      <div className="card space-y-3">
        <div className="app-title justify-center text-base">
          <ShieldCheck size={20} className="app-logo" /> QuickKee
        </div>
        <button className="btn w-full" onClick={async () => { try { setDbName(await pickAndStoreDb()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
          <FileKey size={15} /> {dbName ? `Database: ${dbName}` : 'Open .kdbx file…'}
        </button>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={useKey} onChange={e => setUseKey(e.target.checked)} /> Use key file
        </label>
        {useKey && <button className="btn w-full" onClick={async () => { try { setKeyFile(await readKeyFile()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
          <KeyRound size={15} /> {keyFile ? 'Key file selected' : 'Choose key file…'}</button>}
        <input type="password" className="input" placeholder="Master password" value={pwd}
          onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && unlock()} />
        {err && <p className="alert-error">{err}</p>}
        <button className="btn-primary w-full" disabled={!canUnlock || !dbName} onClick={unlock}>
          <Lock size={15} /> Unlock
        </button>
      </div>
    </div>
  );
}
