function parseHost(value: string): string | null {
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  try { return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}
export function siteKey(url: string): string | null { return parseHost(url); }
export function urlMatches(entryUrl: string, pageUrl: string): boolean {
  const e = parseHost(entryUrl); const p = parseHost(pageUrl);
  if (!e || !p) return false;
  return p === e || p.endsWith(`.${e}`);
}
