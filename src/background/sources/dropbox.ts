import type { CloudProvider, RemoteFile, UploadResult } from './cloudProvider';
import { getAccessToken, DROPBOX_OAUTH } from './oauth';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

export class DropboxProvider implements CloudProvider {
  readonly id = 'dropbox' as const;
  constructor(private getToken: () => Promise<string> = () => getAccessToken(DROPBOX_OAUTH)) {}

  private async authHeader(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  async auth(): Promise<void> { await this.getToken(); }

  async listKdbxFiles(): Promise<RemoteFile[]> {
    const res = await fetch(`${API}/files/list_folder`, {
      method: 'POST',
      headers: { ...(await this.authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', recursive: true }),
    });
    if (!res.ok) throw new Error('dropboxList');
    const data = await res.json() as { entries: { '.tag': string; id: string; name: string; rev?: string }[] };
    return data.entries
      .filter(e => e['.tag'] === 'file' && e.name.toLowerCase().endsWith('.kdbx'))
      .map(e => ({ fileId: e.id, name: e.name, rev: e.rev ?? '' }));
  }

  async getRevision(fileId: string): Promise<string> {
    const res = await fetch(`${API}/files/get_metadata`, {
      method: 'POST',
      headers: { ...(await this.authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fileId }),
    });
    if (!res.ok) throw new Error('dropboxMetadata');
    const data = await res.json() as { rev: string };
    return data.rev;
  }

  async download(fileId: string): Promise<{ bytes: ArrayBuffer; rev: string }> {
    const res = await fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { ...(await this.authHeader()), 'Dropbox-API-Arg': JSON.stringify({ path: fileId }) },
    });
    if (!res.ok) throw new Error('dropboxDownload');
    const meta = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as { rev: string };
    const bytes = await res.arrayBuffer();
    return { bytes, rev: meta.rev };
  }

  async upload(fileId: string, bytes: ArrayBuffer, basedOnRev: string): Promise<UploadResult> {
    const res = await fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        ...(await this.authHeader()),
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: fileId, mode: { '.tag': 'update', update: basedOnRev }, mute: true,
        }),
      },
      body: bytes,
    });
    if (res.status === 409) return { ok: false, conflict: true };
    if (!res.ok) throw new Error('dropboxUpload');
    const data = await res.json() as { rev: string };
    return { ok: true, rev: data.rev };
  }
}
