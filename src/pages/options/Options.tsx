import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';

export function Options() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { loadSettings().then(v => { setS(v); applyTheme(v.theme); }); }, []);
  const update = (patch: Partial<Settings>) => { const next = { ...s, ...patch };
    setS(next); applyTheme(next.theme); void saveSettings(next); };
  return (
    <div className="p-6 max-w-md space-y-4">
      <h1 className="text-lg font-semibold">QuickKee Settings</h1>
      <label className="block">Auto-close after
        <select className="input" value={s.autoCloseHours}
          onChange={e => update({ autoCloseHours: Number(e.target.value) })}>
          {[1, 2, 4, 8, 24].map(h => <option key={h} value={h}>{h} hour(s)</option>)}
        </select></label>
      <label className="block">Clipboard auto-clear
        <select className="input" value={s.clipboardClearSeconds}
          onChange={e => update({ clipboardClearSeconds: Number(e.target.value) })}>
          {[0, 15, 30, 60].map(x => <option key={x} value={x}>{x === 0 ? 'never' : `${x}s`}</option>)}
        </select></label>
      <fieldset className="border p-2"><legend>Default generated password</legend>
        <label>Length <input type="number" className="input w-20" value={s.pwgen.length}
          onChange={e => update({ pwgen: { ...s.pwgen, length: Math.max(1, Number(e.target.value) || 1) } })} /></label>
        {(['lower', 'upper', 'digits', 'symbols'] as const).map(k => (
          <label key={k} className="flex gap-2"><input type="checkbox" checked={s.pwgen[k]}
            onChange={e => update({ pwgen: { ...s.pwgen, [k]: e.target.checked } })} /> {k}</label>))}
      </fieldset>
      <label className="flex gap-2"><input type="checkbox" checked={s.theme === 'dark'}
        onChange={e => update({ theme: e.target.checked ? 'dark' : 'light' })} /> Dark theme</label>
    </div>);
}
