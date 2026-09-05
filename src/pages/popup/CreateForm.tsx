import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Link, Copy, LogIn, RefreshCw, SlidersHorizontal, History, Loader2, QrCode } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { useSessionLifetime } from '../../shared/useSessionLifetime';
import { copyWithClear } from '../../shared/clipboard';
import type { PwGenOpts } from '../../shared/pwgen';
import { loadDraft, saveDraft, clearDraft, type CreateDraft, type DraftSubmission } from '../../shared/createDraft';
import { PasswordRulesPanel } from '../../shared/PasswordRulesPanel';
import { TotpSetup } from '../../shared/TotpSetup';
import type { TotpConfig } from '../../background/totp';
import { canonicalPageOrigin } from '../../shared/entryDefaults';
import { IconTooltipButton } from '../../shared/IconTooltipButton';
import type { GroupOption } from '../../shared/groups';

type SubmissionState =
  | { status: 'editing' | 'failed' | 'creating' | 'unknown' | 'review' }
  | { status: 'created' | 'saved' | 'fillFailed' | 'complete'; entryId: string };

export function CreateForm({ url, tabId, sessionKey, groups, defaultGroupId, clearSecs, pwgen, scanPage, onCreated }: {
  url: string;
  tabId: number;
  sessionKey: string;
  groups: GroupOption[];
  defaultGroupId: string;
  clearSecs: number;
  pwgen: PwGenOpts;
  scanPage: { disabled: boolean; scanning: boolean; description: string; onClick: () => void };
  onCreated: () => void;
}) {
  const captureLifetime = useSessionLifetime();
  const [title, setTitle] = useState(''); const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [entryUrl, setEntryUrl] = useState(() => canonicalPageOrigin(url));
  const [opts, setOpts] = useState<PwGenOpts>(pwgen);
  const [showRules, setShowRules] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [totp, setTotp] = useState<TotpConfig | null>(null);
  const [initialTotp, setInitialTotp] = useState<TotpConfig | null>(null);
  const [totpError, setTotpError] = useState('');
  const [totpReset, setTotpReset] = useState(0);
  const [state, setState] = useState<SubmissionState>({ status: 'editing' });
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const inFlight = useRef(false);
  const submission = useRef<DraftSubmission | undefined>(undefined);
  const submitted = useRef<CreateDraft | null>(null);
  const needsValidation = useRef(false);
  const fillAfterSave = useRef(false);
  const cleared = useRef(false);
  const passwordGeneration = useRef(0);
  const writes = useRef(Promise.resolve());
  // One form owns this queue. Already-dispatched writes and other popup contexts
  // are not transactional; the session draft's existing TTL/lock policy applies.
  const enqueue = useCallback((operation: () => Promise<void>, isAlive: () => boolean) => {
    const next = writes.current.then(async () => {
      if (!isAlive()) return false;
      await operation();
      return isAlive();
    });
    writes.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);
  const noClass = !opts.lower && !opts.upper && !opts.digits && !opts.symbols;
  const editable = state.status === 'editing' || state.status === 'failed';
  function regenerate(o: PwGenOpts) {
    const isAlive = captureLifetime();
    if (!isAlive() || inFlight.current || submission.current || cleared.current) return;
    if (!o.lower && !o.upper && !o.digits && !o.symbols) return;
    const generation = ++passwordGeneration.current;
    void sendToSW({ type: 'generatePassword', opts: o }).then(r => {
      if (isAlive() && generation === passwordGeneration.current && !submission.current && !inFlight.current && r.ok) setPassword(r.password);
    }).catch(() => {
      if (isAlive() && generation === passwordGeneration.current && !submission.current && !inFlight.current && !cleared.current) {
        setError('Could not generate a password. Try again.');
      }
    });
  }
  useEffect(() => {
    const isAlive = captureLifetime();
    let cancelled = false;
    void loadDraft(url).then(d => {
      if (!isAlive() || cancelled) return;
      if (d) {
        setTitle(d.title); setUsername(d.username); setPassword(d.password);
        setGroupId(d.submission ? d.groupId : groups.some(g => g.groupId === d.groupId) ? d.groupId : defaultGroupId);
        setEntryUrl(d.entryUrl); setOpts(d.opts); setRestored(true);
        setTotp(d.totp ?? null); setInitialTotp(d.totp ?? null);
        submission.current = d.submission;
        if (d.submission) {
          submitted.current = d;
          const marker = d.submission;
          if (marker.sessionKey !== sessionKey) {
            setState({ status: 'review' });
            setError('This draft was submitted in a different session. Review the vault in the side panel before making another entry.');
          } else if (marker.status === 'created' || marker.status === 'saved') {
            needsValidation.current = true;
            setState({ status: marker.status, entryId: marker.entryId });
            setError(marker.status === 'saved' ? 'Entry saved. Finish clearing its recovery draft.' : 'Entry created, but saving was not confirmed. Retry save to keep the same entry.');
          } else {
            setState({ status: 'unknown' });
            setError('Could not confirm whether the entry was created. Review the vault in the side panel before making another entry.');
          }
        }
      } else {
        setEntryUrl(canonicalPageOrigin(url)); setGroupId(defaultGroupId); regenerate(pwgen);
      }
      setHydrated(true);
    }).catch(() => {
      if (isAlive() && !cancelled) setError('Could not load the recovery draft. Retry loading before creating an entry.');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);
  useEffect(() => {
    if (!hydrated || submission.current || inFlight.current || cleared.current) return;
    const isAlive = captureLifetime();
    const draft = { url, title, username, password, groupId, entryUrl, opts, totp, savedAt: Date.now() };
    void enqueue(() => saveDraft(draft, isAlive), isAlive).catch(() => {
      if (isAlive()) setError('Could not store the recovery draft. Keep this popup open and retry saving.');
    });
  }, [hydrated, url, title, username, password, groupId, entryUrl, opts, totp, captureLifetime, enqueue]);

  async function persistMarker(marker: DraftSubmission, isAlive: () => boolean) {
    if (!isAlive() || !submitted.current) return false;
    submission.current = marker;
    const draft = { ...submitted.current, submission: marker };
    submitted.current = draft;
    return enqueue(() => saveDraft(draft, isAlive), isAlive);
  }
  async function submit(fill: boolean) {
    const isAlive = captureLifetime();
    if (!isAlive() || inFlight.current || !hydrated || state.status === 'complete') return;
    if (!editable && state.status !== 'created' && state.status !== 'saved' && state.status !== 'fillFailed') return;
    if (editable && (!title || totpError)) return;
    inFlight.current = true;
    ++passwordGeneration.current;
    setSaving(true); setError('');
    let stage = state;
    try {
      if (editable) {
        fillAfterSave.current = fill;
        submitted.current = { url, title, username, password, groupId, entryUrl, opts, totp, savedAt: Date.now() };
        setState({ status: 'creating' });
        try {
          if (!await persistMarker({ status: 'creating', sessionKey }, isAlive)) return;
        } catch {
          if (!isAlive()) return;
          submission.current = undefined;
          setState({ status: 'failed' });
          setError('Could not store the recovery draft. No entry was created. Retry when storage is available.');
          return;
        }
        if (!isAlive()) return;
        let result;
        try {
          result = await sendToSW({ type: 'createEntry', groupId,
            fields: { Title: title, UserName: username, Password: password, URL: entryUrl },
            ...(totp ? { totp } : {}) });
        } catch { /* A lost reply does not prove that the mutation failed. */ }
        if (!isAlive()) return;
        if (result?.ok === false) {
          submission.current = undefined;
          setState({ status: 'failed' });
          setError('Could not create the entry. Your draft is retained; you can edit it and try again.');
          const draft = { ...submitted.current!, submission: undefined };
          submitted.current = draft;
          await enqueue(() => saveDraft(draft, isAlive), isAlive).catch(() => undefined);
          return;
        }
        if (result?.ok !== true || typeof result.entryId !== 'string' || !result.entryId) {
          setState({ status: 'unknown' });
          setError('Could not confirm whether the entry was created. Review the vault in the side panel before making another entry.');
          await persistMarker({ status: 'unknown', sessionKey }, isAlive).catch(() => undefined);
          return;
        }
        stage = { status: 'created', entryId: result.entryId };
        setState(stage);
      }
      if (!('entryId' in stage) || !isAlive()) return;
      const entryId = stage.entryId;
      if (needsValidation.current) {
        const result = await sendToSW({ type: 'getEntry', entryId });
        if (!isAlive()) return;
        if (result?.ok !== true || result.entry?.id !== entryId) {
          setState({ status: 'review' });
          setError('Could not find the submitted entry in this session. Review the vault in the side panel; the draft is retained.');
          return;
        }
        needsValidation.current = false;
      }
      if (stage.status === 'created') {
        if (!await persistMarker({ status: 'created', sessionKey, entryId }, isAlive) || !isAlive()) return;
        const result = await sendToSW({ type: 'save' });
        if (!isAlive()) return;
        if (result?.ok !== true) {
          setError('Entry created, but saving failed. Retry save to keep the same entry.');
          return;
        }
        // The save acknowledgement also covers a committed offline cache.
        stage = { status: 'saved', entryId };
        setState(stage);
      }
      if (!cleared.current) {
        if (!await persistMarker({ status: 'saved', sessionKey, entryId }, isAlive) || !isAlive()) return;
        if (!await enqueue(() => clearDraft(url, isAlive), isAlive)) return;
        if (!isAlive()) return;
        cleared.current = true;
        setRestored(false);
      }
      if (fillAfterSave.current) {
        if (!isAlive()) return;
        try {
          const result = await sendToSW({ type: 'fillRequest', entryId, tabId });
          if (!isAlive()) return;
          if (result?.ok !== true) throw new Error('fillFailed');
        } catch {
          if (!isAlive()) return;
          setState({ status: 'fillFailed', entryId });
          setError('Entry saved, but autofill failed. Retry fill or review the entry in the side panel.');
          return;
        }
      }
      if (!isAlive()) return;
      setState({ status: 'complete', entryId });
      onCreated();
    } catch {
      if (!isAlive()) return;
      setError(stage.status === 'saved'
        ? 'Entry saved, but clearing its recovery draft failed. Retry completion.'
        : 'Could not finish saving. Your recovery draft is retained; retry save for the same entry.');
    } finally {
      if (isAlive()) { inFlight.current = false; setSaving(false); }
    }
  }
  async function discardDraft() {
    const isAlive = captureLifetime();
    if (!isAlive() || inFlight.current || !editable) return;
    inFlight.current = true;
    ++passwordGeneration.current;
    setSaving(true);
    try {
      if (!await enqueue(() => clearDraft(url, isAlive), isAlive)) return;
      if (!isAlive()) return;
      setTitle(''); setUsername(''); setGroupId(defaultGroupId);
      setEntryUrl(canonicalPageOrigin(url)); setOpts(pwgen);
      setTotp(null); setInitialTotp(null); setTotpError(''); setTotpReset(n => n + 1);
      setRestored(false); setError(''); setState({ status: 'editing' });
      inFlight.current = false;
      regenerate(pwgen);
    } catch { if (isAlive()) setError('Could not discard the draft. Try again.'); }
    finally { if (isAlive()) { inFlight.current = false; setSaving(false); } }
  }
  const isFullUrl = entryUrl === url;
  return (
    <div className="card space-y-2">
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>New entry for <span className="break-all font-normal" style={{ color: 'var(--text-muted)' }}>{url}</span></p>
      {restored && (
        <div className="flex items-center justify-between gap-2 rounded-md p-2 text-sm" style={{ background: 'var(--surface-2, var(--bg))', color: 'var(--text)' }}>
          <span className="flex items-center gap-1.5"><History size={14} /> Draft restored · discarded after 10 min away</span>
          {editable && <button className="btn-secondary shrink-0" disabled={saving} onClick={() => void discardDraft()}>Discard</button>}
        </div>
      )}
      {error && <p className="alert-error" role="alert">{error}</p>}
      {!hydrated && error && <button className="btn-secondary" onClick={() => { setError(''); setLoadAttempt(n => n + 1); }}>Retry draft load</button>}
      <fieldset disabled={!hydrated || !editable || saving} className="space-y-2 min-w-0">
        <select className="input" value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
          {!groups.some(g => g.groupId === groupId) && <option value={groupId}>Original group unavailable</option>}
          {groups.map(g => <option key={g.groupId} value={g.groupId}>{'\u00A0\u00A0'.repeat(g.depth) + g.name}</option>)}
        </select>
        <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
        <div className="flex gap-1.5">
          <input className="input" placeholder="Password" value={password} onChange={e => { ++passwordGeneration.current; setPassword(e.target.value); }} />
          <button className="btn-secondary shrink-0" aria-label="Regenerate password" title="Generate a new password"
            disabled={noClass} onClick={() => regenerate(opts)}><RefreshCw size={15} /></button>
          <button className="btn-secondary shrink-0" aria-label="Password rules" title="Password rules (this session)"
            onClick={() => setShowRules(s => !s)}><SlidersHorizontal size={15} /></button>
          <button className="btn-secondary shrink-0" aria-label="Copy password" title="Copy password"
            disabled={!password} onClick={() => { if (captureLifetime()()) void copyWithClear(password, clearSecs); }}><Copy size={15} /></button>
        </div>
        {showRules && <PasswordRulesPanel opts={opts} onChange={setOpts} />}
        <div className="flex gap-2 items-center">
          <input className="input flex-1" placeholder="URL" value={entryUrl} onChange={e => setEntryUrl(e.target.value)} />
          <IconTooltipButton label="Use full page URL" tooltipTitle="Use full page URL"
            tooltipDescription="Use the current full page URL." disabled={isFullUrl} onClick={() => setEntryUrl(url)}><Link size={15} /></IconTooltipButton>
        </div>
        <TotpSetup initialConfig={initialTotp} issuer={title} account={username} resetKey={totpReset}
          inputAction={<IconTooltipButton label={scanPage.scanning ? 'Scanning visible page' : 'Scan page QR'}
            tooltipTitle="Scan page QR" tooltipDescription={scanPage.description}
            disabled={scanPage.disabled || scanPage.scanning} onClick={() => { if (captureLifetime()()) scanPage.onClick(); }}>
            {scanPage.scanning ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
          </IconTooltipButton>}
          onChange={(config, totpIssue) => { setTotp(config); setTotpError(totpIssue ?? ''); }} />
      </fieldset>
      <div className="flex gap-1.5">
        {(editable || state.status === 'creating') ? <>
          <button className="btn-primary w-full" disabled={!hydrated || !title || saving || !!totpError} onClick={() => void submit(false)}>
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving</> : <><Plus size={15} /> Create &amp; Save</>}
          </button>
          <button className="btn-secondary w-full" disabled={!hydrated || !title || saving || !!totpError} onClick={() => void submit(true)} title="Create and autofill the current tab">
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving</> : <><LogIn size={15} /> Create &amp; Fill</>}
          </button>
        </> : <>
          {(state.status === 'created' || state.status === 'saved' || state.status === 'fillFailed') &&
            <button className="btn-primary w-full" disabled={saving} onClick={() => void submit(false)}>
              {saving ? 'Saving' : state.status === 'created' ? 'Retry save' : state.status === 'saved' ? 'Retry completion' : 'Retry fill'}
            </button>}
          {state.status !== 'complete' && <button className="btn-secondary w-full" disabled={saving} onClick={() => {
            const isAlive = captureLifetime();
            if (isAlive()) void chrome.sidePanel.open({ tabId }).catch(() => { if (isAlive()) setError('Could not open the side panel. Try again.'); });
          }}>Review in side panel</button>}
        </>}
      </div>
    </div>
  );
}
