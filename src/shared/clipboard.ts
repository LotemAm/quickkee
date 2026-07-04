import { sendToSW } from './messages';

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function copyWithClear(text: string, clearSeconds: number): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (clearSeconds > 0) {
    setTimeout(async () => {
      try { if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText(''); }
      catch { /* clipboard may be unavailable when unfocused; ignore */ }
    }, clearSeconds * 1000);
    void sendToSW({ type: 'scheduleClipboardClear', textHash: await sha256Hex(text), seconds: clearSeconds });
  }
}
