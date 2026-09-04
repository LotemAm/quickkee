import type { CloudProvider, RemoteFile, UploadResult } from './cloudProvider';
import { getGoogleAccessToken } from './googleOAuth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class GDriveProvider implements CloudProvider {
  readonly id = 'gdrive' as const;
  constructor(private getToken: () => Promise<string> = () => getGoogleAccessToken()) {}

  private async authHeader(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  async auth(): Promise<void> { await this.getToken(); }

  async listKdbxFiles(): Promise<RemoteFile[]> {
    const q = encodeURIComponent("name contains '.kdbx' and trashed = false");
    const url = `${API}/files?q=${q}&fields=${encodeURIComponent('nextPageToken,files(id,name,headRevisionId)')}`;
    const files: RemoteFile[] = [];
    let pageToken: string | undefined;
    while (true) {
      const headers = await this.authHeader();
      try {
        const res = await fetch(`${url}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers });
        if (!res.ok) throw new Error('gdriveList');
        const data = await res.json() as {
          files: { id: string; name: string; headRevisionId?: string }[];
          nextPageToken?: string;
        };
        if (!data || !Array.isArray(data.files)
          || (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')) {
          throw new Error('gdriveList');
        }
        for (const file of data.files) {
          if (!file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string'
            || (file.headRevisionId !== undefined && typeof file.headRevisionId !== 'string')) {
            throw new Error('gdriveList');
          }
          if (file.name.toLowerCase().endsWith('.kdbx')) {
            files.push({ fileId: file.id, name: file.name, rev: file.headRevisionId ?? '' });
          }
        }
        if (!data.nextPageToken) return files;
        pageToken = data.nextPageToken;
      } catch {
        throw new Error('gdriveList');
      }
    }
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
