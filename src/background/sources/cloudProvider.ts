export interface RemoteFile { fileId: string; name: string; rev: string }

export type UploadResult = { ok: true; rev: string } | { ok: false; conflict: true };

export interface CloudProvider {
  readonly id: 'dropbox' | 'gdrive';
  /** Run PKCE OAuth via launchWebAuthFlow; throws on denial/failure. */
  auth(): Promise<void>;
  /** List selectable .kdbx files in the provider. */
  listKdbxFiles(): Promise<RemoteFile[]>;
  /** Download full bytes + current revision. */
  download(fileId: string): Promise<{ bytes: ArrayBuffer; rev: string }>;
  /** Cheap metadata-only revision fetch. */
  getRevision(fileId: string): Promise<string>;
  /** Conditional upload guarded by basedOnRev. */
  upload(fileId: string, bytes: ArrayBuffer, basedOnRev: string): Promise<UploadResult>;
}
