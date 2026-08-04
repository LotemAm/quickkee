const KEY = 'qkOpenEntry';

export async function requestOpenEntry(entryId: string): Promise<void> {
  await chrome.storage.session.set({ [KEY]: entryId });
}

export async function consumeOpenEntry(): Promise<string | null> {
  const got = await chrome.storage.session.get(KEY);
  const id = (got[KEY] as string | undefined) ?? null;
  if (id != null) await chrome.storage.session.remove(KEY);
  return id;
}

export function watchOpenEntry(cb: (entryId: string) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'session') return;
    const change = changes[KEY];
    if (change?.newValue != null) cb(change.newValue as string);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
