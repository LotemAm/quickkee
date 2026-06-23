import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { sendToSW } from '../../shared/messages';

export function CreateForm({ url, groupId, onCreated }: { url: string; groupId: string; onCreated: () => void }) {
  const [title, setTitle] = useState(''); const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => { sendToSW({ type: 'generatePassword' }).then(r => 'password' in r && setPassword(r.password)); }, []);
  async function create() {
    await sendToSW({ type: 'createEntry', groupId, fields: { Title: title, UserName: username, Password: password, URL: url } });
    await sendToSW({ type: 'save' }); onCreated();
  }
  return (
    <div className="card space-y-2">
      <div className="section-title">New entry</div>
      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{url}</p>
      <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <input className="input" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="btn-primary w-full" disabled={!title} onClick={create}>
        <Plus size={15} /> Create &amp; Save
      </button>
    </div>
  );
}