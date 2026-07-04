function parseHost(value: string): string | null {
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  try { return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

function parseScheme(value: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

function isLoopbackOrSingleLabel(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || !host.includes('.');
}

export function siteKey(url: string): string | null { return parseHost(url); }
export function urlMatches(entryUrl: string, pageUrl: string): boolean {
  const e = parseHost(entryUrl); const p = parseHost(pageUrl);
  if (!e || !p) return false;
  const hostOk = p === e || p.endsWith(`.${e}`);
  if (!hostOk) return false;
  const pageScheme = parseScheme(pageUrl) ?? 'https';
  if (pageScheme === 'https') return true;
  if (pageScheme === 'http') return parseScheme(entryUrl) === 'http' || isLoopbackOrSingleLabel(p);
  return false;
}
