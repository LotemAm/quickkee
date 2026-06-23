import { useEffect, useState } from 'react';
import { ShieldCheck, Search, Settings, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { EntryView } from '../../shared/entry';
import { EntryCard } from './EntryCard';
import { CreateForm } from './CreateForm';

export function Popup() {
  const { locked, refresh } = useStatus();
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [q, setQ] = useState(''); const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  const [rootGroup, setRootGroup] = useState(''); const [clearSecs, setClearSecs] = useState(30);
  const [sync, setSync] = useState<{ source: string | null; pendingUpload: boolean; online: boolean } | null>(null);

  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (import.meta.env.VITE_QK_TEST === '1' && p.get('qkurl')) {
      setTab({ id: Number(p.get('qktab')), url: p.get('qkurl')! });
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([t]) => t?.id && t.url && setTab({ id: t.id, url: t.url }));
  }, []);
  useEffect(() => { if (locked || !tab) return;
    sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries));
    sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setRootGroup(r.tree.groupId));
  }, [locked, tab]);
  useEffect(() => {
    if (locked) return;
    const tick = () => sendToSW({ type: 'getSyncStatus' }).then(r => 'pendingUpload' in r && setSync(r));
    void tick();
    const iv = setInterval(tick, 4000);
    return () => clearInterval(iv);
  }, [locked]);

  if (locked) return <UnlockScreen onUnlocked={refresh} />;
  const shown = entries.filter(e => (e.title + e.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <header className="app-header">
        <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee</span>
        <div className="flex items-center gap-1">
          {sync?.source === 'cloud' && (
            <span className="sync-badge" title={
              !sync.online ? 'Offline — changes will sync later'
                : sync.pendingUpload ? 'Pending upload' : 'Synced'
            }>
              {!sync.online ? <CloudOff size={15} /> : sync.pendingUpload ? <RefreshCw size={15} /> : <Cloud size={15} />}
            </span>
          )}
          <button className="icon-btn" aria-label="Open settings" onClick={() => chrome.runtime.openOptionsPage()}>
            <Settings size={16} />
          </button>
        </div>
      </header>
      <div className="p-3">
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input className="input pl-9" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} clearSecs={clearSecs} />)}
        {entries.length === 0 && tab && rootGroup &&
          <CreateForm url={tab.url} groupId={rootGroup} onCreated={() =>
            sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries))} />}
      </div>
    </div>
  );
}