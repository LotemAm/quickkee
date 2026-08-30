import { useRef, useState } from 'react';
import { AlertTriangle, Loader2, QrCode, X } from 'lucide-react';
import type { TotpConfig } from '../../background/totp';
import type { EntryView } from '../../shared/entry';
import { scannedTotpEntryFields } from '../../shared/entryDefaults';
import type { ScannedTotpDestination } from './saveScannedTotp';

interface GroupOption {
  groupId: string;
  name: string;
  depth: number;
}

function algorithmLabel(algorithm: TotpConfig['algorithm']): string {
  return algorithm.replace('SHA', 'SHA-');
}

export function ScannedTotpDialog({ config, pageUrl, entries, groups, defaultGroupId, onCancel, onConfirm }: {
  config: TotpConfig;
  pageUrl: string;
  entries: EntryView[];
  groups: GroupOption[];
  defaultGroupId: string;
  onCancel: () => void;
  onConfirm: (destination: ScannedTotpDestination) => Promise<string | null>;
}) {
  const destinations = entries.filter(entry => !entry.isCard);
  const suggested = destinations.length === 1 && !destinations[0].hasTotp
    ? `existing:${destinations[0].id}`
    : destinations.length === 0 ? 'new' : '';
  const defaults = scannedTotpEntryFields(config, pageUrl);
  const [destination, setDestination] = useState(suggested);
  const [groupId, setGroupId] = useState(
    groups.some(group => group.groupId === defaultGroupId) ? defaultGroupId : groups[0]?.groupId ?? '',
  );
  const [title, setTitle] = useState(defaults.Title);
  const [username, setUsername] = useState(defaults.UserName);
  const [password, setPassword] = useState(defaults.Password);
  const [url, setUrl] = useState(defaults.URL);
  const [submitting, setSubmitting] = useState(false);
  const [replacePending, setReplacePending] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const selectedEntry = destination.startsWith('existing:')
    ? destinations.find(entry => entry.id === destination.slice('existing:'.length))
    : undefined;
  const canSubmit = destination === 'new'
    ? Boolean(title.trim() && groupId)
    : Boolean(selectedEntry);

  async function confirm(replacing = false) {
    if (!canSubmit || submittingRef.current) return;
    if (selectedEntry?.hasTotp && !replacing) {
      setReplacePending(true);
      setError('');
      return;
    }
    const next: ScannedTotpDestination = selectedEntry
      ? { type: 'existing', entryId: selectedEntry.id }
      : {
        type: 'new', groupId,
        fields: { Title: title.trim(), UserName: username, Password: password, URL: url },
      };
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const message = await onConfirm(next);
      if (message) setError(message);
    } catch {
      setError('Could not add the authenticator code. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0, 0, 0, .48)' }}>
      <div className="card w-full max-h-full overflow-auto" role="dialog" aria-modal="true" aria-labelledby="scanned-totp-title">
        <div className="flex items-start gap-2 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <QrCode size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
          <div className="min-w-0 flex-1">
            <h2 id="scanned-totp-title" className="font-semibold">Add authenticator code</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Confirm the scanned account and destination.</p>
          </div>
          <button className="icon-btn" aria-label="Close scan" title="Close" onClick={onCancel} disabled={submitting}>
            <X size={16} />
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 py-3 text-sm">
          <dt style={{ color: 'var(--text-muted)' }}>Issuer</dt><dd className="truncate">{config.issuer || 'Not provided'}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Account</dt><dd className="truncate">{config.account || 'Not provided'}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Algorithm</dt><dd>{algorithmLabel(config.algorithm)}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Digits</dt><dd>{config.digits} digits</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Period</dt><dd>{config.period} seconds</dd>
        </dl>

        <div className="space-y-2">
          <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            Destination
            <select className="input mt-1" aria-label="Destination" value={destination} disabled={submitting}
              onChange={event => {
                setDestination(event.target.value);
                setReplacePending(false);
                setError('');
              }}>
              {!suggested && <option value="">Choose an entry</option>}
              {destinations.length > 0 && (
                <optgroup label="Current-site entries">
                  {destinations.map(entry => (
                    <option key={entry.id} value={`existing:${entry.id}`}>
                      {entry.title || '(untitled)'}{entry.username ? ` — ${entry.username}` : ''}{entry.hasTotp ? ' (has authenticator code)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="new">Create a new entry</option>
            </select>
          </label>

          {destination === 'new' && (
            <div className="space-y-2 rounded-lg p-2" style={{ border: '1px solid var(--border)' }}>
              <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>Group
                <select className="input mt-1" aria-label="Group" value={groupId} disabled={submitting}
                  onChange={event => setGroupId(event.target.value)}>
                  {groups.map(group => (
                    <option key={group.groupId} value={group.groupId}>{'\u00A0\u00A0'.repeat(group.depth) + group.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>Title
                <input className="input mt-1" aria-label="Title" value={title} disabled={submitting}
                  onChange={event => setTitle(event.target.value)} />
              </label>
              <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>Username
                <input className="input mt-1" aria-label="Username" value={username} disabled={submitting}
                  onChange={event => setUsername(event.target.value)} />
              </label>
              <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>Password
                <input className="input mt-1" aria-label="Password" type="password" value={password} disabled={submitting}
                  onChange={event => setPassword(event.target.value)} />
              </label>
              <label className="block text-xs" style={{ color: 'var(--text-muted)' }}>URL
                <input className="input mt-1" aria-label="URL" value={url} disabled={submitting}
                  onChange={event => setUrl(event.target.value)} />
              </label>
            </div>
          )}

          {replacePending && selectedEntry?.hasTotp && (
            <div className="alert-error space-y-2" role="alert">
              <p className="flex items-center gap-1"><AlertTriangle size={14} /> This entry already has an authenticator code.</p>
              <button className="btn-primary w-full" disabled={submitting} onClick={() => void confirm(true)}>
                {submitting ? <><Loader2 size={15} className="animate-spin" /> Replacing…</> : 'Replace existing authenticator code'}
              </button>
            </div>
          )}
          {error && <p className="alert-error" role="alert">{error}</p>}
        </div>

        <div className="flex gap-2 pt-3 mt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn-secondary w-full" onClick={onCancel} disabled={submitting}>Cancel</button>
          {!replacePending && (
            <button className="btn-primary w-full" onClick={() => void confirm()} disabled={!canSubmit || submitting}>
              {submitting ? <><Loader2 size={15} className="animate-spin" /> Adding…</> : 'Add authenticator code'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
