import { saveHandle, ensurePermission } from '../background/fileHandle';
export async function pickAndStoreDb(): Promise<string> {
  // @ts-expect-error experimental
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'KeePass', accept: { 'application/octet-stream': ['.kdbx'] } }] });
  // Request readwrite here, inside the picker's user gesture. The service worker
  // cannot prompt for file permission, so the grant must be obtained in the page.
  await ensurePermission(handle, 'readwrite');
  await saveHandle(handle); return handle.name;
}
export async function readKeyFile(): Promise<number[]> {
  // @ts-expect-error experimental
  const [h] = await window.showOpenFilePicker();
  const buf = await (await h.getFile()).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}
