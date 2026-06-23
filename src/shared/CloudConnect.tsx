import { useState } from 'react';
import { sendToSW } from './messages';
import type { RemoteFile } from '../background/sources/cloudProvider';

export function CloudConnect({ provider, onPicked }: {
  provider: 'dropbox' | 'gdrive';
  onPicked: (file: RemoteFile) => void;
}) {
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (busy) return; // guard against double-click firing two OAuth flows
    setBusy(true);
    setError(null);
    try {
      const c = await sendToSW({ type: 'connectCloud', provider });
      if (!c.ok) { setError('Could not connect. Try again.'); return; }
      const r = await sendToSW({ type: 'listRemoteFiles', provider });
      if ('files' in r) setFiles(r.files);
      else setError('Could not list files.');
    } finally {
      setBusy(false);
    }
  }

  if (files) {
    return (
      <ul className="cloud-file-list">
        {files.map(f => (
          <li key={f.fileId}>
            <button className="link-btn" onClick={() => onPicked(f)}>{f.name}</button>
          </li>
        ))}
        {files.length === 0 && <li>No .kdbx files found.</li>}
      </ul>
    );
  }

  return (
    <div>
      <button className="btn" onClick={connect} disabled={busy}>
        {busy ? 'Connecting…' : `Connect ${provider === 'dropbox' ? 'Dropbox' : 'Google Drive'}`}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
