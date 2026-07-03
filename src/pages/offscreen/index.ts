import { sha256Hex } from '../../shared/clipboard';

/** Pure decision: does the clipboard's current content hash match what we expect to clear? */
export function shouldClear(currentHash: string, expectedHash: string): boolean {
  return currentHash === expectedHash;
}

async function clearIfMatch(textHash: string): Promise<void> {
  const textarea = document.getElementById('t') as HTMLTextAreaElement | null;
  if (!textarea) return;
  textarea.value = '';
  textarea.focus();
  textarea.select();
  const pasted = document.execCommand('paste');
  if (!pasted) return; // could not read the clipboard (unfocused/unsupported); leave it alone
  const current = textarea.value;
  const currentHash = await sha256Hex(current);
  if (!shouldClear(currentHash, textHash)) return;
  textarea.value = '';
  textarea.select();
  document.execCommand('copy');
}

chrome.runtime.onMessage.addListener((req: unknown, _sender, sendResponse) => {
  const message = req as { __qkOffscreen?: boolean; cmd?: string; textHash?: string } | null;
  if (!message || message.__qkOffscreen !== true || message.cmd !== 'clearIfMatch') return false;
  clearIfMatch(message.textHash ?? '')
    .catch(() => { /* clipboard failure: never leave the message hanging */ })
    .finally(() => sendResponse({ done: true }));
  return true; // async response
});
