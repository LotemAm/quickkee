import type { PwGenOpts } from './pwgen';
import type { TotpConfig } from '../background/totp';

export type DraftSubmission =
  | { status: 'creating' | 'unknown'; sessionKey: string }
  | { status: 'created' | 'saved'; sessionKey: string; entryId: string };

export interface CreateDraft {
  url: string;
  title: string;
  username: string;
  password: string;
  groupId: string;
  entryUrl: string;
  opts: PwGenOpts;
  savedAt: number;
  totp?: TotpConfig | null;
  submission?: DraftSubmission;
}

const KEY = 'createDraft';
export const DRAFT_TTL_MS = 10 * 60 * 1000;

type DraftMap = Record<string, CreateDraft>;

async function loadMap(): Promise<DraftMap> {
  const got = await chrome.storage.session.get(KEY);
  return (got[KEY] as DraftMap | undefined) ?? {};
}

function isFresh(d: CreateDraft, now = Date.now()): boolean {
  return now - d.savedAt <= DRAFT_TTL_MS;
}

export async function loadDraft(url: string): Promise<CreateDraft | null> {
  const map = await loadMap();
  const d = map[url];
  return d && isFresh(d) ? d : null;
}

export async function saveDraft(d: CreateDraft, isAlive: () => boolean = () => true): Promise<void> {
  if (!isAlive()) return;
  const now = Date.now();
  const map = await loadMap();
  if (!isAlive()) return;
  map[d.url] = { ...d, savedAt: now };
  const pruned = Object.fromEntries(
    Object.entries(map).filter(([, draft]) => now - draft.savedAt <= DRAFT_TTL_MS),
  );
  await chrome.storage.session.set({ [KEY]: pruned });
}

export async function clearDraft(url: string, isAlive: () => boolean = () => true): Promise<void> {
  if (!isAlive()) return;
  const map = await loadMap();
  if (!isAlive()) return;
  delete map[url];
  await chrome.storage.session.set({ [KEY]: map });
}

export async function clearAllDrafts(): Promise<void> {
  await chrome.storage.session.remove(KEY);
}
