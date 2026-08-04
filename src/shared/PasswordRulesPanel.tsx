import type { PwGenOpts } from './pwgen';

export function PasswordRulesPanel({ opts, onChange }: { opts: PwGenOpts; onChange: (opts: PwGenOpts) => void }) {
  const noClass = !opts.lower && !opts.upper && !opts.digits && !opts.symbols;
  return (
    <div className="space-y-2 rounded-md p-2" style={{ background: 'var(--surface-2, var(--bg))' }}>
      <label className="flex items-center justify-between gap-3 text-sm">
        Length
        <input type="number" className="input w-20" value={opts.length}
          onChange={e => onChange({ ...opts, length: Math.max(1, Number(e.target.value) || 1) })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(['lower', 'upper', 'digits', 'symbols'] as const).map(k => (
          <label key={k} className="flex items-center gap-2 text-sm capitalize">
            <input type="checkbox" checked={opts[k]}
              onChange={e => onChange({ ...opts, [k]: e.target.checked })} /> {k}
          </label>))}
      </div>
      {noClass && <p className="text-sm" style={{ color: 'var(--danger, #c00)' }}>Enable at least one character set.</p>}
    </div>
  );
}
