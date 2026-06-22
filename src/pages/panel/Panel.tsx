import { useEffect, useState } from 'react';
import { useStatus } from '../../shared/useStatus';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { sendToSW } from '../../shared/messages';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';
import type { TreeNode } from '../../shared/entry';
import { EntryEditor } from './EntryEditor';

function TreeView({ node, onPick }: { node: TreeNode; onPick: (id: string) => void }) {
  return (<div className="ml-2">
    <div className="font-medium text-sm mt-1">{node.name}</div>
    {node.entries.map(e => (
      <button key={e.id} className="block text-left text-sm hover:underline" onClick={() => onPick(e.id)}>
        {e.title} {e.expired && <span className="text-red-600">(expired)</span>}
      </button>))}
    {node.children.map(c => <TreeView key={c.groupId} node={c} onPick={onPick} />)}
  </div>);
}

export function Panel() {
  const { locked, dirty, refresh } = useStatus();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [clearSecs, setClearSecs] = useState(30); const [saved, setSaved] = useState('');
  useEffect(() => { loadSettings().then(s => { applyTheme(s.theme); setClearSecs(s.clipboardClearSeconds); }); }, []);
  const reload = () => sendToSW({ type: 'getTree' }).then(r => 'tree' in r && setTree(r.tree));
  useEffect(() => { if (!locked) reload(); }, [locked]);
  if (locked) return <UnlockScreen onUnlocked={refresh} />;
  async function save() { const r = await sendToSW({ type: 'save' });
    setSaved(r.ok ? 'Saved' : 'Save failed'); refresh(); setTimeout(() => setSaved(''), 2000); }
  return (
    <div className="flex h-screen">
      <div className="w-1/2 overflow-auto border-r">
        <div className="p-2 flex justify-between items-center border-b">
          <span className="font-semibold">QuickKee</span>
          <button className="btn-primary" disabled={!dirty} onClick={save}>
            {dirty ? 'Save *' : 'Saved'} {saved && `· ${saved}`}</button>
        </div>
        {tree && <TreeView node={tree} onPick={setSel} />}
      </div>
      <div className="w-1/2 overflow-auto">
        {sel && <EntryEditor entryId={sel} clearSecs={clearSecs} onChanged={() => { refresh(); reload(); }} />}
      </div>
    </div>);
}
