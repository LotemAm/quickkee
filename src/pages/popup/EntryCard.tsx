import { useState } from 'react';
import { Copy, LogIn, ChevronDown, ChevronUp, PanelRight, CreditCard, KeyRound, UserRound, LockKeyhole } from 'lucide-react';
import type { EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';
import { requestOpenEntry } from '../../shared/openEntry';
import { maskCardNumber } from '../../shared/cardMask';
import { TotpCodeDisplay } from '../../shared/TotpSetup';

export function EntryCard({ entry, tabId, onCopy, groupName }: {
  entry: EntryView;
  tabId: number;
  onCopy: (text: string, label: string) => void;
  groupName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const hasFields = entry.expires != null || entry.fields.length > 0;
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
        <button className="btn-xs" aria-label="Copy password" title="Copy password" onClick={() => onCopy(entry.password, 'Password')}>
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
          <button className="btn-xs" aria-label="Toggle fields" onClick={() => setOpen(o => !o)}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Fields
          </button>
        )}
      </div>
      {showTotp && entry.hasTotp && <div className="mt-2"><TotpCodeDisplay entryId={entry.id} onCopy={onCopy} /></div>}
      {open && hasFields && <div className="mt-2 space-y-1">
        {entry.expires != null && (
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Expires</span>
            <span>{new Date(entry.expires).toLocaleDateString()}</span>
          </div>
        )}
        {entry.fields.map(f => (
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
