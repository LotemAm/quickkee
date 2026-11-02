import { useId } from 'react';
import type { NameGenOptions } from './namegen';

export function NameGeneratorOptionsPanel({ options, onChange, disabled = false }: {
  options: NameGenOptions;
  onChange: (options: NameGenOptions) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md p-2" style={{ background: 'var(--surface-2, var(--bg))' }}>
      <div className="space-y-1 text-sm">
        <label className="block" htmlFor={`${id}-style`}>Name style</label>
        <select id={`${id}-style`} className="input w-full min-w-0" value={options.style}
          onChange={event => onChange({ ...options, style: event.target.value as NameGenOptions['style'] })}>
          <option value="adjective-noun">Adjective + noun</option>
          <option value="color-animal">Color + animal</option>
          <option value="noun-noun">Noun + noun</option>
          <option value="invented">Invented, pronounceable</option>
          <option value="alias">First name + surname</option>
        </select>
      </div>
      <div className="space-y-1 text-sm">
        <label className="block" htmlFor={`${id}-separator`}>Word separator</label>
        <select id={`${id}-separator`} className="input w-full min-w-0" value={options.separator}
          onChange={event => onChange({ ...options, separator: event.target.value as NameGenOptions['separator'] })}>
          <option value="-">Dash (-)</option>
          <option value="_">Underscore (_)</option>
          <option value="">None</option>
        </select>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1 text-sm">
          <label className="block" htmlFor={`${id}-casing`}>Name casing</label>
          <select id={`${id}-casing`} className="input w-full min-w-0" value={options.casing}
            onChange={event => onChange({ ...options, casing: event.target.value as NameGenOptions['casing'] })}>
            <option value="lowercase">Lowercase</option>
            <option value="capitalized">Capitalized</option>
          </select>
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          <label className="block" htmlFor={`${id}-digits`}>Digit suffix</label>
          <select id={`${id}-digits`} className="input w-full min-w-0" value={options.digits}
            onChange={event => onChange({ ...options, digits: Number(event.target.value) as NameGenOptions['digits'] })}>
            <option value={0}>None</option>
            <option value={2}>2 digits</option>
            <option value={4}>4 digits</option>
          </select>
        </div>
      </div>
    </fieldset>
  );
}
