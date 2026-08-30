import { useEffect, useState } from 'react';
import { Check, ShieldCheck, Monitor, Sun, Moon } from 'lucide-react';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { applyTheme, type ThemeMode } from '../../shared/theme';
import { sendToSW } from '../../shared/messages';
import { PasswordRulesPanel } from '../../shared/PasswordRulesPanel';
import type { QuickUnlockStatus } from '../../shared/quickUnlock';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const CLOUD_PROVIDERS = [
  { id: 'dropbox', label: 'Dropbox' },
  { id: 'gdrive', label: 'Google Drive' },
] as const;
type CloudProviderId = typeof CLOUD_PROVIDERS[number]['id'];
type ConnectionState = Record<CloudProviderId, boolean>;

export function Options() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [connected, setConnected] = useState<ConnectionState>({ dropbox: false, gdrive: false });
  const [busyProvider, setBusyProvider] = useState<CloudProviderId | null>(null);
  const [signedOutProvider, setSignedOutProvider] = useState<CloudProviderId | null>(null);
  const [quickUnlock, setQuickUnlock] = useState<QuickUnlockStatus | null>(null);
  const [quickUnlockBusy, setQuickUnlockBusy] = useState(false);
  const [quickUnlockNotice, setQuickUnlockNotice] = useState('');
  useEffect(() => {
    loadSettings().then(v => { setS(v); applyTheme(v.theme); });
    sendToSW({ type: 'getCloudConnectionStatus' }).then(response => {
      if (response.ok) setConnected(response.connected);
    });
    sendToSW({ type: 'getQuickUnlockStatus' }).then(response => {
      if (response.ok) setQuickUnlock(response);
    });
  }, []);
  const update = (patch: Partial<Settings>) => { const next = { ...s, ...patch };
    setS(next); applyTheme(next.theme); void saveSettings(next); };

  async function connect(provider: CloudProviderId) {
    setBusyProvider(provider);
    setSignedOutProvider(null);
    try {
      const response = await sendToSW({ type: 'connectCloud', provider });
      if (response.ok) setConnected(current => ({ ...current, [provider]: true }));
    } finally { setBusyProvider(null); }
  }

  async function signOut(provider: CloudProviderId) {
    const removesQuickUnlock = quickUnlock?.corrupt === true || (quickUnlock?.enrolled === true
      && quickUnlock.source?.kind === 'cloud'
      && quickUnlock.source.provider === provider);
    if (removesQuickUnlock && !window.confirm(
      `Disconnect ${provider === 'dropbox' ? 'Dropbox' : 'Google Drive'} and remove ${quickUnlock?.corrupt
        ? 'the damaged device quick-unlock enrollment'
        : `device quick unlock for “${quickUnlock?.source?.label}”`}?`,
    )) return;
    setBusyProvider(provider);
    setSignedOutProvider(null);
    try {
      const response = await sendToSW({
        type: 'disconnectCloud', provider, ...(removesQuickUnlock ? { removeQuickUnlock: true } : {}),
      });
      if (response.ok) {
        setConnected(current => ({ ...current, [provider]: false }));
        setSignedOutProvider(provider);
        if (removesQuickUnlock) setQuickUnlock({ enrolled: false, corrupt: false, source: null });
      }
    } finally { setBusyProvider(null); }
  }

  async function disableQuickUnlock() {
    if (!window.confirm('Disable device quick unlock on this device? Manual unlock will remain available.')) return;
    setQuickUnlockBusy(true); setQuickUnlockNotice('');
    try {
      const response = await sendToSW({ type: 'disableQuickUnlock' });
      if (response.ok) {
        setQuickUnlock({ enrolled: false, corrupt: false, source: null });
        setQuickUnlockNotice('Device quick unlock disabled');
      } else setQuickUnlockNotice('Could not disable device quick unlock.');
    } finally { setQuickUnlockBusy(false); }
  }

  return (
    <div className="min-h-screen">
      <header className="app-header">
        <span className="app-title"><ShieldCheck size={18} className="app-logo" /> QuickKee Settings</span>
      </header>
      <div className="p-6 max-w-md mx-auto space-y-4">
        <section className="card space-y-3">
          <div className="section-title">Appearance</div>
          <div className="segmented" role="group" aria-label="Theme">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" className="segmented-item"
                aria-pressed={s.theme === value} onClick={() => update({ theme: value })}>
                <Icon size={14} /> {label}
              </button>))}
          </div>
        </section>

        <section className="card space-y-3">
          <div className="section-title">Security</div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Auto-close after
            <select className="input w-auto" value={s.autoCloseHours}
              onChange={e => update({ autoCloseHours: Number(e.target.value) })}>
              {[1, 2, 4, 8, 24].map(h => <option key={h} value={h}>{h} hour(s)</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Clipboard auto-clear
            <select className="input w-auto" value={s.clipboardClearSeconds}
              onChange={e => update({ clipboardClearSeconds: Number(e.target.value) })}>
              {[0, 15, 30, 60].map(x => <option key={x} value={x}>{x === 0 ? 'never' : `${x}s`}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Offer to save submitted credentials
            <input type="checkbox" checked={s.offerToSaveCredentials}
              onChange={e => update({ offerToSaveCredentials: e.target.checked })} />
          </label>
          <div className="space-y-2 rounded-md p-2" style={{ background: 'var(--surface-2, var(--bg))' }}>
            <div className="text-sm">Device quick unlock</div>
            {quickUnlock?.enrolled && quickUnlock.source ? (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                <div>{quickUnlock.source.label}</div>
                <div>{quickUnlock.source.kind === 'local'
                  ? 'Local vault'
                  : `${quickUnlock.source.provider === 'dropbox' ? 'Dropbox' : 'Google Drive'} vault`}</div>
              </div>
            ) : quickUnlock?.corrupt ? (
              <p className="alert-error">Enrollment data is damaged. Reset it to use quick unlock again.</p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not enrolled</p>
            )}
            {(quickUnlock?.enrolled || quickUnlock?.corrupt) && (
              <button className="btn-secondary" disabled={quickUnlockBusy}
                onClick={() => { void disableQuickUnlock(); }}>
                {quickUnlockBusy ? 'Disabling…' : 'Disable device quick unlock'}
              </button>
            )}
            {quickUnlockNotice && (
              <span role="status" aria-label={quickUnlockNotice} className="account-success">{quickUnlockNotice}</span>
            )}
          </div>
        </section>

        <section className="card space-y-3">
          <div className="section-title">Connected accounts</div>
          {CLOUD_PROVIDERS.map(({ id, label }) => (
            <div key={id} className="account-row">
              <span>{label}</span>
              <div className="account-actions">
                {signedOutProvider === id && (
                  <span className="account-success" role="status"><Check size={12} /> Signed out</span>
                )}
                {connected[id] ? (
                  <span className="connected-pill" aria-label={`${label} connected`}><Check size={12} /> Connected</span>
                ) : (
                  <button className="btn" disabled={busyProvider === id} onClick={() => { void connect(id); }}>
                    {busyProvider === id ? 'Connecting…' : 'Connect'}
                  </button>
                )}
                <button className="btn-secondary" disabled={!connected[id] || busyProvider === id}
                  onClick={() => { void signOut(id); }}>
                  {busyProvider === id && connected[id] ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          ))}
        </section>

        <section className="card space-y-3">
          <div className="section-title">Default generated password</div>
          <PasswordRulesPanel opts={s.pwgen} onChange={pwgen => update({ pwgen })} />
        </section>
      </div>
    </div>);
}
