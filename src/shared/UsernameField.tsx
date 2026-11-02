import { useId, useState } from 'react';
import { Copy, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { generateName, type NameGenOptions } from './namegen';
import { NameGeneratorOptionsPanel } from './NameGeneratorOptionsPanel';
import { useSessionLifetime } from './useSessionLifetime';

export function UsernameField({ value, onChange, generator, disabled = false, canGenerate, onCopy, variant = 'popup' }: {
  value: string;
  onChange: (value: string) => void;
  generator: { options: NameGenOptions; changeOptions: (options: NameGenOptions) => void; ready: boolean; notice: string };
  disabled?: boolean;
  canGenerate?: () => boolean;
  onCopy?: () => void;
  variant?: 'popup' | 'panel';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const captureLifetime = useSessionLifetime();
  const buttonClass = variant === 'popup' ? 'btn-secondary shrink-0' : 'icon-btn shrink-0';
  function generate() {
    if (disabled || !generator.ready || !captureLifetime()() || canGenerate?.() === false) return;
    try {
      const name = generateName(generator.options);
      onChange(name);
      setError('');
    } catch { setError('Could not generate a username. Try again.'); }
  }
  return (
    <div className="min-w-0 space-y-2">
      {variant === 'panel' && <label className="section-title block" htmlFor={id}>Username</label>}
      <div className="flex min-w-0 items-center gap-1.5">
        <input id={id} className="input min-w-0 flex-1" aria-label="Username" placeholder="Username"
          value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
        <button type="button" className={buttonClass} aria-label="Generate username" title="Generate username"
          disabled={disabled || !generator.ready} onClick={generate}><RefreshCw size={15} /></button>
        <button type="button" className={buttonClass} aria-label="Username options" title="Username options (this form)"
          aria-expanded={open} aria-controls={`${id}-options`} disabled={disabled || !generator.ready}
          onClick={() => setOpen(current => !current)}><SlidersHorizontal size={15} /></button>
        {onCopy && <button type="button" className={buttonClass} aria-label="Copy Username" title="Copy Username (Ctrl+B)"
          disabled={disabled} onClick={onCopy}><Copy size={15} /></button>}
      </div>
      {open && <div id={`${id}-options`} className="space-y-2">
        <NameGeneratorOptionsPanel options={generator.options} onChange={generator.changeOptions} disabled={disabled} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Options apply to this form. Change defaults in Settings.</p>
      </div>}
      {generator.notice && <p className="text-xs" role="status">{generator.notice}</p>}
      {error && <p className="alert-error" role="alert">{error}</p>}
    </div>
  );
}
