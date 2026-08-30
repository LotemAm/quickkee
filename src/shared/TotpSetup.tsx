import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Eye, EyeOff, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { parseTotpInput, toOtpUri, type TotpConfig, type TotpCode } from '../background/totp';
import { sendToSW } from './messages';

export function TotpCodeDisplay({ entryId, config, onCopy }: {
  entryId?: string;
  config?: TotpConfig | null;
  onCopy: (code: string, label: string) => void;
}) {
  const [value, setValue] = useState<TotpCode | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [refreshKey, setRefreshKey] = useState(0);
  const requestedExpiry = useRef<number | null>(null);

  const request = useCallback(async () => {
    return config
      ? await sendToSW({ type: 'previewTotp', config })
      : entryId ? await sendToSW({ type: 'getTotpCode', entryId }) : null;
  }, [config, entryId]);

  useEffect(() => {
    let ignore = false;
    void request().then(result => {
      if (ignore || !result) return;
      if (result.ok) { requestedExpiry.current = null; setValue(result); setError(''); setNow(Date.now()); }
      else { setValue(null); setError(result.error); }
    });
    return () => { ignore = true; };
  }, [refreshKey, request]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (value && now >= value.expiresAt && requestedExpiry.current !== value.expiresAt) {
      requestedExpiry.current = value.expiresAt;
      setRefreshKey(key => key + 1);
    }
  }, [now, value]);

  if (error) return <p className="alert-error" role="alert">{error}</p>;
  if (!value) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading code…</span>;

  const seconds = Math.max(0, Math.ceil((value.expiresAt - now) / 1000));
  const width = Math.max(0, Math.min(100, ((value.expiresAt - now) / (value.period * 1000)) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg tracking-widest" aria-label={`Current TOTP code ${value.code}`}>{value.code}</span>
        <button className="icon-btn" aria-label="Copy TOTP code" title="Copy TOTP code"
          onClick={() => onCopy(value.code, 'Authenticator code')}>
          <Copy size={15} />
        </button>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{seconds}s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--btn-bg)' }}
        role="progressbar" aria-label="TOTP time remaining" aria-valuemin={0} aria-valuemax={value.period} aria-valuenow={seconds}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: 'var(--primary)' }} />
      </div>
    </div>
  );
}

export function TotpSetup({ initialConfig, issuer, account, onChange, resetKey, showPreview = false, onCopy, compact = false, inputAction }: {
  initialConfig: TotpConfig | null;
  issuer: string;
  account: string;
  onChange: (config: TotpConfig | null, error: string | null) => void;
  resetKey?: string | number | null;
  showPreview?: boolean;
  onCopy?: (code: string, label: string) => void;
  compact?: boolean;
  inputAction?: ReactNode;
}) {
  const [input, setInput] = useState(() => initialConfig ? toOtpUri(initialConfig) : '');
  const [config, setConfig] = useState<TotpConfig | null>(initialConfig);
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    setInput(initialConfig ? toOtpUri(initialConfig) : '');
    setConfig(initialConfig);
    setError('');
    setShowSecret(false);
    setAdvanced(false);
  }, [initialConfig, resetKey]);

  function changeInput(value: string) {
    setInput(value);
    if (!value.trim()) {
      setConfig(null); setError(''); onChange(null, null); return;
    }
    try {
      const next = parseTotpInput(value, { issuer: issuer.trim(), account: account.trim() });
      setConfig(next); setError(''); onChange(next, null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid TOTP configuration';
      setConfig(null); setError(message); onChange(null, message);
    }
  }

  function updateConfig(next: TotpConfig) {
    setConfig(next); setInput(toOtpUri(next)); setError(''); onChange(next, null);
  }

  const setupInput = (
    <>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" type={showSecret ? 'text' : 'password'} value={input}
          aria-label="TOTP setup key or URI" aria-invalid={!!error}
          placeholder="Setup key or otpauth:// URI" onChange={ev => changeInput(ev.target.value)} />
        {inputAction}
        <button className="icon-btn" aria-label={showSecret ? 'Hide TOTP secret' : 'Show TOTP secret'}
          title={showSecret ? 'Hide TOTP secret' : 'Show TOTP secret'} onClick={() => setShowSecret(s => !s)}>
          {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        {input && (
          <button className="icon-btn" aria-label="Remove TOTP" title="Remove TOTP" onClick={() => {
            changeInput('');
            if (compact) setAdvanced(false);
          }}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {error && <p className="alert-error" role="alert">{error}</p>}
    </>
  );

  const advancedSettings = config && (
    <div className="grid grid-cols-3 gap-2">
      <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Algorithm
        <select className="input mt-1" value={config.algorithm}
          onChange={ev => updateConfig({ ...config, algorithm: ev.target.value as TotpConfig['algorithm'] })}>
          <option value="SHA1">SHA-1</option><option value="SHA256">SHA-256</option><option value="SHA512">SHA-512</option>
        </select>
      </label>
      <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Digits
        <select className="input mt-1" value={config.digits}
          onChange={ev => updateConfig({ ...config, digits: Number(ev.target.value) })}>
          <option value={6}>6</option><option value={7}>7</option><option value={8}>8</option>
        </select>
      </label>
      <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Period
        <input className="input mt-1" type="number" min={1} max={86400} value={config.period}
          onChange={ev => {
            const period = Number(ev.target.value);
            if (Number.isInteger(period) && period >= 1 && period <= 86400) updateConfig({ ...config, period });
          }} />
      </label>
    </div>
  );

  if (compact) {
    return (
      <div className="mb-3 space-y-2">
        {!config && !advanced ? (
          <button className="btn-xs" aria-label="Add Authenticator code" onClick={() => setAdvanced(true)}>
            <Plus size={14} /> Add Authenticator code
          </button>
        ) : (
          <>
            {config && showPreview && onCopy && <TotpCodeDisplay config={config} onCopy={onCopy} />}
            {config && (
              <button className="btn-xs" aria-expanded={advanced} onClick={() => setAdvanced(s => !s)}>
                <SlidersHorizontal size={13} /> TOTP settings
              </button>
            )}
            {advanced && (
              <div className="space-y-2">
                <div className="section-title block">Authenticator code (optional)</div>
                {setupInput}
                {advancedSettings}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="section-title block">Authenticator code (optional)</div>
      {setupInput}
      {config && (
        <>
          <button className="btn-xs" aria-expanded={advanced} onClick={() => setAdvanced(s => !s)}>
            <SlidersHorizontal size={13} /> TOTP settings
          </button>
          {advanced && advancedSettings}
          {showPreview && onCopy && <TotpCodeDisplay config={config} onCopy={onCopy} />}
        </>
      )}
    </div>
  );
}
