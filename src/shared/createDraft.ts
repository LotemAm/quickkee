import type { PwGenOpts } from './pwgen';

export interface CreateDraft {
  url: string;
  title: string;
  username: string;
  password: string;
  groupId: string;
  entryUrl: string;
  opts: PwGenOpts;
  savedAt: number;
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

export async function saveDraft(d: CreateDraft): Promise<void> {
  const now = Date.now();
  const map = await loadMap();
  map[d.url] = { ...d, savedAt: now };
  const pruned = Object.fromEntries(
    Object.entries(map).filter(([, draft]) => now - draft.savedAt <= DRAFT_TTL_MS),
  );
  await chrome.storage.session.set({ [KEY]: pruned });
}

export async function clearDraft(url: string): Promise<void> {
  const map = await loadMap();
  delete map[url];
  await chrome.storage.session.set({ [KEY]: map });
}

export async function clearAllDrafts(): Promise<void> {
  await chrome.storage.session.remove(KEY);
}
