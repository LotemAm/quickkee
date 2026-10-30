import { useState } from 'react';
import { Box, Cloud, Database, HardDrive, KeyRound, Loader2, X } from 'lucide-react';
import { sendToSW, type StorageDestination } from './messages';
import { pickAndStoreNewDb, pickAndStoreNewKeyFile } from './pickFile';

type Location = 'local' | 'dropbox' | 'gdrive';

const locations: Array<{ id: Location; label: string; icon: typeof HardDrive }> = [
  { id: 'local', label: 'Local file', icon: HardDrive },
  { id: 'dropbox', label: 'Dropbox', icon: Box },
  { id: 'gdrive', label: 'Google Drive', icon: Cloud },
];

function LocationPicker({ value, onChange, label }: {
  value: Location; onChange: (value: Location) => void; label: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm" style={{ color: 'var(--text-muted)' }}>{label}</legend>
      <div className="source-picker" role="tablist">
        {locations.map(({ id, label: optionLabel, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>
            <Icon size={17} /> {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function destination(location: Location, fileName: string): StorageDestination {
  return location === 'local' ? { kind: 'local' } : { kind: 'cloud', provider: location, fileName };
}

function cloudLabel(location: Exclude<Location, 'local'>): string {
  return location === 'dropbox' ? 'Dropbox' : 'Google Drive';
}

export function CreateDatabase({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [location, setLocation] = useState<Location>('local');
  const [databaseName, setDatabaseName] = useState('QuickKee.kdbx');
  const [localDatabaseName, setLocalDatabaseName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [useKeyFile, setUseKeyFile] = useState(false);
  const [keyLocation, setKeyLocation] = useState<Location>('local');
  const [keyName, setKeyName] = useState('QuickKee.key');
  const [localKeyName, setLocalKeyName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function chooseLocalDatabase() {
    try { setLocalDatabaseName(await pickAndStoreNewDb()); setError(''); }
    catch (e) { if ((e as DOMException).name !== 'AbortError') setError('Could not select a database location.'); }
  }

  async function chooseLocalKeyFile() {
    try { setLocalKeyName(await pickAndStoreNewKeyFile()); setError(''); }
    catch (e) { if ((e as DOMException).name !== 'AbortError') setError('Could not select a key-file location.'); }
  }

  async function create() {
    setError('');
    if (!password) { setError('Enter a master password.'); return; }
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    if (location === 'local' && !localDatabaseName) { setError('Choose where to save the database.'); return; }
    if (useKeyFile && keyLocation === 'local' && !localKeyName) { setError('Choose where to save the key file.'); return; }

    setBusy(true);
    try {
      const cloudLocations = new Set<Exclude<Location, 'local'>>();
      if (location !== 'local') cloudLocations.add(location);
      if (useKeyFile && keyLocation !== 'local') cloudLocations.add(keyLocation);
      for (const provider of cloudLocations) {
        const connected = await sendToSW({ type: 'connectCloud', provider });
        if (!connected.ok) { setError(`Connect ${cloudLabel(provider)} to continue.`); return; }
      }
      const result = await sendToSW({
        type: 'createDatabase',
        destination: destination(location, databaseName),
        password,
        ...(useKeyFile ? { keyDestination: destination(keyLocation, keyName) } : {}),
      });
      if (!result.ok) {
        setError({
          passwordRequired: 'Enter a master password.',
          databaseLocationRequired: 'Choose where to save the database.',
          keyFileLocationRequired: 'Choose where to save the key file.',
          invalidDatabaseName: 'Use a database name ending in .kdbx.',
          invalidKeyFileName: 'Use a key-file name ending in .key.',
          authRequired: 'Reconnect the selected cloud account and try again.',
        }[result.error] ?? 'Could not create the database. Check the selected locations and try again.');
        return;
      }
      setPassword(''); setConfirmation(''); onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div className="p-4">
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="app-title text-base"><Database size={20} className="app-logo" /> New database</h1>
          <button className="icon-btn" type="button" aria-label="Cancel database creation" onClick={onCancel}><X size={16} /></button>
        </div>
        <LocationPicker value={location} onChange={setLocation} label="Save database to" />
        {location === 'local' ? (
          <button className="btn w-full" type="button" onClick={() => void chooseLocalDatabase()}>
            <HardDrive size={15} /> {localDatabaseName ? `Database: ${localDatabaseName}` : 'Choose database location…'}
          </button>
        ) : (
          <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Database name
            <input className="input mt-1" value={databaseName} onChange={e => setDatabaseName(e.target.value)} />
          </label>
        )}
        <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Master password
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus the primary input for this explicit creation flow */}
          <input className="input mt-1" type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Confirm master password
          <input className="input mt-1" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !busy && void create()} />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={useKeyFile} onChange={e => setUseKeyFile(e.target.checked)} /> Also require a key file
        </label>
        {useKeyFile && <>
          <LocationPicker value={keyLocation} onChange={setKeyLocation} label="Save key file to" />
          {keyLocation === 'local' ? (
            <button className="btn w-full" type="button" onClick={() => void chooseLocalKeyFile()}>
              <KeyRound size={15} /> {localKeyName ? `Key file: ${localKeyName}` : 'Choose key-file location…'}
            </button>
          ) : (
            <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Key-file name
              <input className="input mt-1" value={keyName} onChange={e => setKeyName(e.target.value)} />
            </label>
          )}
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Keep the key file separate from the database.</p>
        </>}
        {error && <p role="alert" className="alert-error">{error}</p>}
        <button className="btn-primary w-full" type="button" disabled={busy} onClick={() => void create()}>
          {busy ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : <><Database size={15} /> Create database</>}
        </button>
      </div>
    </div>
  );
}
