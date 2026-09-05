import { useRef, useState } from 'react';
import { Copy, LogIn, ChevronDown, ChevronUp, PanelRight, CreditCard, KeyRound, UserRound, LockKeyhole } from 'lucide-react';
import type { EntrySummary, EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';
import { requestOpenEntry } from '../../shared/openEntry';
import { maskCardNumber } from '../../shared/cardMask';
import { TotpCodeDisplay } from '../../shared/TotpSetup';
import { useSessionLifetime } from '../../shared/useSessionLifetime';

export function EntryCard({ entry, tabId, onCopy, groupName }: {
  entry: EntrySummary | EntryView;
  tabId: number;
  onCopy: (text: string, label: string) => void;
  groupName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const captureLifetime = useSessionLifetime();
  const cache = useRef<EntryView | null>(null);
  const inFlight = useRef<Promise<EntryView | null> | null>(null);
  const [loaded, setLoaded] = useState<EntryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supplied = 'password' in entry ? entry : null;
  const details = supplied ?? loaded;
  // Summaries do not say whether custom fields or an expiry date exist.
  const hasFields = !supplied || supplied.expires != null || supplied.fields.length > 0;

  function loadDetails(): Promise<EntryView | null> {
    const isAlive = captureLifetime();
    if (!isAlive()) return Promise.resolve(null);
    if (supplied || cache.current) return Promise.resolve(supplied ?? cache.current);
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    setError('');
    const request = (async () => {
      try {
        const result = await sendToSW({ type: 'getEntry', entryId: entry.id });
        if (!isAlive()) return null;
        if (!result.ok || !result.entry || result.entry.id !== entry.id) {
          throw new Error('Could not load entry details. Try again.');
        }
        cache.current = result.entry;
        setLoaded(result.entry);
        return result.entry;
      } catch {
        if (isAlive()) setError('Could not load entry details. Try again.');
        return null;
      }
    })();
    inFlight.current = request;
    void request.then(() => {
      if (isAlive()) {
        inFlight.current = null;
        setLoading(false);
      }
    });
    return request;
  }

  function copyPassword() {
    const isAlive = captureLifetime();
    if (!isAlive()) return;
    if (supplied) { onCopy(supplied.password, 'Password'); return; }
    void loadDetails().then(value => {
      if (isAlive() && value) onCopy(value.password, 'Password');
    });
  }
  return (
    <div className="card mb-2">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate flex items-center gap-1" style={{ color: 'var(--text)' }}>
            {entry.isCard && <CreditCard size={12} className="shrink-0" />}
            <span className="truncate min-w-0">{entry.title}</span>
          </div>
          <div className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{entry.isCard ? maskCardNumber(entry.username) : entry.username}</div>
        </div>
        <div className="flex items-start gap-1 shrink-0">
          <button className="icon-btn-xs" aria-label="Open in sidebar" title="Open in sidebar"
            onClick={() => { requestOpenEntry(entry.id); chrome.sidePanel.open({ tabId }); }}>
            <PanelRight size={12} />
          </button>
          <div className="flex flex-col items-end gap-1">
            {entry.expired && <span className="badge-danger badge">EXPIRED</span>}
            {groupName && <span className="badge max-w-[120px]"><span className="truncate">{groupName}</span></span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <button className="btn-xs" aria-label="Copy username" title="Copy username" onClick={() => onCopy(entry.username, 'Username')}>
          <UserRound size={12} />
        </button>
        <button className="btn-xs" aria-label="Copy password" title="Copy password" aria-busy={loading} onClick={copyPassword}>
          <LockKeyhole size={12} />
        </button>
        <button className="btn-xs" aria-label="Autofill" onClick={() => sendToSW({ type: 'fillRequest', entryId: entry.id, tabId })}>
          <LogIn size={12} /> Autofill
        </button>
        {entry.hasTotp && (
          <button className="btn-xs" aria-label="Show authenticator code" aria-expanded={showTotp} onClick={() => setShowTotp(s => !s)}>
            <KeyRound size={12} /> Code
          </button>
        )}
        {hasFields && (
          <button className="btn-xs" aria-label="Toggle fields" aria-expanded={open} onClick={() => {
            setOpen(!open);
            if (!open) void loadDetails();
          }}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Fields
          </button>
        )}
      </div>
      {showTotp && entry.hasTotp && <div className="mt-2"><TotpCodeDisplay entryId={entry.id} onCopy={onCopy} /></div>}
      {loading && <p className="mt-2 text-xs" role="status">Loading entry details…</p>}
      {error && <div className="mt-2">
        <p className="alert-error" role="alert">{error}</p>
        <button className="btn-xs" onClick={() => { void loadDetails(); }}>Retry details</button>
      </div>}
      {open && details && <div className="mt-2 space-y-1">
        {details.expires == null && details.fields.length === 0 &&
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No additional details.</p>}
        {details.expires != null && (
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Expires</span>
            <span>{new Date(details.expires).toLocaleDateString()}</span>
          </div>
        )}
        {details.fields.map(f => (
          <div key={f.key} className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-muted)' }}>{f.key}</span>
            <button className="btn-xs" onClick={() => onCopy(f.value, f.key)}>
              <Copy size={12} /> Copy
            </button>
          </div>))}
      </div>}
    </div>
  );
}
