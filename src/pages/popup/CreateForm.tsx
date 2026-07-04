import { useEffect, useState } from 'react';
import { Plus, Link, Copy, LogIn, RefreshCw, SlidersHorizontal, History } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { PwGenOpts } from '../../shared/pwgen';
import { loadDraft, saveDraft, clearDraft } from '../../shared/createDraft';

function baseUrl(url: string) {
  try { return new URL(url).origin + '/'; } catch { return url; }
}

export function CreateForm({ url, tabId, groups, defaultGroupId, clearSecs, pwgen, onCreated }: {
  url: string;
  tabId: number;
  groups: { groupId: string; name: string; depth: number }[];
  defaultGroupId: string;
  clearSecs: number;
  pwgen: PwGenOpts;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState(''); const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [entryUrl, setEntryUrl] = useState(() => baseUrl(url));
  const [opts, setOpts] = useState<PwGenOpts>(pwgen);
  const [showRules, setShowRules] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const noClass = !opts.lower && !opts.upper && !opts.digits && !opts.symbols;
  function regenerate(o: PwGenOpts) {
    if (!o.lower && !o.upper && !o.digits && !o.symbols) return;
    sendToSW({ type: 'generatePassword', opts: o }).then(r => 'password' in r && setPassword(r.password));
  }
  // Restore a persisted draft (the popup unmounts whenever it loses focus), or
  // start fresh — generating the first password only when there is no draft.
  useEffect(() => {
    let cancelled = false;
    loadDraft(url).then(d => {
      if (cancelled) return;
      if (d) {
        setTitle(d.title); setUsername(d.username); setPassword(d.password);
        setGroupId(groups.some(g => g.groupId === d.groupId) ? d.groupId : defaultGroupId);
        setEntryUrl(d.entryUrl); setOpts(d.opts); setRestored(true);
      } else {
        setEntryUrl(baseUrl(url)); setGroupId(defaultGroupId); regenerate(pwgen);
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist the draft on every change so nothing is lost when the popup closes.
  useEffect(() => {
    if (!hydrated) return;
    void saveDraft({ url, title, username, password, groupId, entryUrl, opts, savedAt: Date.now() });
  }, [hydrated, url, title, username, password, groupId, entryUrl, opts]);
  async function create(): Promise<string | null> {
    const r = await sendToSW({ type: 'createEntry', groupId, fields: { Title: title, UserName: username, Password: password, URL: entryUrl } });
    await sendToSW({ type: 'save' });
    await clearDraft(url);
    setRestored(false);
    return 'entryId' in r ? r.entryId : null;
  }
  async function discardDraft() {
    await clearDraft(url);
    setTitle(''); setUsername(''); setGroupId(defaultGroupId);
    setEntryUrl(baseUrl(url)); setOpts(pwgen); regenerate(pwgen);
    setRestored(false);
  }
  async function createAndSave() { await create(); onCreated(); }
  async function createAndFill() {
    const entryId = await create();
    if (entryId) await sendToSW({ type: 'fillRequest', entryId, tabId });
    onCreated();
  }
  const isFullUrl = entryUrl === url;
  return (
    <div className="card space-y-2">
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>New entry for <span className="break-all font-normal" style={{ color: 'var(--text-muted)' }}>{url}</span></p>
      {restored && (
        <div className="flex items-center justify-between gap-2 rounded-md p-2 text-sm" style={{ background: 'var(--surface-2, var(--bg))', color: 'var(--text)' }}>
          <span className="flex items-center gap-1.5"><History size={14} /> Draft restored · discarded after 10 min away</span>
          <button className="btn-secondary shrink-0" onClick={() => void discardDraft()}>Discard</button>
        </div>
      )}
      <select className="input" value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
        {groups.map(g => (
          <option key={g.groupId} value={g.groupId}>{'\u00A0\u00A0'.repeat(g.depth) + g.name}</option>
        ))}
      </select>
      <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <div className="flex gap-1.5">
        <input className="input" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="btn-secondary shrink-0" aria-label="Regenerate password" title="Generate a new password"
          disabled={noClass} onClick={() => regenerate(opts)}>
          <RefreshCw size={15} />
        </button>
        <button className="btn-secondary shrink-0" aria-label="Password rules" title="Password rules (this session)"
          onClick={() => setShowRules(s => !s)}>
          <SlidersHorizontal size={15} />
        </button>
        <button className="btn-secondary shrink-0" aria-label="Copy password" title="Copy password"
          disabled={!password} onClick={() => copyWithClear(password, clearSecs)}>
          <Copy size={15} />
        </button>
      </div>
      {showRules && (
        <div className="space-y-2 rounded-md p-2" style={{ background: 'var(--surface-2, var(--bg))' }}>
          <label className="flex items-center justify-between gap-3 text-sm">
            Length
            <input type="number" className="input w-20" value={opts.length}
              onChange={e => setOpts(o => ({ ...o, length: Math.max(1, Number(e.target.value) || 1) }))} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['lower', 'upper', 'digits', 'symbols'] as const).map(k => (
              <label key={k} className="flex items-center gap-2 text-sm capitalize">
                <input type="checkbox" checked={opts[k]}
                  onChange={e => setOpts(o => ({ ...o, [k]: e.target.checked }))} /> {k}
              </label>))}
          </div>
          {noClass && <p className="text-sm" style={{ color: 'var(--danger, #c00)' }}>Enable at least one character set.</p>}
        </div>
      )}
      <input className="input" placeholder="URL" value={entryUrl} onChange={e => setEntryUrl(e.target.value)} />
      <button className="btn-secondary w-full" disabled={isFullUrl} onClick={() => setEntryUrl(url)} title="Use the current full page URL">
        <Link size={15} /> Use full page URL
      </button>
      <div className="flex gap-1.5">
        <button className="btn-primary w-full" disabled={!title} onClick={createAndSave}>
          <Plus size={15} /> Create &amp; Save
        </button>
        <button className="btn-secondary w-full" disabled={!title} onClick={createAndFill} title="Create and autofill the current tab">
          <LogIn size={15} /> Create &amp; Fill
        </button>
      </div>
    </div>
  );
}