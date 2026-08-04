import { useState } from 'react';
import { Copy, LogIn, ChevronDown, ChevronUp, PanelRight } from 'lucide-react';
import type { EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';
import { requestOpenEntry } from '../../shared/openEntry';

export function EntryCard({ entry, tabId, onCopy, groupName }: {
  entry: EntryView;
  tabId: number;
  onCopy: (text: string, label: string) => void;
  groupName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card mb-2">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate" style={{ color: 'var(--text)' }}>{entry.title}</div>
          <div className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{entry.username}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {entry.expired && <span className="badge-danger badge">EXPIRED</span>}
          {groupName && <span className="badge max-w-[120px]"><span className="truncate">{groupName}</span></span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <button className="icon-btn-xs" aria-label="Open in sidebar" title="Open in sidebar"
          onClick={() => { requestOpenEntry(entry.id); chrome.sidePanel.open({ tabId }); }}>
          <PanelRight size={12} />
        </button>
        <button className="btn-xs" aria-label="Copy user" onClick={() => onCopy(entry.username, 'Username')}>
          <Copy size={12} /> User
        </button>
        <button className="btn-xs" aria-label="Copy pass" onClick={() => onCopy(entry.password, 'Password')}>
          <Copy size={12} /> Pass
        </button>
        <button className="btn-xs" aria-label="Autofill" onClick={() => sendToSW({ type: 'fillRequest', entryId: entry.id, tabId })}>
          <LogIn size={12} /> Autofill
        </button>
        <button className="btn-xs" aria-label="Toggle fields" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Fields
        </button>
      </div>
      {open && <div className="mt-2 space-y-1">
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
