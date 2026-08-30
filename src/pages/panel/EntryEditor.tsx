import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Eye, EyeOff, X, Plus, Trash2, RefreshCw, SlidersHorizontal, Paperclip, Download, ChevronDown, QrCode, Loader2 } from 'lucide-react';
import { sendToSW } from '../../shared/messages';
import { CARD_FLAG_KEY, CARDHOLDER_NAME_KEY, type EntryView, type AttachmentMeta } from '../../shared/entry';
import type { PwGenOpts } from '../../shared/pwgen';
import { useClipboardTimer } from '../../shared/useClipboardTimer';
import { ClipboardBar } from '../../shared/ClipboardBar';
import { PasswordRulesPanel } from '../../shared/PasswordRulesPanel';
import { arrayBufferToBase64, formatBytes } from '../../shared/bytes';
import { downloadAttachment } from '../../shared/attachments';
import { TotpSetup } from '../../shared/TotpSetup';
import type { TotpConfig } from '../../background/totp';
import { IconTooltipButton } from '../../shared/IconTooltipButton';
import { scanVisibleTabForTotp } from '../popup/scanVisibleTabForTotp';

// epoch ms -> 'YYYY-MM-DDTHH:mm' (local) for <input type="datetime-local">
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const BLANK_ENTRY: EntryView = {
  id: '', title: '', username: '', url: '', password: '',
  fields: [], expired: false, created: null, expires: null, isCard: false,
  hasTotp: false, totpPeriod: null, attachments: [],
};

export function EntryEditor({ entryId, groupId, clearSecs, pwgen, onChanged, onCreated, onDeleted }: { entryId: string | null; groupId?: string; clearSecs: number; pwgen: PwGenOpts; onChanged: () => void; onCreated?: (entryId: string) => void; onDeleted: () => void }) {
  const [e, setE] = useState<EntryView | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [expires, setExpires] = useState<number | null>(null);
  // editable additional fields + the original keys (to compute deletions/renames on save)
  const [custom, setCustom] = useState<{ key: string; value: string }[]>([]);
  const [origKeys, setOrigKeys] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [opts, setOpts] = useState<PwGenOpts>(pwgen);
  const [showRules, setShowRules] = useState(false);
  const [isCard, setIsCard] = useState(false);
  const [cardholderName, setCardholderName] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [attachError, setAttachError] = useState('');
  const [initialTotp, setInitialTotp] = useState<TotpConfig | null>(null);
  const [totp, setTotp] = useState<TotpConfig | null>(null);
  const [totpError, setTotpError] = useState('');
  const [scanningTotp, setScanningTotp] = useState(false);
  const [scanTotpError, setScanTotpError] = useState('');
  const scanVersionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noClass = !opts.lower && !opts.upper && !opts.digits && !opts.symbols;
  const { copy, state: clipState, cancel } = useClipboardTimer(clearSecs);
  useEffect(() => {
    setShowPass(false);
    setShowCardNumber(false);
    setDeleteError('');
    setSaveError('');
    setOpts(pwgen);
    setShowRules(false);
    setIsCard(false);
    setCardholderName('');
    setAttachError('');
    setInitialTotp(null);
    setTotp(null);
    setTotpError('');
    setScanningTotp(false);
    setScanTotpError('');
    scanVersionRef.current += 1;
    if (entryId === null) {
      setE(BLANK_ENTRY); setExpires(null); setCustom([]); setOrigKeys([]); setAttachments([]);
      return;
    }
    sendToSW({ type: 'getEntry', entryId }).then(r => {
      if (r.ok && r.entry) {
        setE(r.entry); setExpires(r.entry.expires);
        setIsCard(r.entry.isCard);
        setCardholderName(r.entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '');
        setCustom(r.entry.fields.filter(f => f.key !== CARDHOLDER_NAME_KEY).map(f => ({ key: f.key, value: f.value })));
        setOrigKeys(r.entry.fields.map(f => f.key));
        setAttachments(r.entry.attachments);
      }
    });
    sendToSW({ type: 'getTotpConfig', entryId }).then(r => {
      if (r.ok) { setInitialTotp(r.config); setTotp(r.config); }
      else setTotpError(r.error);
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
  async function scanPageQr() {
    if (scanningTotp) return;
    const scanVersion = ++scanVersionRef.current;
    setScanningTotp(true);
    setScanTotpError('');
    try {
      const result = await scanVisibleTabForTotp();
      if (scanVersion !== scanVersionRef.current) return;
      setInitialTotp(result.config);
      setTotp(result.config);
      setTotpError('');
    } catch (error) {
      if (scanVersion === scanVersionRef.current) {
        setScanTotpError(error instanceof Error ? error.message : 'Could not scan the visible page. Try again.');
      }
    } finally {
      if (scanVersion === scanVersionRef.current) setScanningTotp(false);
    }
  }
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
    if (entryId === null) {
      const r = await sendToSW({ type: 'createEntry', groupId: groupId!, fields, ...(totp ? { totp } : {}) });
      if (r.ok) onCreated?.(r.entryId);
      else setSaveError(r.error);
      return;
    }
    const removeKeys = origKeys.filter(k => !keptKeys.has(k));
    const result = await sendToSW({ type: 'updateEntry', entryId, fields, expires, removeKeys, totp });
    if (!result.ok) { setSaveError(result.error); return; }
    // Sync origKeys to what was just persisted: Apply Changes doesn't trigger a
    // getEntry refetch (onChanged only reloads the tree), so without this a field
    // added on one Apply-changes click can never be removed by a later one — its
    // key never enters `fields` (once cleared) nor `removeKeys` (stale origKeys).
    setOrigKeys([...keptKeys]);
    onChanged();
  }
  async function del() {
    if (entryId === null) return;
    if (!confirm('Delete this entry?')) return;
    const r = await sendToSW({ type: 'deleteEntry', entryId });
    if (r.ok) onDeleted();
    else setDeleteError(r.error);
  }
  async function onFilePicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || entryId === null) return;
    setAttachError('');
    const data = arrayBufferToBase64(await file.arrayBuffer());
    const r = await sendToSW({ type: 'addAttachment', entryId, name: file.name, data });
    if (r.ok) {
      setAttachments(a => [...a.filter(x => x.name !== file.name), { name: file.name, size: file.size }]);
      onChanged();
    } else setAttachError(r.error);
  }
  async function removeAttachment(name: string) {
    if (entryId === null) return;
    if (!confirm(`Remove attachment "${name}"?`)) return;
    const r = await sendToSW({ type: 'removeAttachment', entryId, name });
    if (r.ok) { setAttachments(a => a.filter(x => x.name !== name)); onChanged(); }
    else setAttachError(r.error);
  }
  return (
  <div>
    {clipState && <ClipboardBar state={clipState} onCancel={cancel} />}
    <div className="p-4">
      <div className="card">
        {field('Title', 'title')}
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
        <TotpSetup compact initialConfig={initialTotp} issuer={e.title} account={e.username} resetKey={entryId}
          inputAction={(
            <IconTooltipButton label={scanningTotp ? 'Scanning visible page' : 'Scan page QR'}
              tooltipTitle="Scan page QR" tooltipDescription="Scan the visible tab locally."
              disabled={scanningTotp} onClick={() => { void scanPageQr(); }}>
              {scanningTotp ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
            </IconTooltipButton>
          )}
          onChange={(config, error) => { setTotp(config); setTotpError(error ?? ''); }}
          showPreview onCopy={copy} />
        {scanTotpError && <p className="alert-error mb-3" role="alert">{scanTotpError}</p>}
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

        <details key={entryId ?? 'new'} className="group mb-3 overflow-hidden rounded-lg border"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--btn-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
            <span>More</span>
            <span className="ml-auto flex items-center gap-2">
              {attachments.length > 0 && (
                <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                  {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}
                </span>
              )}
              <ChevronDown size={15} className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
                style={{ color: 'var(--text-muted)' }} />
            </span>
          </summary>
          <div className="space-y-4 border-t px-3 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
              <input className="h-4 w-4 accent-[var(--primary)]" type="checkbox" checked={isCard}
                onChange={ev => setIsCard(ev.target.checked)} />
              Mark as credit card data
            </label>

            <section aria-labelledby="attachments-heading">
              <div id="attachments-heading" className="section-title block">Attachments</div>
              {attachments.map(a => (
                <div key={a.name} className="flex gap-2 items-center mb-2">
                  <Paperclip size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="flex-1 truncate text-sm">{a.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatBytes(a.size)}</span>
                  <button className="icon-btn" aria-label={`Download ${a.name}`} title="Download"
                    onClick={() => downloadAttachment(entryId!, a.name).then(err => { if (err) setAttachError(err); })}>
                    <Download size={15} />
                  </button>
                  <button className="icon-btn" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => removeAttachment(a.name)}>
                    <Trash2 size={15} />
                  </button>
                </div>))}
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />
              <button className="btn-xs" aria-label="Add attachment"
                title={entryId === null ? 'Save the entry first' : 'Add attachment'}
                disabled={entryId === null} onClick={() => fileInputRef.current?.click()}>
                <Plus size={14} /> Add attachment
              </button>
              {attachError && <p className="alert-error mt-2" role="alert">{attachError}</p>}
            </section>
          </div>
        </details>

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
        {saveError && <p className="alert-error mb-3" role="alert">{saveError}</p>}

        <div className="flex items-center gap-2">
          <button className="btn-primary mt-1" disabled={!!totpError} onClick={save}>
            <Check size={15} /> {entryId === null ? 'Create' : 'Apply changes'}
          </button>
          {entryId !== null && (
            <button className="btn-xs mt-1" aria-label="Delete entry" title="Delete entry"
              style={{ color: 'var(--danger-text)', background: 'var(--danger-tint)' }}
              onClick={del}>
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  </div>);
}
