import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, X, Plus, Trash2 } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import type { EntryView } from '../../shared/entry';
import { useClipboardTimer } from '../../shared/useClipboardTimer';
import { ClipboardBar } from '../../shared/ClipboardBar';

// epoch ms -> 'YYYY-MM-DDTHH:mm' (local) for <input type="datetime-local">
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EntryEditor({ entryId, clearSecs, onChanged, onDeleted }: { entryId: string; clearSecs: number; onChanged: () => void; onDeleted: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [expires, setExpires] = useState<number | null>(null);
  // editable additional fields + the original keys (to compute deletions/renames on save)
  const [custom, setCustom] = useState<{ key: string; value: string }[]>([]);
  const [origKeys, setOrigKeys] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const { copy, state: clipState, cancel } = useClipboardTimer(clearSecs);
  useEffect(() => {
    setShowPass(false);
    setDeleteError('');
    sendToSW({ type: 'getEntry', entryId }).then(r => {
      if ('entry' in r && r.entry) {
        setE(r.entry); setExpires(r.entry.expires);
        setCustom(r.entry.fields.map(f => ({ key: f.key, value: f.value })));
        setOrigKeys(r.entry.fields.map(f => f.key));
      }
    });
  }, [entryId]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!e || !ev.ctrlKey) return;
      const active = document.activeElement;
      const inputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (ev.key === 'c' && !inputFocused && !window.getSelection()?.toString()) {
        ev.preventDefault();
        copy(e.password, 'Password');
      } else if (ev.key === 'b' && !inputFocused) {
        ev.preventDefault();
        copy(e.username, 'Username');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [e, copy]);

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
        <button className="icon-btn"
          aria-label={`Copy ${label}`}
          title={key === 'password' ? `Copy ${label} (Ctrl+C)` : key === 'username' ? `Copy ${label} (Ctrl+B)` : `Copy ${label}`}
          onClick={() => copy(e[key], label)}>
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
  async function del() {
    if (!confirm('Delete this entry?')) return;
    const r = await sendToSW({ type: 'deleteEntry', entryId });
    if (r.ok) onDeleted();
    else setDeleteError(r.error);
  }
  return (
  <div>
    {clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
    <div className="p-4">
      <div className="card">
        {field('Title', 'title')}
        {field('Username', 'username')}
        {field('Password', 'password')}
        {field('URL', 'url')}
        <div className="section-title block">Additional fields</div>
        {custom.map((f, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <input className="input" style={{ flex: '0 0 35%' }} placeholder="Name" value={f.key}
              onChange={ev => setCustom(c => c.map((x, j) => j === i ? { ...x, key: ev.target.value } : x))} />
            <input className="input flex-1" placeholder="Value" value={f.value}
              onChange={ev => setCustom(c => c.map((x, j) => j === i ? { ...x, value: ev.target.value } : x))} />
            <button className="icon-btn" aria-label={`Copy ${f.key}`} title={`Copy ${f.key}`} onClick={() => copy(f.value, f.key || 'Field')}>
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
          <div className="section-title block">Expiry date</div>
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
          <div className="section-title block">Created</div>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {e.created != null ? new Date(e.created).toLocaleString() : '—'}
          </span>
        </div>

        {deleteError && <p className="alert-error mb-3" role="alert">{deleteError}</p>}

        <div className="flex items-center gap-2">
          <button className="btn-primary mt-1" onClick={save}>
            <Check size={15} /> Apply changes
          </button>
          <button className="btn-xs mt-1" aria-label="Delete entry" title="Delete entry"
            style={{ color: 'var(--danger-text)', background: 'var(--danger-tint)' }}
            onClick={del}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  </div>);
}
