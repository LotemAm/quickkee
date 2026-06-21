import { saveHandle } from '../background/fileHandle';
export async function pickAndStoreDb(): Promise<string> {
  // @ts-expect-error experimental
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'KeePass', accept: { 'application/octet-stream': ['.kdbx'] } }] });
  await saveHandle(handle); return handle.name;
}
export async function readKeyFile(): Promise<number[]> {
  // @ts-expect-error experimental
  const [h] = await window.showOpenFilePicker();
  const buf = await (await h.getFile()).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}
