import type { CloudProvider, RemoteFile, UploadResult } from './cloudProvider';

interface Stored { name: string; bytes: ArrayBuffer; rev: string }

export class FakeCloudProvider implements CloudProvider {
  readonly id: 'dropbox' | 'gdrive';
  private files = new Map<string, Stored>();
  private offline = false;
  private forceConflict = false;
  private revCounter = 0;
  uploads: { fileId: string; bytes: ArrayBuffer; rev: string }[] = [];

  constructor(id: 'dropbox' | 'gdrive' = 'dropbox') { this.id = id; }

  // ---- test controls ----
  setFile(fileId: string, name: string, bytes: ArrayBuffer, rev: string): void {
    this.files.set(fileId, { name, bytes, rev });
  }
  setRevision(fileId: string, rev: string): void {
    const f = this.files.get(fileId); if (f) f.rev = rev;
  }
  failNextUploadWithConflict(): void { this.forceConflict = true; }
  setOffline(offline: boolean): void { this.offline = offline; }

  private guard() { if (this.offline) throw new Error('offline'); }
  private get(fileId: string): Stored {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`no such file: ${fileId}`);
    return f;
  }

  // ---- CloudProvider ----
  async auth(): Promise<void> { /* fake: always authorized */ }

  async listKdbxFiles(): Promise<RemoteFile[]> {
    this.guard();
    return [...this.files.entries()].map(([fileId, f]) => ({ fileId, name: f.name, rev: f.rev }));
  }

  async download(fileId: string): Promise<{ bytes: ArrayBuffer; rev: string }> {
    this.guard();
    const f = this.get(fileId);
    return { bytes: f.bytes, rev: f.rev };
  }

  async getRevision(fileId: string): Promise<string> {
    this.guard();
    return this.get(fileId).rev;
  }

  async upload(fileId: string, bytes: ArrayBuffer, basedOnRev: string): Promise<UploadResult> {
    this.guard();
    const f = this.get(fileId);
    if (this.forceConflict) { this.forceConflict = false; return { ok: false, conflict: true }; }
    if (f.rev !== basedOnRev) return { ok: false, conflict: true };
    const rev = `fake-rev-${++this.revCounter}`;
    f.bytes = bytes; f.rev = rev;
    this.uploads.push({ fileId, bytes, rev });
    return { ok: true, rev };
  }
}
