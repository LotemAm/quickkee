import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { EntryView } from '../../shared/entry';

export function EntryEditor({ entryId, clearSecs, onChanged }: { entryId: string; clearSecs: number; onChanged: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  useEffect(() => { sendToSW({ type: 'getEntry', entryId }).then(r => 'entry' in r && setE(r.entry)); }, [entryId]);
  if (!e) return null;
  const field = (label: string, key: 'title' | 'username' | 'url' | 'password') => (
    <div className="mb-3">
      <label className="section-title block">{label}</label>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
        <button className="icon-btn" aria-label={`Copy ${label}`} onClick={() => copyWithClear(e[key], clearSecs)}>
          <Copy size={15} />
        </button>
      </div>
    </div>);
  async function save() {
    await sendToSW({ type: 'updateEntry', entryId,
      fields: { Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password } });
    onChanged();
  }
  return (
    <div className="p-4">
      <div className="card">
        {field('Title', 'title')}
        {field('Username', 'username')}
        {field('Password', 'password')}
        {field('URL', 'url')}
        {e.fields.map(f => (
          <div key={f.key} className="mb-3">
            <label className="section-title block">{f.key}</label>
            <div className="flex gap-2 items-center">
              <span className="flex-1 text-sm" style={{ color: 'var(--text-muted)' }}>{f.value}</span>
              <button className="icon-btn" aria-label={`Copy ${f.key}`} onClick={() => copyWithClear(f.value, clearSecs)}>
                <Copy size={15} />
              </button>
            </div>
          </div>))}
        <button className="btn-primary mt-1" onClick={save}>
          <Check size={15} /> Apply changes
        </button>
      </div>
    </div>);
}
