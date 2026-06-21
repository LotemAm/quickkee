import { useState } from 'react';
import type { EntryView } from '../../shared/entry';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';

export function EntryCard({ entry, tabId, clearSecs }: { entry: EntryView; tabId: number; clearSecs: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded p-2 mb-2">
      <div className="flex justify-between items-center">
        <div><div className="font-medium">{entry.title}</div>
          <div className="text-sm opacity-70">{entry.username}</div></div>
        {entry.expired && <span className="text-xs text-red-600 border border-red-600 px-1 rounded">EXPIRED</span>}
      </div>
      <div className="flex gap-1 mt-1">
        <button className="btn-xs" onClick={() => copyWithClear(entry.username, clearSecs)}>Copy user</button>
        <button className="btn-xs" onClick={() => copyWithClear(entry.password, clearSecs)}>Copy pass</button>
        <button className="btn-xs" onClick={() => sendToSW({ type: 'fillRequest', entryId: entry.id, tabId })}>Autofill</button>
        <button className="btn-xs" onClick={() => setOpen(o => !o)}>{open ? '▲' : '▼'} Fields</button>
      </div>
      {open && <div className="mt-2 space-y-1">
        {entry.fields.map(f => (
          <div key={f.key} className="flex justify-between text-sm">
            <span className="opacity-70">{f.key}</span>
            <button className="btn-xs" onClick={() => copyWithClear(f.value, clearSecs)}>Copy</button>
          </div>))}
      </div>}
    </div>
  );
}
