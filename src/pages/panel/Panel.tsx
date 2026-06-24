import { useEffect, useState } from 'react';
import { ShieldCheck, Save, FolderClosed, FolderOpen, FileText, X, Lock } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { lockVault } from '../../shared/lockVault';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { TreeNode } from '../../shared/entry';
import { EntryEditor } from './EntryEditor';

function findGroup(node: TreeNode, id: string): TreeNode | null {
  if (node.groupId === id) return node;
  for (const c of node.children) { const f = findGroup(c, id); if (f) return f; }
  return null;
}

function GroupTree({ node, sel, onPick, depth = 0 }: { node: TreeNode; sel: string | null; onPick: (id: string) => void; depth?: number }) {
  const active = sel === node.groupId;
  return (
    <div>
      <button onClick={() => onPick(node.groupId)}
        className="flex items-center gap-1.5 w-full text-left text-sm rounded-md py-1 pr-2 transition-colors"
        style={{
          paddingLeft: `${8 + depth * 12}px`,
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--primary)' : 'var(--text)',
          background: active ? 'var(--primary-tint)' : 'transparent',
        }}
        onMouseEnter={ev => { if (!active) ev.currentTarget.style.background = 'var(--btn-bg)'; }}
        onMouseLeave={ev => { if (!active) ev.currentTarget.style.background = 'transparent'; }}>
        {active ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map(c => <GroupTree key={c.groupId} node={c} sel={sel} onPick={onPick} depth={depth + 1} />)}
    </div>
  );
}

export function Panel() {
  const { locked, dirty, refresh } = useStatus();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [selEntry, setSelEntry] = useState<string | null>(null);
  const [clearSecs, setClearSecs] = useState(30); const [saved, setSaved] = useState('');
  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  const reload = () => sendToSW({ type: 'getTree' }).then(r => {
    if (!('tree' in r)) return;
    setTree(r.tree);
    setSelGroup(g => g ?? r.tree.groupId);
  });
  useEffect(() => { if (!locked) reload(); }, [locked]);
  if (locked) return (
    <div className="min-h-screen flex flex-col justify-center" style={{ background: 'var(--bg)' }}>
      <UnlockScreen onUnlocked={refresh} />
    </div>);
  async function save() { const r = await sendToSW({ type: 'save' });
    setSaved(r.ok ? 'Saved' : 'Save failed'); refresh(); setTimeout(() => setSaved(''), 2000); }

  const group = tree && selGroup ? findGroup(tree, selGroup) : null;

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg)' }}>
      <header className="app-header">
        <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee</span>
        <div className="flex items-center gap-1">
          <button className="btn-primary btn-xs" disabled={!dirty} onClick={save}>
            <Save size={13} /> {dirty ? 'Save *' : 'Saved'}{saved && ` · ${saved}`}
          </button>
          <button className="icon-btn" aria-label="Lock database" title="Lock database" onClick={() => lockVault(dirty).then(refresh)}>
            <Lock size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Left: groups only */}
        <div className="w-56 shrink-0 overflow-auto py-2" style={{ borderRight: '1px solid var(--border)' }}>
          {tree && <GroupTree node={tree} sel={selGroup} onPick={id => { setSelGroup(id); setSelEntry(null); }} />}
        </div>

        {/* Right: entries of selected group */}
        <div className="flex-1 overflow-auto py-2">
          {group && group.entries.length > 0
            ? group.entries.map(e => (
              <button key={e.id} onClick={() => setSelEntry(e.id)}
                className="flex items-center gap-2 w-full text-left text-sm rounded-md py-1.5 px-3 transition-colors"
                style={{
                  color: 'var(--text)',
                  background: selEntry === e.id ? 'var(--primary-tint)' : 'transparent',
                }}
                onMouseEnter={ev => { if (selEntry !== e.id) ev.currentTarget.style.background = 'var(--btn-bg)'; }}
                onMouseLeave={ev => { if (selEntry !== e.id) ev.currentTarget.style.background = 'transparent'; }}>
                <FileText size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="flex flex-col min-w-0">
                  <span className="truncate">{e.title}</span>
                  {e.username && <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{e.username}</span>}
                </span>
                {e.expired && <span className="badge-danger badge ml-auto">expired</span>}
              </button>))
            : <div className="empty-state mt-12">{group ? 'This group has no entries.' : 'Select a group.'}</div>}
        </div>
      </div>

      {/* Bottom: entry details / edit */}
      {selEntry && (
        <div className="flex flex-col shrink-0" style={{ height: '45vh', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="section-title">Entry details</span>
            <button className="icon-btn" aria-label="Close details" title="Close details" onClick={() => setSelEntry(null)}>
              <X size={15} />
            </button>
          </div>
          <div className="overflow-auto flex-1">
            <EntryEditor entryId={selEntry} clearSecs={clearSecs} onChanged={() => { refresh(); reload(); }} />
          </div>
        </div>)}
    </div>);
}
