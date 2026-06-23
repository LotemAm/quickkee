import { useEffect, useState } from 'react';
import { ShieldCheck, Save, FolderClosed, FileText } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { TreeNode } from '../../shared/entry';
import { EntryEditor } from './EntryEditor';

function TreeView({ node, sel, onPick, depth = 0 }: { node: TreeNode; sel: string | null; onPick: (id: string) => void; depth?: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1 text-sm font-medium"
        style={{ color: 'var(--text-muted)', paddingLeft: `${8 + depth * 12}px` }}>
        <FolderClosed size={13} /> {node.name}
      </div>
      {node.entries.map(e => (
        <button key={e.id} onClick={() => onPick(e.id)}
          className="flex items-center gap-1.5 w-full text-left text-sm rounded-md py-1 pr-2 transition-colors"
          style={{
            paddingLeft: `${20 + depth * 12}px`,
            color: 'var(--text)',
            background: sel === e.id ? 'var(--primary-tint)' : 'transparent',
          }}
          onMouseEnter={ev => { if (sel !== e.id) ev.currentTarget.style.background = 'var(--btn-bg)'; }}
          onMouseLeave={ev => { if (sel !== e.id) ev.currentTarget.style.background = 'transparent'; }}>
          <FileText size={13} style={{ color: 'var(--text-muted)' }} />
          <span className="truncate">{e.title}</span>
          {e.expired && <span className="badge-danger badge ml-auto">expired</span>}
        </button>))}
      {node.children.map(c => <TreeView key={c.groupId} node={c} sel={sel} onPick={onPick} depth={depth + 1} />)}
    </div>
  );
}

export function Panel() {
  const { locked, dirty, refresh } = useStatus();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [clearSecs, setClearSecs] = useState(30); const [saved, setSaved] = useState('');
  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  const reload = () => sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setTree(r.tree));
  useEffect(() => { if (!locked) reload(); }, [locked]);
  if (locked) return (
    <div className="min-h-screen flex flex-col justify-center" style={{ background: 'var(--bg)' }}>
      <UnlockScreen onUnlocked={refresh} />
    </div>);
  async function save() { const r = await sendToSW({ type: 'save' });
    setSaved(r.ok ? 'Saved' : 'Save failed'); refresh(); setTimeout(() => setSaved(''), 2000); }
  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-1/2 max-w-sm flex flex-col" style={{ borderRight: '1px solid var(--border)' }}>
        <header className="app-header">
          <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee</span>
          <button className="btn-primary btn-xs" disabled={!dirty} onClick={save}>
            <Save size={13} /> {dirty ? 'Save *' : 'Saved'}{saved && ` · ${saved}`}
          </button>
        </header>
        <div className="overflow-auto py-2 flex-1">
          {tree && <TreeView node={tree} sel={sel} onPick={setSel} />}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {sel
          ? <EntryEditor entryId={sel} clearSecs={clearSecs} onChanged={() => { refresh(); reload(); }} />
          : <div className="empty-state mt-12">Select an entry to view and edit its details.</div>}
      </div>
    </div>);
}
