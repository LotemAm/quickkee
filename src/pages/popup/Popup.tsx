import { useCallback, useEffect, useState } from 'react';
import { Search, Settings, Cloud, CloudOff, RefreshCw, PanelRight, Lock, Plus, X } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { useSessionLifetime } from '../../shared/useSessionLifetime';
import { useVaultActivity } from '../../shared/useVaultActivity';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { lockVault } from '../../shared/lockVault';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import { DEFAULT_PWGEN, type PwGenOpts } from '../../shared/pwgen';
import type { EntryView, TreeNode } from '../../shared/entry';
import { EntryCard } from './EntryCard';
import { CreateForm } from './CreateForm';
import { useClipboardTimer } from '../../shared/useClipboardTimer';
import { ClipboardBar } from '../../shared/ClipboardBar';
import { loadDraft } from '../../shared/createDraft';
import { isScannablePageUrl, scanVisibleTabForTotp, UNSUPPORTED_PAGE_MESSAGE, type ScannedPageTotp } from './scanVisibleTabForTotp';
import { ScannedTotpDialog } from './ScannedTotpDialog';
import { saveScannedTotp, type ScannedTotpDestination } from './saveScannedTotp';
import { flattenGroups } from '../../shared/groups';

function collectEntries(node: TreeNode, acc: { id: string; title: string; username: string; url: string }[] = []) {
  for (const e of node.entries) acc.push(e);
  for (const c of node.children) collectEntries(c, acc);
  return acc;
}

function buildGroupNames(node: TreeNode, map: Map<string, string> = new Map()) {
  for (const e of node.entries) map.set(e.id, node.name);
  for (const c of node.children) buildGroupNames(c, map);
  return map;
}

export function Popup() {
  const { locked, dirty, refresh, sessionKey } = useStatus();
  useVaultActivity(!locked);
  const [unlockNotice, setUnlockNotice] = useState('');
  useEffect(() => { void loadSettings().then(s => applyTheme(s.theme)); }, []);
  if (locked || !sessionKey) return <UnlockScreen onUnlocked={notice => {
    setUnlockNotice(notice ?? '');
    void refresh();
  }} />;
  return <UnlockedPopup key={sessionKey} sessionKey={sessionKey} dirty={dirty} refresh={refresh} unlockNotice={unlockNotice} />;
}

function UnlockedPopup({ dirty, refresh, unlockNotice, sessionKey }: {
  sessionKey: string; dirty: boolean; refresh: () => Promise<void>; unlockNotice: string;
}) {
  const captureLifetime = useSessionLifetime();
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [searchResults, setSearchResults] = useState<EntryView[]>([]);
  const [q, setQ] = useState(''); const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  const [rootGroup, setRootGroup] = useState(''); const [clearSecs, setClearSecs] = useState(30);
  const [pwgen, setPwgen] = useState<PwGenOpts>(DEFAULT_PWGEN);
  const [sync, setSync] = useState<{ source: string | null; pendingUpload: boolean; online: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanned, setScanned] = useState<ScannedPageTotp | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const reloadVaultData = useCallback(async (url: string): Promise<boolean> => {
    const isAlive = captureLifetime();
    if (!isAlive()) return false;
    const [entryResult, treeResult] = await Promise.all([
      sendToSW({ type: 'getEntriesForUrl', url }),
      sendToSW({ type: 'getTree' }),
    ]);
    if (!isAlive()) return false;
    if (entryResult.ok) setEntries(entryResult.entries);
    if (treeResult.ok) {
      setTree(treeResult.tree);
      setRootGroup(treeResult.tree.groupId);
    }
    return entryResult.ok && treeResult.ok;
  }, [captureLifetime]);

  useEffect(() => {
    const isAlive = captureLifetime();
    void loadSettings().then(s => { if (isAlive()) { setClearSecs(s.clipboardClearSeconds); setPwgen(s.pwgen); } });
  }, [captureLifetime]);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (import.meta.env.VITE_QK_TEST === '1') {
      if (p.get('qkurl')) {
        setTab({ id: Number(p.get('qktab')), url: p.get('qkurl')! });
      } else {
        void chrome.tabs.query({ active: true, currentWindow: true })
          .then(([current]) => setTab(current?.id != null && current.url ? { id: current.id, url: current.url } : null));
      }
      return;
    }
    const loadCurrentTab = () => chrome.tabs.query({ active: true, currentWindow: true })
      .then(([current]) => setTab(current?.id != null && current.url ? { id: current.id, url: current.url } : null));
    void loadCurrentTab();
    const onActivated = () => { void loadCurrentTab(); };
    const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_tabId, change, updated) => {
      if (updated.active && (change.url || change.status === 'complete')) void loadCurrentTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  useEffect(() => { if (!tab) return;
    const isAlive = captureLifetime();
    setCreating(false);
    void reloadVaultData(tab.url);
    loadDraft(tab.url).then(d => isAlive() && d && setCreating(true));
  }, [tab, reloadVaultData, captureLifetime]);
  useEffect(() => {
    setScanned(current => current && (current.tabId !== tab?.id || current.pageUrl !== tab?.url) ? null : current);
  }, [tab?.id, tab?.url]);
  useEffect(() => {
    const query = q.trim().toLowerCase();
    if (!query || !tree) { setSearchResults([]); return; }
    let ignore = false;
    const ids = collectEntries(tree)
      .filter(e => `${e.title} ${e.username} ${e.url}`.toLowerCase().includes(query))
      .map(e => e.id);
    Promise.all(ids.map(id => sendToSW({ type: 'getEntry', entryId: id })))
      .then(rs => {
        if (ignore) return;
        setSearchResults(rs.flatMap(r => (r.ok && r.entry) ? [r.entry] : []));
      });
    return () => { ignore = true; };
  }, [q, tree]);
  useEffect(() => {
    const isAlive = captureLifetime();
    const tick = () => sendToSW({ type: 'getSyncStatus' }).then(r => isAlive() && r.ok && setSync(r));
    void tick();
    const iv = setInterval(tick, 4000);
    return () => clearInterval(iv);
  }, [captureLifetime]);

  const { copy, state: clipState, cancel } = useClipboardTimer(clearSecs);

  async function scanPage() {
    const isAlive = captureLifetime();
    if (scanning) return;
    setScanning(true);
    setScanError('');
    setNotice(null);
    setScanned(null);
    try {
      const result = await scanVisibleTabForTotp();
      if (!isAlive()) return;
      const loaded = await reloadVaultData(result.pageUrl);
      if (!isAlive()) return;
      if (!loaded) throw new Error('Could not load vault entries for this page.');
      setTab({ id: result.tabId, url: result.pageUrl });
      setCreating(false);
      setScanned(result);
    } catch (error) {
      if (!isAlive()) return;
      setScanError(error instanceof Error ? error.message : 'Could not scan the visible page. Try again.');
    } finally {
      if (isAlive()) setScanning(false);
    }
  }

  async function confirmScanned(destination: ScannedTotpDestination): Promise<string | null> {
    const isAlive = captureLifetime();
    if (!scanned) return 'The scanned code is no longer available. Scan the page again.';
    const result = await saveScannedTotp(scanned.config, destination, request => {
      if (!isAlive()) return Promise.resolve({ ok: false, error: 'staleSession' });
      return sendToSW(request);
    });
    if (!isAlive()) return null;
    if (result.status === 'failed') return 'Could not add the authenticator code. The vault was not changed.';

    setScanned(null);
    await Promise.allSettled([reloadVaultData(scanned.pageUrl), refresh()]);
    if (!isAlive()) return null;
    if (result.status === 'saved') {
      setNotice({ kind: 'success', message: 'Authenticator code saved.' });
    } else if (result.status === 'unsaved') {
      setNotice({
        kind: 'error',
        message: 'Authenticator code was added in memory, but saving failed. The vault still has unsaved changes.',
      });
    } else {
      setNotice({
        kind: 'error',
        message: 'Could not confirm whether the authenticator code was added. Check the vault before retrying.',
      });
    }
    return null;
  }

  const searching = q.trim().length > 0;
  const shown = searching ? searchResults : entries;
  const groupNames = tree ? buildGroupNames(tree) : new Map<string, string>();
  const scanPageControl = {
    disabled: !isScannablePageUrl(tab?.url),
    scanning,
    description: isScannablePageUrl(tab?.url) ? 'Scan the visible tab locally.' : UNSUPPORTED_PAGE_MESSAGE,
    onClick: () => { void scanPage(); },
  };
  return (
    <div>
      <header className="app-header">
        <span className="app-title"><img src={chrome.runtime.getURL('icon-32.png')} alt="" className="app-logo" width={18} height={18} /> QuickKee</span>
        <div className="flex items-center gap-1">
          {sync?.source === 'cloud' && (
            <span className="sync-badge" title={
              !sync.online ? 'Offline — changes will sync later'
                : sync.pendingUpload ? 'Pending upload' : 'Synced'
            }>
              {!sync.online ? <CloudOff size={15} /> : sync.pendingUpload ? <RefreshCw size={15} /> : <Cloud size={15} />}
            </span>
          )}
          <button className="icon-btn" aria-label="Lock database" title="Lock database" onClick={() => {
            const isAlive = captureLifetime();
            void lockVault(dirty).then(() => { if (isAlive()) void refresh(); });
          }}>
            <Lock size={16} />
          </button>
          <button className="icon-btn" aria-label="Open side panel" title="Open side panel" onClick={() => tab && chrome.sidePanel.open({ tabId: tab.id })}>
            <PanelRight size={16} />
          </button>
          <button className="icon-btn" aria-label="Open settings" title="Open settings" onClick={() => chrome.runtime.openOptionsPage()}>
            <Settings size={16} />
          </button>
        </div>
      </header>
      {clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
      {unlockNotice && <p role="status" className="mx-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{unlockNotice}</p>}
      <div className="p-3">
        {scanError && <p className="alert-error mb-2" role="alert">{scanError}</p>}
        {notice && <p className={notice.kind === 'error' ? 'alert-error mb-2' : 'card mb-2 text-sm'}
          role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
        {creating && tab && rootGroup && tree ? (
          <>
            <button className="btn-secondary mb-2" onClick={() => setCreating(false)}>
              <X size={15} /> Cancel
            </button>
            <CreateForm key={tab.url} sessionKey={sessionKey} url={tab.url} tabId={tab.id} groups={flattenGroups(tree)} defaultGroupId={rootGroup}
              clearSecs={clearSecs} pwgen={pwgen} scanPage={scanPageControl} onCreated={() => {
                setCreating(false);
                void reloadVaultData(tab.url);
              }} />
          </>
        ) : (
          <>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input className="input pl-9" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} onCopy={copy} groupName={groupNames.get(e.id)} />)}
            {searching && shown.length === 0 &&
              <div className="empty-state mt-6">No entries match your search.</div>}
            {!searching && entries.length === 0 && tab && rootGroup && tree &&
              <CreateForm key={tab.url} sessionKey={sessionKey} url={tab.url} tabId={tab.id} groups={flattenGroups(tree)} defaultGroupId={rootGroup}
                clearSecs={clearSecs} pwgen={pwgen} scanPage={scanPageControl} onCreated={() =>
                void reloadVaultData(tab.url)} />}
            {!searching && entries.length > 0 && tab && rootGroup && tree && (
              <button className="btn-secondary w-full mt-2" onClick={() => setCreating(true)}>
                <Plus size={15} /> Add entry
              </button>
            )}
          </>
        )}
      </div>
      {scanned && tree && rootGroup && (
        <ScannedTotpDialog config={scanned.config} pageUrl={scanned.pageUrl} entries={entries}
          groups={flattenGroups(tree)} defaultGroupId={rootGroup}
          onCancel={() => setScanned(null)} onConfirm={confirmScanned} />
      )}
    </div>
  );
}
