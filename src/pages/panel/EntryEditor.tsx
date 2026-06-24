import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, X, Plus, Trash2 } from 'lucide-react';
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
  // editable additional fields + the original keys (to compute deletions/renames on save)
  const [custom, setCustom] = useState<{ key: string; value: string }[]>([]);
  const [origKeys, setOrigKeys] = useState<string[]>([]);
  useEffect(() => {
    setShowPass(false);
    sendToSW({ type: 'getEntry', entryId }).then(r => {
      if ('entry' in r && r.entry) {
        setE(r.entry); setExpires(r.entry.expires);
        setCustom(r.entry.fields.map(f => ({ key: f.key, value: f.value })));
        setOrigKeys(r.entry.fields.map(f => f.key));
      }
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
          <button className="icon-btn" aria-label={showPass ? 'Hide password' : 'Show password'} title={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(s => !s)}>
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        <button className="icon-btn" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => copyWithClear(e[key], clearSecs)}>
          <Copy size={15} />
        </button>
      </div>
    </div>);
  };
  async function save() {
    const fields: Record<string, string> = { Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password };
    const keptKeys = new Set<string>();
    for (const f of custom) {
      const k = f.key.trim();
      if (k && !['Title', 'UserName', 'URL', 'Password', 'Notes'].includes(k)) { fields[k] = f.value; keptKeys.add(k); }
    }
    const removeKeys = origKeys.filter(k => !keptKeys.has(k));
    await sendToSW({ type: 'updateEntry', entryId, fields, expires, removeKeys });
    onChanged();
  }
  return (
    <div className="p-4">
      <div className="card">
        {field('Title', 'title')}
        {field('Username', 'username')}
        {field('Password', 'password')}
        {field('URL', 'url')}
        <label className="section-title block">Additional fields</label>
        {custom.map((f, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <input className="input" style={{ flex: '0 0 35%' }} placeholder="Name" value={f.key}
              onChange={ev => setCustom(c => c.map((x, j) => j === i ? { ...x, key: ev.target.value } : x))} />
            <input className="input flex-1" placeholder="Value" value={f.value}
              onChange={ev => setCustom(c => c.map((x, j) => j === i ? { ...x, value: ev.target.value } : x))} />
            <button className="icon-btn" aria-label={`Copy ${f.key}`} title={`Copy ${f.key}`} onClick={() => copyWithClear(f.value, clearSecs)}>
              <Copy size={15} />
            </button>
            <button className="icon-btn" aria-label="Remove field" title="Remove field" onClick={() => setCustom(c => c.filter((_, j) => j !== i))}>
              <Trash2 size={15} />
            </button>
          </div>))}
        <button className="btn-xs mb-3" aria-label="Add field" title="Add field" onClick={() => setCustom(c => [...c, { key: '', value: '' }])}>
          <Plus size={14} /> Add field
        </button>

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
              <button className="icon-btn" aria-label="Clear expiry" title="Clear expiry" onClick={() => setExpires(null)}>
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
