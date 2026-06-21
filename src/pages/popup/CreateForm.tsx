import { useEffect, useState } from 'react';
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
    <div className="p-2 border-t mt-2 space-y-2">
      <p className="text-sm font-medium">New entry for {url}</p>
      <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      <input className="input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
      <input className="input" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="btn-primary" disabled={!title} onClick={create}>Create & Save</button>
    </div>
  );
}
