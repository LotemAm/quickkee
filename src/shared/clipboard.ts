export async function copyWithClear(text: string, clearSeconds: number): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (clearSeconds > 0) setTimeout(async () => {
    try { if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText(''); }
    catch { /* clipboard may be unavailable when unfocused; ignore */ }
  }, clearSeconds * 1000);
}
