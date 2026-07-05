import { useEffect, useState } from 'react';
import { ShieldCheck, Save, FolderClosed, FolderOpen, FileText, X, Lock,
  ChevronRight, ChevronDown, Plus, Pencil, Trash2, Check, Search } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { lockVault } from '../../shared/lockVault';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { TreeNode } from '../../shared/entry';
import { DEFAULT_PWGEN, type PwGenOpts } from '../../shared/pwgen';
import { EntryEditor } from './EntryEditor';

function findGroup(node: TreeNode, id: string): TreeNode | null {
  if (node.groupId === id) return node;
  for (const c of node.children) { const f = findGroup(c, id); if (f) return f; }
  return null;
}

type FlatEntry = TreeNode['entries'][number];

function collectEntries(node: TreeNode, acc: FlatEntry[] = []): FlatEntry[] {
  for (const e of node.entries) acc.push(e);
  for (const c of node.children) collectEntries(c, acc);
  return acc;
}

interface GroupOps {
  sel: string | null;
  expanded: Set<string>;
  editing: string | null;
  onPick: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string) => void;
  onRename: (id: string, name: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (node: TreeNode) => void;
}

function GroupTree({ node, ops, depth = 0 }: { node: TreeNode; ops: GroupOps; depth?: number }) {
  const active = ops.sel === node.groupId;
  const hasChildren = node.children.length > 0;
  const open = ops.expanded.has(node.groupId);
  const isEditing = ops.editing === node.groupId;
  const isRoot = depth === 0;
  const [draft, setDraft] = useState(node.name);
  useEffect(() => { if (isEditing) setDraft(node.name); }, [isEditing, node.name]);

  return (
    <div>
      <div className="group flex items-center rounded-md pr-1 transition-colors"
        style={{
          paddingLeft: `${4 + depth * 12}px`,
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--primary)' : 'var(--text)',
          background: active ? 'var(--primary-tint)' : 'transparent',
        }}
        onMouseEnter={ev => { if (!active) ev.currentTarget.style.background = 'var(--btn-bg)'; }}
        onMouseLeave={ev => { if (!active) ev.currentTarget.style.background = 'transparent'; }}>
        <button className="shrink-0 p-0.5" aria-label={open ? 'Collapse' : 'Expand'}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          onClick={() => ops.onToggle(node.groupId)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {isEditing ? (
          // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus the rename input when entering edit mode
          <input autoFocus value={draft} className="input-sm flex-1 min-w-0 mr-1"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') ops.onRename(node.groupId, draft.trim());
              else if (e.key === 'Escape') ops.onCancelEdit();
            }} />
        ) : (
          <button onClick={() => ops.onPick(node.groupId)}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-sm py-1">
            {active ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {isEditing ? (
          <>
            <button className="icon-btn-xs" aria-label="Save name" title="Save name"
              onClick={() => ops.onRename(node.groupId, draft.trim())}><Check size={13} /></button>
            <button className="icon-btn-xs" aria-label="Cancel" title="Cancel"
              onClick={ops.onCancelEdit}><X size={13} /></button>
          </>
        ) : (
          <span className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="icon-btn-xs" aria-label="Add subgroup" title="Add subgroup"
              onClick={() => ops.onAdd(node.groupId)}><Plus size={13} /></button>
            <button className="icon-btn-xs" aria-label="Rename group" title="Rename group"
              onClick={() => ops.onStartEdit(node.groupId)}><Pencil size={13} /></button>
            {!isRoot && (
              <button className="icon-btn-xs" aria-label="Delete group" title="Delete group"
                onClick={() => ops.onDelete(node)}><Trash2 size={13} /></button>)}
          </span>
        )}
      </div>
      {open && node.children.map(c => <GroupTree key={c.groupId} node={c} ops={ops} depth={depth + 1} />)}
    </div>
  );
}

export function Panel() {
  const { locked, dirty, refresh } = useStatus();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [selEntry, setSelEntry] = useState<string | null>(null);
  const [clearSecs, setClearSecs] = useState(30); const [saved, setSaved] = useState('');
  const [pwgen, setPwgen] = useState<PwGenOpts>(DEFAULT_PWGEN);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); setPwgen(s.pwgen); }); }, []);
  const reload = () => sendToSW({ type: 'getTree' }).then(r => {
    if (!('tree' in r)) return;
    setTree(r.tree);
    setSelGroup(g => g ?? r.tree.groupId);
    setExpanded(e => e.size ? e : new Set([r.tree.groupId]));
  });

  const toggle = (id: string) => setExpanded(e => {
    const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  async function addGroup(parentId: string) {
    const r = await sendToSW({ type: 'createGroup', parentId, name: 'New Group' });
    setExpanded(e => new Set(e).add(parentId));
    await reload(); refresh();
    if ('groupId' in r) { setSelGroup(r.groupId); setSelEntry(null); setEditing(r.groupId); }
  }
  async function renameGroup(id: string, name: string) {
    if (name) await sendToSW({ type: 'updateGroup', groupId: id, fields: { Name: name } });
    setEditing(null); await reload(); refresh();
  }
  async function deleteGroup(node: TreeNode) {
    const label = node.children.length || node.entries.length
      ? `Delete "${node.name}" and everything inside it?`
      : `Delete "${node.name}"?`;
    if (!confirm(label)) return;
    await sendToSW({ type: 'deleteGroup', groupId: node.groupId });
    setSelGroup(g => g === node.groupId ? (tree ? tree.groupId : null) : g);
    setSelEntry(null);
    await reload(); refresh();
  }
  useEffect(() => { if (!locked) reload(); }, [locked]);
  if (locked) return (
    <div className="min-h-screen flex flex-col justify-center" style={{ background: 'var(--bg)' }}>
      <UnlockScreen onUnlocked={refresh} />
    </div>);
  async function save() { const r = await sendToSW({ type: 'save' });
    setSaved(r.ok ? 'Saved' : 'Save failed'); refresh(); setTimeout(() => setSaved(''), 2000); }

  const group = tree && selGroup ? findGroup(tree, selGroup) : null;
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const shown = searching && tree
    ? collectEntries(tree).filter(e =>
        `${e.title} ${e.username} ${e.url}`.toLowerCase().includes(q))
    : group ? group.entries : [];

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
          {tree && <GroupTree node={tree} ops={{
            sel: selGroup, expanded, editing,
            onPick: id => { setSelGroup(id); setSelEntry(null); },
            onToggle: toggle,
            onAdd: addGroup,
            onRename: renameGroup,
            onStartEdit: setEditing,
            onCancelEdit: () => setEditing(null),
            onDelete: deleteGroup,
          }} />}
        </div>

        {/* Right: entries of selected group, or search results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 p-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input className="input pl-9" placeholder="Search all entries…" value={query}
                onChange={e => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-auto py-2">
            {shown.length > 0
              ? shown.map(e => (
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
              : <div className="empty-state mt-12">
                  {searching ? 'No entries match your search.' : group ? 'This group has no entries.' : 'Select a group.'}
                </div>}
          </div>
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
            <EntryEditor entryId={selEntry} clearSecs={clearSecs} pwgen={pwgen}
              onChanged={() => { refresh(); reload(); }}
              onDeleted={() => { setSelEntry(null); refresh(); reload(); }} />
          </div>
        </div>)}
    </div>);
}
