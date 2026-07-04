import type { EntryView, EntrySummary, TreeNode } from './entry';
import type { PwGenOpts } from './pwgen';
import type { RemoteFile } from '../background/sources/cloudProvider';
import type { DbSource } from './dbSource';

export type Request =
  | { type: 'unlock'; password: string | null; keyFile: number[] | null }
  | { type: 'lock' }
  | { type: 'getStatus' }
  | { type: 'getEntriesForUrl'; url: string }
  | { type: 'getEntrySummariesForUrl'; url: string }
  | { type: 'getEntry'; entryId: string }
  | { type: 'getTree' }
  | { type: 'createEntry'; groupId: string; fields: Record<string, string> }
  | { type: 'updateEntry'; entryId: string; fields: Record<string, string>; expires?: number | null; removeKeys?: string[] }
  | { type: 'updateGroup'; groupId: string; fields: Record<string, string> }
  | { type: 'createGroup'; parentId: string; name: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'save' }
  | { type: 'generatePassword'; opts?: PwGenOpts }
  | { type: 'fillRequest'; entryId: string; tabId: number }
  | { type: 'connectCloud'; provider: 'dropbox' | 'gdrive' }
  | { type: 'listRemoteFiles'; provider: 'dropbox' | 'gdrive' }
  | { type: 'openRemote'; provider: 'dropbox' | 'gdrive'; fileId: string; fileName: string; password: string | null; keyFile: number[] | null }
  | { type: 'getSyncStatus' }
  | { type: 'disconnectCloud'; provider: 'dropbox' | 'gdrive' };

// Intentional: `{}` (not `Record<string, never>`) is required so bare `Ok` is excluded from
// `'prop' in r` narrowing on the `Response` union below; an index-signature type would keep
// it in the narrowed union.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Ok<T = {}> = { ok: true } & T;
export type Err = { ok: false; error: string };
export type Response =
  | Ok | Err
  | Ok<{ locked: boolean; dbName?: string; dirty: boolean }>
  | Ok<{ entries: EntryView[] }>
  | Ok<{ summaries: EntrySummary[] }>
  | Ok<{ entry: EntryView | null }>
  | Ok<{ tree: TreeNode }>
  | Ok<{ entryId: string }>
  | Ok<{ groupId: string }>
  | Ok<{ password: string }>
  | Ok<{ merged?: boolean }>
  | Ok<{ files: RemoteFile[] }>
  | Ok<{ source: DbSource['kind'] | null; provider?: 'dropbox' | 'gdrive'; pendingUpload: boolean; online: boolean; lastSyncedAt?: number }>;

export function sendToSW(req: Request): Promise<Response> {
  return chrome.runtime.sendMessage(req) as Promise<Response>;
}
