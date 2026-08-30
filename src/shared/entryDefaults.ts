import type { TotpConfig } from '../background/totp';

export function canonicalPageOrigin(url: string): string {
  try { return `${new URL(url).origin}/`; }
  catch { return url; }
}

export function defaultPageTitle(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

export function scannedTotpEntryFields(config: TotpConfig, pageUrl: string): Record<string, string> {
  return {
    Title: config.issuer?.trim() || defaultPageTitle(pageUrl) || 'Authenticator',
    UserName: config.account?.trim() ?? '',
    Password: '',
    URL: canonicalPageOrigin(pageUrl),
  };
}
