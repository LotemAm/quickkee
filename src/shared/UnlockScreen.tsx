import { useState, useEffect } from 'react';
import { ShieldCheck, FileKey, KeyRound, Lock, HardDrive, Box, Cloud, Loader2 } from 'lucide-react';
import { sendToSW } from './messages';
import { pickAndStoreDb, pickKeyFile, readStoredKeyBytes } from './pickFile';
import { loadHandle, ensurePermission, loadKeyHandle, clearKeyHandle, loadLastCloud, saveLastCloud, clearLastCloud } from '../background/fileHandle';
import { CloudConnect } from './CloudConnect';
import { IconTooltipButton } from './IconTooltipButton';
import type { RemoteFile } from '../background/sources/cloudProvider';
import {
  createDeviceCredential,
  DeviceQuickUnlockError,
  getDevicePrfOutput,
  isDeviceQuickUnlockAvailable,
} from './deviceQuickUnlock';
import {
  quickUnlockSourceMatches,
  type QuickUnlockSource,
  type QuickUnlockSourceIdentity,
  type QuickUnlockStatus,
} from './quickUnlock';
import { quickUnlockInfo, quickUnlockWarn } from './quickUnlockDebug';

function deviceError(error: unknown): string {
  const code = error instanceof DeviceQuickUnlockError ? error.code
    : error instanceof DOMException ? error.name : 'failed';
  return ({
    cancelled: 'Device verification was cancelled. You can retry or unlock manually.',
    NotAllowedError: 'Device verification was cancelled. You can retry or unlock manually.',
    timedOut: 'Device verification timed out. You can retry or unlock manually.',
    authenticatorUnavailable: 'Device verification is unavailable. Unlock manually instead.',
    prfUnsupported: 'This device cannot securely support quick unlock. Unlock manually instead.',
    unknownCredential: 'The saved device credential is unavailable. Unlock manually, then replace or disable quick unlock.',
    invalidData: 'The saved quick-unlock data is invalid. Unlock manually, then disable quick unlock.',
    failed: 'Device verification failed. You can retry or unlock manually.',
  } as Record<string, string>)[code] ?? 'Device verification failed. You can retry or unlock manually.';
}

function quickUnlockError(code: string): string {
  return ({
    permissionRequired: 'Grant file access with manual unlock to continue.',
    authRequired: 'Reconnect the enrolled cloud account or unlock manually.',
    offlineNoCache: 'This vault is not available offline. Reconnect or unlock manually.',
    staleCredentials: 'The stored unlock material no longer opens this vault. Unlock manually, then replace or disable quick unlock.',
    unknownCredential: 'The saved device credential is unavailable. Unlock manually, then replace or disable quick unlock.',
    corruptEnrollment: 'Quick-unlock data is damaged or was changed. Unlock manually, then disable quick unlock.',
    notEnrolled: 'Device quick unlock is no longer enrolled. Unlock manually.',
    sourceUnavailable: 'The enrolled vault could not be opened. Unlock it manually.',
  } as Record<string, string>)[code] ?? 'Quick unlock failed. Unlock manually or try again.';
}

export function UnlockScreen({ onUnlocked }: { onUnlocked: (notice?: string) => void }) {
  const [src, setSrc] = useState<'local' | 'dropbox' | 'gdrive'>('local');
  const [picked, setPicked] = useState<RemoteFile | null>(null);
  const [dbName, setDbName] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [cloudErr, setCloudErr] = useState(false); // open failed for a non-credential reason (likely auth)
  const [unlocking, setUnlocking] = useState(false);
  const [quickStatus, setQuickStatus] = useState<QuickUnlockStatus | null>(null);
  const [deviceAvailable, setDeviceAvailable] = useState(false);
  const [setupQuickUnlock, setSetupQuickUnlock] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickErr, setQuickErr] = useState('');
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
  useEffect(() => {
    void Promise.all([
      sendToSW({ type: 'getQuickUnlockStatus' }),
      isDeviceQuickUnlockAvailable(),
    ]).then(([status, available]) => {
      if (status.ok) setQuickStatus(status);
      setDeviceAvailable(available);
    });
  }, []);

  const canUnlock = src !== 'local'
    ? (picked !== null) && ((pwd.length > 0) || (useKey && !!keyName))
    : (pwd.length > 0) || (useKey && !!keyName);
  const selectedSource: QuickUnlockSourceIdentity | null = src === 'local'
    ? dbName ? { kind: 'local', label: dbName } : null
    : picked ? { kind: 'cloud', provider: src, fileId: picked.fileId } : null;
  const selectedHasQuickUnlock = quickStatus?.enrolled === true && !!quickStatus.source
    && quickUnlockSourceMatches(quickStatus.source, selectedSource);
  async function unlock() {
    setErr(''); setCloudErr(false); setUnlocking(true);
    let keyBytes: number[] | null = null;
    let unlockNotice: string | undefined;
    try {
      if (useKey) {
        keyBytes = await readStoredKeyBytes();
        if (!keyBytes) { setErr('Re-select the key file'); return; }
      }
      if (src === 'local') {
        const h = await loadHandle();
        if (!h) { setErr('Pick a database file first'); return; }
        if (!(await ensurePermission(h, 'readwrite'))) { setErr('Grant file access to continue'); return; }
        const r = await sendToSW({ type: 'unlock', password: pwd || null, keyFile: keyBytes });
        if (r.ok) await clearLastCloud();
        else setErr({ badCredentials: 'Wrong password or key file', permission: 'Grant file access to continue',
          noFile: 'Pick a database file first' }[r.error as string] ?? r.error);
        if (!r.ok) return;
      } else {
        const r = await sendToSW({ type: 'openRemote', provider: src, fileId: picked!.fileId, fileName: picked!.name, password: pwd || null, keyFile: keyBytes });
        if (r.ok) await saveLastCloud({ provider: src, fileId: picked!.fileId, fileName: picked!.name });
        else if (r.ok === false && r.error === 'badCredentials') setErr('Wrong password or key file.');
        else { setErr('Could not open the database — your account may need to reconnect.'); setCloudErr(true); }
        if (!r.ok) return;
      }

      if (setupQuickUnlock) {
        const source: QuickUnlockSource = src === 'local'
          ? { kind: 'local', label: dbName! }
          : { kind: 'cloud', provider: src, fileId: picked!.fileId, label: picked!.name };
        const replaceExisting = quickStatus?.enrolled === true;
        if (replaceExisting && !window.confirm(
          `Replace device quick unlock for “${quickStatus.source?.label ?? 'the enrolled vault'}” with “${source.label}”?`,
        )) {
          setPwd(''); onUnlocked(); return;
        }
        let proof: Awaited<ReturnType<typeof createDeviceCredential>> | null = null;
        try {
          quickUnlockInfo('ui.enrollment-started', {
            sourceKind: source.kind,
            hasPassword: pwd.length > 0,
            hasKeyFile: keyBytes !== null,
            replaceExisting,
          });
          proof = await createDeviceCredential();
          const enrolled = await sendToSW({
            type: 'enrollQuickUnlock',
            source,
            password: pwd || null,
            keyFile: keyBytes,
            credentialId: proof.credentialId,
            prfInput: proof.prfInput,
            prfOutput: Array.from(proof.prfOutput),
            replaceExisting,
          });
          if (!enrolled.ok) {
            quickUnlockWarn('ui.enrollment-rejected', undefined, { responseError: enrolled.error });
            unlockNotice = 'Your vault is open, but device quick unlock was not set up.';
            setQuickErr(unlockNotice);
          } else quickUnlockInfo('ui.enrollment-completed');
        } catch (error) {
          quickUnlockWarn('ui.enrollment-failed', error);
          unlockNotice = `Your vault is open, but quick unlock was not set up. ${deviceError(error)}`;
          setQuickErr(unlockNotice);
        } finally { proof?.prfOutput.fill(0); }
      }
      setPwd('');
      onUnlocked(unlockNotice);
    } finally {
      keyBytes?.fill(0);
      setUnlocking(false);
    }
  }

  async function unlockWithDevice() {
    if (!quickStatus?.enrolled || !quickStatus.credentialId || !quickStatus.prfInput || quickBusy) return;
    setQuickErr(''); setQuickBusy(true);
    let output: Uint8Array | null = null;
    try {
      output = await getDevicePrfOutput(quickStatus.credentialId, quickStatus.prfInput);
      const result = await sendToSW({
        type: 'quickUnlock',
        credentialId: quickStatus.credentialId,
        prfOutput: Array.from(output),
      });
      if (result.ok) onUnlocked();
      else setQuickErr(quickUnlockError(result.error));
    } catch (error) { setQuickErr(deviceError(error)); }
    finally { output?.fill(0); setQuickBusy(false); }
  }

  return (
    <div className="p-4">
      <div className="card space-y-3">
        <div className="app-title justify-center text-base">
          <ShieldCheck size={20} className="app-logo" /> QuickKee
        </div>
        {quickStatus?.enrolled && !deviceAvailable && (
          <p role="status" className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Device verification is unavailable here. Manual unlock remains available.
          </p>
        )}
        {quickStatus?.corrupt && (
          <p role="alert" className="alert-error">Quick-unlock data is damaged. Unlock manually, then disable it in Settings.</p>
        )}
        {quickErr && <p role="alert" className="alert-error">{quickErr}</p>}
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
        <div className="flex gap-2">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: the unlock screen focuses its primary input */}
          <input type="password" className="input min-w-0 flex-1" placeholder="Master password" value={pwd} autoFocus
            onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && canUnlock && !unlocking && unlock()} />
          <IconTooltipButton className="icon-btn btn-toggle"
            label="Set up device quick unlock after this unlock" aria-pressed={setupQuickUnlock}
            tooltipId="quick-unlock-tooltip" tooltipTitle="Quick unlock"
            tooltipDescription={deviceAvailable
              ? 'Stores an encrypted copy of your master password and/or key-file material on this device.'
              : 'Quick unlock is not supported by this browser or device.'}
            disabled={!deviceAvailable}
            onClick={() => setSetupQuickUnlock(enabled => !enabled)}>
            <ShieldCheck size={15} />
          </IconTooltipButton>
        </div>
        {err && <p className="alert-error">{err}</p>}
        {cloudErr && src !== 'local' && (
          <button className="btn w-full" onClick={() => { setPicked(null); setCloudErr(false); setErr(''); }}>
            <Cloud size={15} /> Reconnect account
          </button>
        )}
        <div className="flex gap-2">
          <button className="btn-primary min-w-0 flex-1"
            disabled={!canUnlock || unlocking || (src === 'local' && !dbName)} onClick={unlock}>
            {unlocking
              ? <><Loader2 size={15} className="animate-spin" /> Unlocking</>
              : <><Lock size={15} /> Unlock</>}
          </button>
          {selectedHasQuickUnlock && quickStatus.source && (
            <IconTooltipButton className="btn-quick-unlock" anchorClassName="quick-unlock-action"
              label={`Quick unlock “${quickStatus.source.label}” with device`}
              tooltipId="saved-quick-unlock-tooltip" tooltipTitle="Quick unlock"
              tooltipPlacement="top"
              tooltipDescription="Unlock this database with Windows Hello or your device verification."
              disabled={quickBusy || !deviceAvailable}
              onClick={() => { void unlockWithDevice(); }}>
              {quickBusy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              {quickBusy ? 'Unlocking' : 'Quick'}
            </IconTooltipButton>
          )}
        </div>
      </div>
    </div>
  );
}
