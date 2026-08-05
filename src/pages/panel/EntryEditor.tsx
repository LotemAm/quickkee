import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, X, Plus, Trash2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { CARD_FLAG_KEY, CARDHOLDER_NAME_KEY, type EntryView } from '../../shared/entry';
import type { PwGenOpts } from '../../shared/pwgen';
import { useClipboardTimer } from '../../shared/useClipboardTimer';
import { ClipboardBar } from '../../shared/ClipboardBar';
import { PasswordRulesPanel } from '../../shared/PasswordRulesPanel';

// epoch ms -> 'YYYY-MM-DDTHH:mm' (local) for <input type="datetime-local">
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EntryEditor({ entryId, clearSecs, pwgen, onChanged, onDeleted }: { entryId: string; clearSecs: number; pwgen: PwGenOpts; onChanged: () => void; onDeleted: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [expires, setExpires] = useState<number | null>(null);
  // editable additional fields + the original keys (to compute deletions/renames on save)
  const [custom, setCustom] = useState<{ key: string; value: string }[]>([]);
  const [origKeys, setOrigKeys] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const [opts, setOpts] = useState<PwGenOpts>(pwgen);
  const [showRules, setShowRules] = useState(false);
  const [isCard, setIsCard] = useState(false);
  const [cardholderName, setCardholderName] = useState('');
  const noClass = !opts.lower && !opts.upper && !opts.digits && !opts.symbols;
  const { copy, state: clipState, cancel } = useClipboardTimer(clearSecs);
  useEffect(() => {
    setShowPass(false);
    setShowCardNumber(false);
    setDeleteError('');
    setOpts(pwgen);
    setShowRules(false);
    setIsCard(false);
    setCardholderName('');
    sendToSW({ type: 'getEntry', entryId }).then(r => {
      if (r.ok && r.entry) {
        setE(r.entry); setExpires(r.entry.expires);
        setIsCard(r.entry.isCard);
        setCardholderName(r.entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '');
        setCustom(r.entry.fields.filter(f => f.key !== CARDHOLDER_NAME_KEY).map(f => ({ key: f.key, value: f.value })));
        setOrigKeys(r.entry.fields.map(f => f.key));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Card Number (username, when isCard) gets the same mask/reveal UX as Password/CVV, but
    // uses its own reveal state so toggling one never reveals the other.
    const masked = secret || (isCard && key === 'username');
    const showThis = secret ? showPass : showCardNumber;
    const setShowThis = secret ? setShowPass : setShowCardNumber;
    return (
    <div className="mb-3">
      <label className="section-title block">{label}</label>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" type={masked && !showThis ? 'password' : 'text'} value={e[key]} onChange={ev => setE({ ...e, [key]: ev.target.value })} />
        {masked && (
          <button className="icon-btn" aria-label={showThis ? `Hide ${label}` : `Show ${label}`} title={showThis ? `Hide ${label}` : `Show ${label}`} onClick={() => setShowThis(s => !s)}>
            {showThis ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        {key === 'password' && (
          <button className="icon-btn" aria-label="Generate password" title="Generate password"
            disabled={noClass}
            onClick={() => sendToSW({ type: 'generatePassword', opts }).then(r => {
              if (r.ok) { setE({ ...e, password: r.password }); setShowPass(true); }
            })}>
            <RefreshCw size={14} />
          </button>
        )}
        {secret && !isCard && (
          <button className="icon-btn" aria-label="Password rules" title="Password rules (this session)"
            onClick={() => setShowRules(s => !s)}>
            <SlidersHorizontal size={14} />
          </button>
        )}
        <button className="icon-btn"
          aria-label={`Copy ${label}`}
          title={key === 'password' ? `Copy ${label} (Ctrl+C)` : key === 'username' ? `Copy ${label} (Ctrl+B)` : `Copy ${label}`}
          onClick={() => copy(e[key], label)}>
          <Copy size={15} />
        </button>
      </div>
      {secret && !isCard && showRules && (
        <div className="mt-2"><PasswordRulesPanel opts={opts} onChange={setOpts} /></div>
      )}
    </div>);
  };
  async function save() {
    const fields: Record<string, string> = {
      Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password,
      [CARD_FLAG_KEY]: isCard ? '1' : '',
    };
    const keptKeys = new Set<string>();
    for (const f of custom) {
      const k = f.key.trim();
      if (k && !['Title', 'UserName', 'URL', 'Password', 'Notes', CARDHOLDER_NAME_KEY].includes(k)) { fields[k] = f.value; keptKeys.add(k); }
    }
    const name = cardholderName.trim();
    if (name) { fields[CARDHOLDER_NAME_KEY] = name; keptKeys.add(CARDHOLDER_NAME_KEY); }
    const removeKeys = origKeys.filter(k => !keptKeys.has(k));
    await sendToSW({ type: 'updateEntry', entryId, fields, expires, removeKeys });
    // Sync origKeys to what was just persisted: Apply Changes doesn't trigger a
    // getEntry refetch (onChanged only reloads the tree), so without this a field
    // added on one Apply-changes click can never be removed by a later one — its
    // key never enters `fields` (once cleared) nor `removeKeys` (stale origKeys).
    setOrigKeys([...keptKeys]);
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
        <div className="mb-3">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input type="checkbox" checked={isCard} onChange={ev => setIsCard(ev.target.checked)} />
            Mark as credit card data
          </label>
        </div>
        {field(isCard ? 'Card Number' : 'Username', 'username')}
        {field(isCard ? 'CVV' : 'Password', 'password')}
        {isCard && (
          <div className="mb-3">
            <label className="section-title block" htmlFor="cardholder-name">Cardholder Name</label>
            <input id="cardholder-name" className="input w-full" aria-label="Cardholder Name" value={cardholderName}
              onChange={ev => setCardholderName(ev.target.value)} />
          </div>
        )}
        {!isCard && field('URL', 'url')}
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
          <div className="section-title block">{isCard ? 'Card Expiry' : 'Expiry date'}</div>
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
