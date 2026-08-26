import { useEffect, useState } from 'react';
import { Plus, Link, Copy, LogIn, RefreshCw, SlidersHorizontal, History, Loader2 } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { PwGenOpts } from '../../shared/pwgen';
import { loadDraft, saveDraft, clearDraft } from '../../shared/createDraft';
import { PasswordRulesPanel } from '../../shared/PasswordRulesPanel';
import { TotpSetup } from '../../shared/TotpSetup';
import type { TotpConfig } from '../../background/totp';

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
  const [saving, setSaving] = useState(false);
  const [totp, setTotp] = useState<TotpConfig | null>(null);
  const [totpError, setTotpError] = useState('');
  const [totpReset, setTotpReset] = useState(0);
  const noClass = !opts.lower && !opts.upper && !opts.digits && !opts.symbols;
  function regenerate(o: PwGenOpts) {
    if (!o.lower && !o.upper && !o.digits && !o.symbols) return;
    sendToSW({ type: 'generatePassword', opts: o }).then(r => r.ok && setPassword(r.password));
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
    const r = await sendToSW({
      type: 'createEntry', groupId,
      fields: { Title: title, UserName: username, Password: password, URL: entryUrl },
      ...(totp ? { totp } : {}),
    });
    await sendToSW({ type: 'save' });
    await clearDraft(url);
    setRestored(false);
    return r.ok ? r.entryId : null;
  }
  async function discardDraft() {
    await clearDraft(url);
    setTitle(''); setUsername(''); setGroupId(defaultGroupId);
    setEntryUrl(baseUrl(url)); setOpts(pwgen); regenerate(pwgen);
    setTotp(null); setTotpError(''); setTotpReset(n => n + 1);
    setRestored(false);
  }
  async function createAndSave() {
    setSaving(true);
    try { await create(); } finally { setSaving(false); }
    onCreated();
  }
  async function createAndFill() {
    setSaving(true);
    try {
      const entryId = await create();
      if (entryId) await sendToSW({ type: 'fillRequest', entryId, tabId });
    } finally { setSaving(false); }
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
      {showRules && <PasswordRulesPanel opts={opts} onChange={setOpts} />}
      <input className="input" placeholder="URL" value={entryUrl} onChange={e => setEntryUrl(e.target.value)} />
      <button className="btn-secondary w-full" disabled={isFullUrl} onClick={() => setEntryUrl(url)} title="Use the current full page URL">
        <Link size={15} /> Use full page URL
      </button>
      <TotpSetup initialConfig={null} issuer={title} account={username} resetKey={totpReset}
        onChange={(config, error) => { setTotp(config); setTotpError(error ?? ''); }} />
      <div className="flex gap-1.5">
        <button className="btn-primary w-full" disabled={!title || saving || !!totpError} onClick={createAndSave}>
          {saving ? <><Loader2 size={15} className="animate-spin" /> Saving</> : <><Plus size={15} /> Create &amp; Save</>}
        </button>
        <button className="btn-secondary w-full" disabled={!title || saving || !!totpError} onClick={createAndFill} title="Create and autofill the current tab">
          {saving ? <><Loader2 size={15} className="animate-spin" /> Saving</> : <><LogIn size={15} /> Create &amp; Fill</>}
        </button>
      </div>
    </div>
  );
}
