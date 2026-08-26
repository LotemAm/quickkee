import { useEffect, useRef, useState } from 'react';
import { Save, Loader2, FolderClosed, FolderOpen, FileText, CreditCard, X, Lock,
  ChevronRight, ChevronDown, Plus, Pencil, Trash2, Check, Search, Paperclip } from 'lucide-react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { lockVault } from '../../shared/lockVault';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import { consumeOpenEntry, watchOpenEntry } from '../../shared/openEntry';
import { maskCardNumber } from '../../shared/cardMask';
import type { TreeNode } from '../../shared/entry';
import { mergeTotpImportChunks, type TotpImportAssignment, type TotpImportResult } from '../../shared/totpImport';
import { googleAuthenticatorImporter } from '../../background/totpImport';
import { DEFAULT_PWGEN, type PwGenOpts } from '../../shared/pwgen';
import { EntryEditor } from './EntryEditor';
import { PanelActionsMenu } from './PanelActionsMenu';
import { TotpImportDialog } from './TotpImportDialog';
import { decodeQrImage } from './decodeQrImage';

function findGroup(node: TreeNode, id: string): TreeNode | null {
  if (node.groupId === id) return node;
  for (const c of node.children) { const f = findGroup(c, id); if (f) return f; }
  return null;
}

function findEntryGroup(node: TreeNode, entryId: string, ancestors: string[] = []): { groupId: string; ancestors: string[] } | null {
  if (node.entries.some(e => e.id === entryId)) return { groupId: node.groupId, ancestors };
  for (const c of node.children) {
    const found = findEntryGroup(c, entryId, [...ancestors, node.groupId]);
    if (found) return found;
  }
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
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [clearSecs, setClearSecs] = useState(30); const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwgen, setPwgen] = useState<PwGenOpts>(DEFAULT_PWGEN);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingOpenEntry, setPendingOpenEntry] = useState<string | null>(null);
  const [totpImport, setTotpImport] = useState<TotpImportResult | null>(null);
  const [totpImportError, setTotpImportError] = useState('');
  const [readingTotpQr, setReadingTotpQr] = useState(false);
  const [savingTotpImport, setSavingTotpImport] = useState(false);
  const totpFileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); setPwgen(s.pwgen); }); }, []);
  const reload = () => sendToSW({ type: 'getTree' }).then(r => {
    if (!r.ok) return;
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
    if (r.ok) { setSelGroup(r.groupId); setSelEntry(null); setCreatingEntry(false); setEditing(r.groupId); }
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
    setCreatingEntry(false);
    await reload(); refresh();
  }
  useEffect(() => { if (!locked) reload(); }, [locked]);
  useEffect(() => {
    if (locked) return;
    consumeOpenEntry().then(id => { if (id) setPendingOpenEntry(id); });
    return watchOpenEntry(id => setPendingOpenEntry(id));
  }, [locked]);
  useEffect(() => {
    if (!pendingOpenEntry || !tree) return;
    const found = findEntryGroup(tree, pendingOpenEntry);
    if (found) {
      setSelGroup(found.groupId);
      setExpanded(e => new Set([...e, ...found.ancestors]));
    }
    setSelEntry(pendingOpenEntry);
    setCreatingEntry(false);
    setPendingOpenEntry(null);
  }, [pendingOpenEntry, tree]);
  if (locked) return (
    <div className="min-h-screen flex flex-col justify-center" style={{ background: 'var(--bg)' }}>
      <UnlockScreen onUnlocked={refresh} />
    </div>);
  async function save() { setSaving(true);
    const r = await sendToSW({ type: 'save' });
    setSaved(r.ok ? 'Saved' : 'Save failed'); refresh(); setSaving(false); setTimeout(() => setSaved(''), 2000); }

  function beginTotpImport() {
    setTotpImportError('');
    if (!tree) {
      setTotpImportError('Vault entries are still loading. Try again in a moment.');
      return;
    }
    totpFileInput.current?.click();
  }

  async function readTotpExport(files: FileList | null) {
    if (!files?.length) return;
    setReadingTotpQr(true);
    setTotpImportError('');
    try {
      const chunks = [];
      for (const file of Array.from(files)) {
        chunks.push(googleAuthenticatorImporter.parse(await decodeQrImage(file)));
      }
      setTotpImport(mergeTotpImportChunks(chunks));
    } catch (error) {
      setTotpImportError(error instanceof Error ? error.message : 'Could not import authenticator QR code');
    } finally {
      setReadingTotpQr(false);
      if (totpFileInput.current) totpFileInput.current.value = '';
    }
  }

  async function saveTotpAssignments(assignments: TotpImportAssignment[]) {
    setSavingTotpImport(true);
    setTotpImportError('');
    try {
      const result = await sendToSW({ type: 'importTotp', assignments });
      if (result.ok) {
        setTotpImport(null);
        await reload();
        refresh();
      } else setTotpImportError(result.error);
    } catch {
      setTotpImportError('Could not import authenticator keys');
    } finally {
      setSavingTotpImport(false);
    }
  }

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
        <span className="app-title"><img src={chrome.runtime.getURL('icon-32.png')} alt="" className="app-logo" width={18} height={18} /> QuickKee</span>
        <div className="flex items-center gap-1">
          <input ref={totpFileInput} className="hidden" type="file" accept="image/*" multiple
            aria-label="Google Authenticator QR images"
            onChange={event => void readTotpExport(event.target.files)} />
          <button className="btn-primary btn-xs" disabled={!dirty || saving} onClick={save}>
            {saving
              ? <><Loader2 size={13} className="animate-spin" /> Saving</>
              : <><Save size={13} /> {dirty ? 'Save *' : 'Saved'}{saved && ` · ${saved}`}</>}
          </button>
          <button className="icon-btn" aria-label="Lock database" title="Lock database" onClick={() => lockVault(dirty).then(refresh)}>
            <Lock size={16} />
          </button>
          <PanelActionsMenu importBusy={readingTotpQr} onImportTotp={beginTotpImport} />
        </div>
      </header>

      {totpImportError && !totpImport && (
        <div className="alert-error mx-3 mt-2 flex items-center justify-between gap-2" role="alert">
          <span>{totpImportError}</span>
          <button className="icon-btn-xs" aria-label="Dismiss import error" onClick={() => setTotpImportError('')}><X size={13} /></button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left: groups only */}
        <div className="w-56 shrink-0 overflow-auto py-2" style={{ borderRight: '1px solid var(--border)' }}>
          {tree && <GroupTree node={tree} ops={{
            sel: selGroup, expanded, editing,
            onPick: id => { setSelGroup(id); setSelEntry(null); setCreatingEntry(false); },
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
          <div className="shrink-0 p-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input className="input pl-9" placeholder="Search all entries…" value={query}
                onChange={e => setQuery(e.target.value)} />
            </div>
            <button className="icon-btn" aria-label="Add entry" title={selGroup ? 'Add entry' : 'Select a group first'}
              disabled={!selGroup}
              onClick={() => { setCreatingEntry(true); setSelEntry(null); }}>
              <Plus size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-auto py-2">
            {shown.length > 0
              ? shown.map(e => (
                <button key={e.id} onClick={() => { setSelEntry(e.id); setCreatingEntry(false); }}
                  className="flex items-center gap-2 w-full text-left text-sm rounded-md py-1.5 px-3 transition-colors"
                  style={{
                    color: 'var(--text)',
                    background: selEntry === e.id ? 'var(--primary-tint)' : 'transparent',
                  }}
                  onMouseEnter={ev => { if (selEntry !== e.id) ev.currentTarget.style.background = 'var(--btn-bg)'; }}
                  onMouseLeave={ev => { if (selEntry !== e.id) ev.currentTarget.style.background = 'transparent'; }}>
                  {e.isCard
                    ? <CreditCard size={14} style={{ color: 'var(--text-muted)' }} />
                    : <FileText size={14} style={{ color: 'var(--text-muted)' }} />}
                  <span className="flex flex-col min-w-0">
                    <span className="truncate">{e.title}</span>
                    {e.username && <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{e.isCard ? maskCardNumber(e.username) : e.username}</span>}
                  </span>
                  {e.hasAttachments && <Paperclip size={12} className="ml-auto" style={{ color: 'var(--text-muted)' }} />}
                  {e.expired && <span className="badge-danger badge ml-auto">expired</span>}
                </button>))
              : <div className="empty-state mt-12">
                  {searching ? 'No entries match your search.' : group ? 'This group has no entries.' : 'Select a group.'}
                </div>}
          </div>
        </div>
      </div>

      {/* Bottom: entry details / edit / create */}
      {(selEntry || creatingEntry) && (
        <div className="flex flex-col shrink-0" style={{ height: '45vh', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="section-title">{creatingEntry ? 'New entry' : 'Entry details'}</span>
            <button className="icon-btn" aria-label="Close details" title="Close details"
              onClick={() => { setSelEntry(null); setCreatingEntry(false); }}>
              <X size={15} />
            </button>
          </div>
          <div className="overflow-auto flex-1">
            <EntryEditor entryId={creatingEntry ? null : selEntry} groupId={selGroup ?? undefined}
              clearSecs={clearSecs} pwgen={pwgen}
              onChanged={() => { refresh(); reload(); }}
              onCreated={id => { setCreatingEntry(false); setSelEntry(id); refresh(); reload(); }}
              onDeleted={() => { setSelEntry(null); refresh(); reload(); }} />
          </div>
        </div>)}
      {totpImport && tree && (
        <TotpImportDialog result={totpImport} tree={tree} defaultGroupId={selGroup ?? tree.groupId}
          busy={savingTotpImport} error={totpImportError}
          onCancel={() => { setTotpImport(null); setTotpImportError(''); }}
          onConfirm={assignments => void saveTotpAssignments(assignments)} />
      )}
    </div>);
}
