import { useState, useEffect } from 'react';
import { ShieldCheck, FileKey, KeyRound, Lock, HardDrive, Box, Cloud } from 'lucide-react';
import { sendToSW } from './messages';
import { pickAndStoreDb, readKeyFile } from './pickFile';
import { loadHandle, ensurePermission } from '../background/fileHandle';
import { CloudConnect } from './CloudConnect';
import type { RemoteFile } from '../background/sources/cloudProvider';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [src, setSrc] = useState<'local' | 'dropbox' | 'gdrive'>('local');
  const [picked, setPicked] = useState<RemoteFile | null>(null);
  const [dbName, setDbName] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [keyFile, setKeyFile] = useState<number[] | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { void loadHandle().then(h => setDbName(h?.name ?? null)); }, []);

  const canUnlock = src !== 'local'
    ? (picked !== null) && ((pwd.length > 0) || (useKey && keyFile))
    : (pwd.length > 0) || (useKey && keyFile);
  async function unlock() {
    setErr('');
    if (src === 'local') {
      const h = await loadHandle();
      if (!h) { setErr('Pick a database file first'); return; }
      if (!(await ensurePermission(h, 'readwrite'))) { setErr('Grant file access to continue'); return; }
      const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: useKey ? keyFile : null });
      if (r.ok) onUnlocked();
      else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
        noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
    } else {
      const r = await sendToSW({ type: 'openRemote', provider: src, fileId: picked!.fileId, fileName: picked!.name, password: pwd || null, keyFile: useKey ? keyFile : null });
      if (r.ok) onUnlocked();
      else setErr(r.ok === false && r.error === 'badCredentials' ? 'Wrong password or key file.' : 'Could not open the database.');
    }
  }

  return (
    <div className="p-4">
      <div className="card space-y-3">
        <div className="app-title justify-center text-base">
          <ShieldCheck size={20} className="app-logo" /> QuickKee
        </div>
        <div className="source-picker" role="tablist">
          <button role="tab" aria-selected={src === 'local'} onClick={() => { setSrc('local'); setPicked(null); }}>
            <HardDrive size={17} /> Local file
          </button>
          <button role="tab" aria-selected={src === 'dropbox'} onClick={() => { setSrc('dropbox'); setPicked(null); }}>
            <Box size={17} /> Dropbox
          </button>
          <button role="tab" aria-selected={src === 'gdrive'} onClick={() => { setSrc('gdrive'); setPicked(null); }}>
            <Cloud size={17} /> Google Drive
          </button>
        </div>
        {src === 'local' && (
          <button className="btn w-full" onClick={async () => { try { setDbName(await pickAndStoreDb()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
            <FileKey size={15} /> {dbName ? `Database: ${dbName}` : 'Open .kdbx file…'}
          </button>
        )}
        {src !== 'local' && !picked && (
          <CloudConnect provider={src} onPicked={setPicked} />
        )}
        {src !== 'local' && picked && (
          <div className="picked-file">
            <FileKey size={15} />
            <span className="picked-name">{picked.name}</span>
            <button className="link-btn" onClick={() => setPicked(null)}>Change</button>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={useKey} onChange={e => setUseKey(e.target.checked)} /> Use key file
        </label>
        {useKey && <button className="btn w-full" onClick={async () => { try { setKeyFile(await readKeyFile()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
          <KeyRound size={15} /> {keyFile ? 'Key file selected' : 'Choose key file…'}</button>}
        <input type="password" className="input" placeholder="Master password" value={pwd}
          onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && unlock()} />
        {err && <p className="alert-error">{err}</p>}
        <button className="btn-primary w-full" disabled={!canUnlock || (src === 'local' && !dbName)} onClick={unlock}>
          <Lock size={15} /> Unlock
        </button>
      </div>
    </div>
  );
}
