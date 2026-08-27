import { useState, useEffect } from 'react';
import { ShieldCheck, FileKey, KeyRound, Lock, HardDrive, Box, Cloud, Loader2 } from 'lucide-react';
import { sendToSW } from './messages';
import { pickAndStoreDb, pickKeyFile, readStoredKeyBytes } from './pickFile';
import { loadHandle, ensurePermission, loadKeyHandle, clearKeyHandle, loadLastCloud, saveLastCloud, clearLastCloud } from '../background/fileHandle';
import { CloudConnect } from './CloudConnect';
import type { RemoteFile } from '../background/sources/cloudProvider';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [src, setSrc] = useState<'local' | 'dropbox' | 'gdrive'>('local');
  const [picked, setPicked] = useState<RemoteFile | null>(null);
  const [dbName, setDbName] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [cloudErr, setCloudErr] = useState(false); // open failed for a non-credential reason (likely auth)
  const [unlocking, setUnlocking] = useState(false);
  useEffect(() => { void loadHandle().then(h => setDbName(h?.name ?? null)); }, []);
  // Auto-select the last loaded cloud database, if any.
  useEffect(() => {
    void loadLastCloud().then(c => {
      if (!c) return;
      setSrc(c.provider);
      setPicked({ fileId: c.fileId, name: c.fileName, rev: '' });
    });
  }, []);
  // Auto-select a previously used key file (handle reference only; bytes read at unlock).
  useEffect(() => {
    void loadKeyHandle().then(h => { if (h) { setUseKey(true); setKeyName(h.name); } });
  }, []);

  const canUnlock = src !== 'local'
    ? (picked !== null) && ((pwd.length > 0) || (useKey && !!keyName))
    : (pwd.length > 0) || (useKey && !!keyName);
  async function unlock() {
    setErr(''); setCloudErr(false); setUnlocking(true);
    try {
      let keyBytes: number[] | null = null;
      if (useKey) {
        keyBytes = await readStoredKeyBytes();
        if (!keyBytes) { setErr('Re-select the key file'); return; }
      }
      if (src === 'local') {
        const h = await loadHandle();
        if (!h) { setErr('Pick a database file first'); return; }
        if (!(await ensurePermission(h, 'readwrite'))) { setErr('Grant file access to continue'); return; }
        const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: keyBytes });
        if (r.ok) { await clearLastCloud(); onUnlocked(); }
        else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
          noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
      } else {
        const r = await sendToSW({ type: 'openRemote', provider: src, fileId: picked!.fileId, fileName: picked!.name, password: pwd || null, keyFile: keyBytes });
        if (r.ok) { await saveLastCloud({ provider: src, fileId: picked!.fileId, fileName: picked!.name }); onUnlocked(); }
        else if (r.ok === false && r.error === 'badCredentials') setErr('Wrong password or key file.');
        else { setErr('Could not open the database — your account may need to reconnect.'); setCloudErr(true); }
      }
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="p-4">
      <div className="card space-y-3">
        <div className="app-title justify-center text-base">
          <ShieldCheck size={20} className="app-logo" /> QuickKee
        </div>
        <div className="source-picker" role="tablist">
          <button role="tab" aria-selected={src === 'local'} onClick={() => { setSrc('local'); setPicked(null); setCloudErr(false); setErr(''); }}>
            <HardDrive size={17} /> Local file
          </button>
          <button role="tab" aria-selected={src === 'dropbox'} onClick={() => { setSrc('dropbox'); setPicked(null); setCloudErr(false); setErr(''); }}>
            <Box size={17} /> Dropbox
          </button>
          <button role="tab" aria-selected={src === 'gdrive'} onClick={() => { setSrc('gdrive'); setPicked(null); setCloudErr(false); setErr(''); }}>
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
          <input type="checkbox" checked={useKey} onChange={e => {
            setUseKey(e.target.checked);
            if (!e.target.checked) { setKeyName(null); void clearKeyHandle(); }
          }} /> Use key file
        </label>
        {useKey && <button className="btn w-full" onClick={async () => { try { setKeyName(await pickKeyFile()); } catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; } }}>
          <KeyRound size={15} /> {keyName ? `Key file: ${keyName}` : 'Choose key file…'}</button>}
        <input type="password" className="input" placeholder="Master password" value={pwd} autoFocus
          onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && !unlocking && unlock()} />
        {err && <p className="alert-error">{err}</p>}
        {cloudErr && src !== 'local' && (
          <button className="btn w-full" onClick={() => { setPicked(null); setCloudErr(false); setErr(''); }}>
            <Cloud size={15} /> Reconnect account
          </button>
        )}
        <button className="btn-primary w-full" disabled={!canUnlock || unlocking || (src === 'local' && !dbName)} onClick={unlock}>
          {unlocking
            ? <><Loader2 size={15} className="animate-spin" /> Unlocking</>
            : <><Lock size={15} /> Unlock</>}
        </button>
      </div>
    </div>
  );
}
