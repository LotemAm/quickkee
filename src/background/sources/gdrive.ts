import type { CloudProvider, RemoteFile, UploadResult } from './cloudProvider';
import { getAccessToken, GDRIVE_OAUTH } from './oauth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class GDriveProvider implements CloudProvider {
  readonly id = 'gdrive' as const;
  constructor(private getToken: () => Promise<string> = () => getAccessToken(GDRIVE_OAUTH)) {}

  private async authHeader(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  async auth(): Promise<void> { await this.getToken(); }

  async listKdbxFiles(): Promise<RemoteFile[]> {
    const q = encodeURIComponent("name contains '.kdbx' and trashed = false");
    const res = await fetch(`${API}/files?q=${q}&fields=${encodeURIComponent('files(id,name,headRevisionId)')}`, {
      headers: await this.authHeader(),
    });
    if (!res.ok) throw new Error('gdriveList');
    const data = await res.json() as { files: { id: string; name: string; headRevisionId?: string }[] };
    return data.files
      .filter(f => f.name.toLowerCase().endsWith('.kdbx'))
      .map(f => ({ fileId: f.id, name: f.name, rev: f.headRevisionId ?? '' }));
  }

  async getRevision(fileId: string): Promise<string> {
    const res = await fetch(`${API}/files/${fileId}?fields=headRevisionId`, { headers: await this.authHeader() });
    if (!res.ok) throw new Error('gdriveMetadata');
    const data = await res.json() as { headRevisionId: string };
    return data.headRevisionId;
  }

  async download(fileId: string): Promise<{ bytes: ArrayBuffer; rev: string }> {
    const res = await fetch(`${API}/files/${fileId}?alt=media`, { headers: await this.authHeader() });
    if (!res.ok) throw new Error('gdriveDownload');
    const bytes = await res.arrayBuffer();
    const rev = await this.getRevision(fileId);
    return { bytes, rev };
  }

  async upload(fileId: string, bytes: ArrayBuffer, basedOnRev: string): Promise<UploadResult> {
    // Drive has no conditional-write header; guard by re-checking the head revision.
    // Residual race: this is check-then-act, not atomic. A remote push landing between
    // getRevision and the PATCH below is overwritten silently (lost *remote* update, never
    // local). Inherent to the Drive media API; narrower than Dropbox's server-side update:rev.
    const current = await this.getRevision(fileId);
    if (current !== basedOnRev) return { ok: false, conflict: true };
    const res = await fetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=headRevisionId`, {
      method: 'PATCH',
      headers: { ...(await this.authHeader()), 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!res.ok) throw new Error('gdriveUpload');
    const data = await res.json() as { headRevisionId: string };
    return { ok: true, rev: data.headRevisionId };
  }
}
