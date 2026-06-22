import { useEffect, useState } from 'react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { EntryView } from '../../shared/entry';

export function EntryEditor({ entryId, clearSecs, onChanged }: { entryId: string; clearSecs: number; onChanged: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  useEffect(() => { sendToSW({ type: 'getEntry', entryId }).then(r => 'entry' in r && setE(r.entry)); }, [entryId]);
  if (!e) return null;
  const field = (label: string, key: 'title' | 'username' | 'url' | 'password') => (
    <div className="flex gap-2 items-center my-1">
      <label className="w-20 text-sm">{label}</label>
      <input className="input flex-1" value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
      <button className="btn-xs" onClick={() => copyWithClear(e[key], clearSecs)}>Copy</button>
    </div>);
  async function save() {
    await sendToSW({ type: 'updateEntry', entryId,
      fields: { Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password } });
    onChanged();
  }
  return (<div className="p-3">
    {field('Title', 'title')}{field('Username', 'username')}
    {field('Password', 'password')}{field('URL', 'url')}
    {e.fields.map(f => (
      <div key={f.key} className="flex gap-2 items-center my-1">
        <label className="w-20 text-sm">{f.key}</label>
        <span className="flex-1 text-sm">{f.value}</span>
        <button className="btn-xs" onClick={() => copyWithClear(f.value, clearSecs)}>Copy</button>
      </div>))}
    <button className="btn-primary mt-2" onClick={save}>Apply changes</button>
  </div>);
}
