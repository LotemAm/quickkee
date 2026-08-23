import { sendToSW } from './messages';
import { base64ToArrayBuffer } from './bytes';

/** Fetches attachment bytes from the background, triggers a browser download.
 *  Returns an error string on failure, null on success. */
export async function downloadAttachment(entryId: string, name: string): Promise<string | null> {
  const r = await sendToSW({ type: 'getAttachment', entryId, name });
  if (!r.ok) return r.error;
  const blob = new Blob([base64ToArrayBuffer(r.data)]);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return null;
}
