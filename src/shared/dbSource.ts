export interface LocalFileSource { kind: 'local'; handleId: string }
export interface CloudFileSource {
  kind: 'cloud';
  provider: 'dropbox' | 'gdrive';
  fileId: string;
  basedOnRev: string;   // remote revision the in-memory DB descends from
}
export type DbSource = LocalFileSource | CloudFileSource;
