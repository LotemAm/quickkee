import { useEffect, useState } from 'react';
import { ShieldCheck, Search, Settings, Cloud, CloudOff, RefreshCw, PanelRight, Lock } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { lockVault } from '../../shared/lockVault';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import { DEFAULT_PWGEN, type PwGenOpts } from '../../shared/pwgen';
import type { EntryView, TreeNode } from '../../shared/entry';
import { EntryCard } from './EntryCard';
import { CreateForm } from './CreateForm';

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

function flattenGroups(node: TreeNode, depth = 0, acc: { groupId: string; name: string; depth: number }[] = []) {
  acc.push({ groupId: node.groupId, name: node.name, depth });
  for (const c of node.children) flattenGroups(c, depth + 1, acc);
  return acc;
}

export function Popup() {
  const { locked, dirty, refresh } = useStatus();
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [searchResults, setSearchResults] = useState<EntryView[]>([]);
  const [q, setQ] = useState(''); const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  const [rootGroup, setRootGroup] = useState(''); const [clearSecs, setClearSecs] = useState(30);
  const [pwgen, setPwgen] = useState<PwGenOpts>(DEFAULT_PWGEN);
  const [sync, setSync] = useState<{ source: string | null; pendingUpload: boolean; online: boolean } | null>(null);

  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); setPwgen(s.pwgen); }); }, []);
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
    sendToSW({ type: 'getTree' }).then(r => { if ('tree' in r) { setTree(r.tree); setRootGroup(r.tree.groupId); } });
  }, [locked, tab]);
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
        setSearchResults(rs.flatMap(r => ('entry' in r && r.entry) ? [r.entry] : []));
      });
    return () => { ignore = true; };
  }, [q, tree]);
  useEffect(() => {
    if (locked) return;
    const tick = () => sendToSW({ type: 'getSyncStatus' }).then(r => 'pendingUpload' in r && setSync(r));
    void tick();
    const iv = setInterval(tick, 4000);
    return () => clearInterval(iv);
  }, [locked]);

  if (locked) return <UnlockScreen onUnlocked={refresh} />;
  const searching = q.trim().length > 0;
  const shown = searching ? searchResults : entries;
  const groupNames = tree ? buildGroupNames(tree) : new Map<string, string>();
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
          <button className="icon-btn" aria-label="Lock database" title="Lock database" onClick={() => lockVault(dirty).then(refresh)}>
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
      <div className="p-3">
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input className="input pl-9" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} clearSecs={clearSecs} groupName={groupNames.get(e.id)} />)}
        {searching && shown.length === 0 &&
          <div className="empty-state mt-6">No entries match your search.</div>}
        {!searching && entries.length === 0 && tab && rootGroup && tree &&
          <CreateForm url={tab.url} tabId={tab.id} groups={flattenGroups(tree)} defaultGroupId={rootGroup}
            clearSecs={clearSecs} pwgen={pwgen} onCreated={() =>
            sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries))} />}
      </div>
    </div>
  );
}