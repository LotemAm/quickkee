import { saveHandle, ensurePermission, saveKeyHandle, loadKeyHandle } from '../background/fileHandle';
export async function pickAndStoreDb(): Promise<string> {
  // @ts-expect-error experimental
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'KeePass', accept: { 'application/octet-stream': ['.kdbx'] } }] });
  // Request readwrite here, inside the picker's user gesture. The service worker
  // cannot prompt for file permission, so the grant must be obtained in the page.
  await ensurePermission(handle, 'readwrite');
  await saveHandle(handle); return handle.name;
}
// Pick a key file and persist its handle (a reference to the file, not its bytes).
// The name is shown in the UI; bytes are re-read on demand at unlock time.
export async function pickKeyFile(): Promise<string> {
  // @ts-expect-error experimental
  const [h] = await window.showOpenFilePicker();
  await ensurePermission(h, 'read');
  await saveKeyHandle(h);
  return h.name as string;
}

// Re-read bytes from the stored key-file handle. Returns null if no handle is
// stored or permission can no longer be obtained (caller should ask to re-pick).
export async function readStoredKeyBytes(): Promise<number[] | null> {
  const h = await loadKeyHandle();
  if (!h) return null;
  if (!(await ensurePermission(h, 'read'))) return null;
  const buf = await (await h.getFile()).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}
