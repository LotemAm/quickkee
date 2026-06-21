import { useEffect, useState } from 'react';
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

  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  useEffect(() => { chrome.tabs.query({ active: true, currentWindow: true })
    .then(([t]) => t?.id && t.url && setTab({ id: t.id, url: t.url })); }, []);
  useEffect(() => { if (locked || !tab) return;
    sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries));
    sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setRootGroup(r.tree.groupId));
  }, [locked, tab]);

  if (locked) return <div className="w-80"><UnlockScreen onUnlocked={refresh} /></div>;
  const shown = entries.filter(e => (e.title + e.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="w-80 p-3">
      <input className="input mb-2" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
      {shown.map(e => tab && <EntryCard key={e.id} entry={e} tabId={tab.id} clearSecs={clearSecs} />)}
      {entries.length === 0 && tab && rootGroup &&
        <CreateForm url={tab.url} groupId={rootGroup} onCreated={() =>
          sendToSW({ type: 'getEntriesForUrl', url: tab.url }).then(r => 'entries' in r && setEntries(r.entries))} />}
    </div>
  );
}
