import type { EntryView, TreeNode } from './entry';
import type { PwGenOpts } from './pwgen';

export type Request =
  | { type: 'unlock'; password: string | null; keyFile: number[] | null }
  | { type: 'lock' }
  | { type: 'getStatus' }
  | { type: 'getEntriesForUrl'; url: string }
  | { type: 'getEntry'; entryId: string }
  | { type: 'getTree' }
  | { type: 'createEntry'; groupId: string; fields: Record<string, string> }
  | { type: 'updateEntry'; entryId: string; fields: Record<string, string> }
  | { type: 'updateGroup'; groupId: string; fields: Record<string, string> }
  | { type: 'save' }
  | { type: 'generatePassword'; opts?: PwGenOpts }
  | { type: 'fillRequest'; entryId: string; tabId: number };

export type Ok<T = {}> = { ok: true } & T;
export type Err = { ok: false; error: string };
export type Response =
  | Ok | Err
  | Ok<{ locked: boolean; dbName?: string; dirty: boolean }>
  | Ok<{ entries: EntryView[] }>
  | Ok<{ entry: EntryView | null }>
  | Ok<{ tree: TreeNode }>
  | Ok<{ entryId: string }>
  | Ok<{ password: string }>;

export function sendToSW(req: Request): Promise<Response> {
  return chrome.runtime.sendMessage(req) as Promise<Response>;
}
