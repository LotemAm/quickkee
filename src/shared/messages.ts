import type { EntryView, EntrySummary, TreeNode } from './entry';
import type { PwGenOpts } from './pwgen';
import type { RemoteFile } from '../background/sources/cloudProvider';
import type { DbSource } from './dbSource';
import type { TotpConfig, TotpCode } from '../background/totp';

export type Request =
  | { type: 'unlock'; password: string | null; keyFile: number[] | null }
  | { type: 'lock' }
  | { type: 'getStatus' }
  | { type: 'getEntriesForUrl'; url: string }
  | { type: 'getEntrySummariesForUrl'; url: string }
  | { type: 'getCardEntrySummariesForUrl'; url: string }
  | { type: 'getEntry'; entryId: string }
  | { type: 'getTotpConfig'; entryId: string }
  | { type: 'getTotpCode'; entryId: string }
  | { type: 'previewTotp'; config: TotpConfig }
  | { type: 'getTree' }
  | { type: 'createEntry'; groupId: string; fields: Record<string, string>; totp?: TotpConfig }
  | { type: 'updateEntry'; entryId: string; fields: Record<string, string>; expires?: number | null; removeKeys?: string[]; totp?: TotpConfig | null }
  | { type: 'updateGroup'; groupId: string; fields: Record<string, string> }
  | { type: 'createGroup'; parentId: string; name: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'deleteEntry'; entryId: string }
  | { type: 'addAttachment'; entryId: string; name: string; data: string }
  | { type: 'removeAttachment'; entryId: string; name: string }
  | { type: 'getAttachment'; entryId: string; name: string }
  | { type: 'save' }
  | { type: 'generatePassword'; opts?: PwGenOpts }
  | { type: 'fillRequest'; entryId: string; tabId: number }
  | { type: 'fillTotpRequest'; entryId: string }
  | { type: 'connectCloud'; provider: 'dropbox' | 'gdrive' }
  | { type: 'listRemoteFiles'; provider: 'dropbox' | 'gdrive' }
  | { type: 'openRemote'; provider: 'dropbox' | 'gdrive'; fileId: string; fileName: string; password: string | null; keyFile: number[] | null }
  | { type: 'getSyncStatus' }
  | { type: 'disconnectCloud'; provider: 'dropbox' | 'gdrive' }
  | { type: 'scheduleClipboardClear'; textHash: string; seconds: number }
  | { type: 'cancelClipboardClear' };

// Intentional: `{}` (not `Record<string, never>`) is required so bare `Ok` is excluded from
// `'prop' in r` narrowing on the `Response` union below; an index-signature type would keep
// it in the narrowed union.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Ok<T = {}> = { ok: true } & T;
export type Err = { ok: false; error: string };

// Request-keyed response map: each Request['type'] maps to the exact success
// payload shape the router returns for it (see plans/010 for the source table).
type OkFor = {
  unlock: Ok;
  lock: Ok;
  updateEntry: Ok;
  updateGroup: Ok;
  deleteGroup: Ok;
  deleteEntry: Ok;
  addAttachment: Ok;
  removeAttachment: Ok;
  getAttachment: Ok<{ data: string }>;
  connectCloud: Ok;
  disconnectCloud: Ok;
  fillRequest: Ok;
  fillTotpRequest: Ok;
  getTotpConfig: Ok<{ config: TotpConfig | null }>;
  getTotpCode: Ok<TotpCode>;
  previewTotp: Ok<TotpCode>;
  scheduleClipboardClear: Ok;
  cancelClipboardClear: Ok;
  getStatus: Ok<{ locked: boolean; dbName?: string; dirty: boolean }>;
  getEntriesForUrl: Ok<{ entries: EntryView[] }>;
  getEntrySummariesForUrl: Ok<{ summaries: EntrySummary[] }>;
  getCardEntrySummariesForUrl: Ok<{ summaries: EntrySummary[] }>;
  getEntry: Ok<{ entry: EntryView | null }>;
  getTree: Ok<{ tree: TreeNode }>;
  createEntry: Ok<{ entryId: string }>;
  createGroup: Ok<{ groupId: string }>;
  save: Ok<{ merged?: boolean }>;
  openRemote: Ok<{ merged?: boolean }>;
  generatePassword: Ok<{ password: string }>;
  listRemoteFiles: Ok<{ files: RemoteFile[] }>;
  getSyncStatus: Ok<{ source: DbSource['kind'] | null; provider?: 'dropbox' | 'gdrive'; pendingUpload: boolean; online: boolean; lastSyncedAt?: number }>;
};
// Compile-time exhaustiveness: every Request type must appear in OkFor.
type _AssertExhaustive = Request['type'] extends keyof OkFor ? true : never;
const _assertExhaustive: _AssertExhaustive = true;
void _assertExhaustive;

export type ResponseFor<T extends Request['type']> = OkFor[T] | Err;
export type Response = ResponseFor<Request['type']>; // keep the old name for the router

export function sendToSW<R extends Request>(req: R): Promise<ResponseFor<R['type']>> {
  return chrome.runtime.sendMessage(req) as Promise<ResponseFor<R['type']>>;
}
