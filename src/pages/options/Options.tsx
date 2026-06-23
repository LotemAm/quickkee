import { useEffect, useState } from 'react';
import { ShieldCheck, Monitor, Sun, Moon } from 'lucide-react';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { applyTheme, type ThemeMode } from '../../shared/theme';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function Options() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { loadSettings().then(v => { setS(v); applyTheme(v.theme); }); }, []);
  const update = (patch: Partial<Settings>) => { const next = { ...s, ...patch };
    setS(next); applyTheme(next.theme); void saveSettings(next); };
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
        </section>

        <section className="card space-y-3">
          <div className="section-title">Default generated password</div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Length
            <input type="number" className="input w-20" value={s.pwgen.length}
              onChange={e => update({ pwgen: { ...s.pwgen, length: Math.max(1, Number(e.target.value) || 1) } })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['lower', 'upper', 'digits', 'symbols'] as const).map(k => (
              <label key={k} className="flex items-center gap-2 text-sm capitalize">
                <input type="checkbox" checked={s.pwgen[k]}
                  onChange={e => update({ pwgen: { ...s.pwgen, [k]: e.target.checked } })} /> {k}
              </label>))}
          </div>
        </section>
      </div>
    </div>);
}