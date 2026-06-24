import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, X } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { copyWithClear } from '../../shared/clipboard';
import type { EntryView } from '../../shared/entry';

// epoch ms -> 'YYYY-MM-DDTHH:mm' (local) for <input type="datetime-local">
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EntryEditor({ entryId, clearSecs, onChanged }: { entryId: string; clearSecs: number; onChanged: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [expires, setExpires] = useState<number | null>(null);
  useEffect(() => {
    setShowPass(false);
    sendToSW({ type: 'getEntry', entryId }).then(r => {
      if ('entry' in r && r.entry) { setE(r.entry); setExpires(r.entry.expires); }
    });
  }, [entryId]);
  if (!e) return null;
  const field = (label: string, key: 'title' | 'username' | 'url' | 'password') => {
    const secret = key === 'password';
    return (
    <div className="mb-3">
      <label className="section-title block">{label}</label>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" type={secret && !showPass ? 'password' : 'text'} value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
        {secret && (
          <button className="icon-btn" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(s => !s)}>
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        <button className="icon-btn" aria-label={`Copy ${label}`} onClick={() => copyWithClear(e[key], clearSecs)}>
          <Copy size={15} />
        </button>
      </div>
    </div>);
  };
  async function save() {
    await sendToSW({ type: 'updateEntry', entryId,
      fields: { Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password },
      expires });
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

        <div className="mb-3">
          <label className="section-title block">Expiry date</label>
          <div className="flex gap-2 items-center">
            <input className="input flex-1" type="datetime-local"
              value={expires != null ? toLocalInput(expires) : ''}
              onChange={ev => {
                const v = ev.target.value;
                setExpires(v ? new Date(v).getTime() : null);
              }} />
            {expires != null && (
              <button className="icon-btn" aria-label="Clear expiry" onClick={() => setExpires(null)}>
                <X size={15} />
              </button>)}
          </div>
        </div>

        <div className="mb-3">
          <label className="section-title block">Created</label>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {e.created != null ? new Date(e.created).toLocaleString() : '—'}
          </span>
        </div>

        <button className="btn-primary mt-1" onClick={save}>
          <Check size={15} /> Apply changes
        </button>
      </div>
    </div>);
}
