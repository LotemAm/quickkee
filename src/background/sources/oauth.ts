export interface ProviderOAuthConfig {
  provider: 'dropbox' | 'gdrive';
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
}

// Public client IDs are baked into the build (no secret). Replace with the
// registered app client IDs before shipping.
export const DROPBOX_OAUTH: ProviderOAuthConfig = {
  provider: 'dropbox',
  clientId: import.meta.env.VITE_DROPBOX_CLIENT_ID ?? 'DROPBOX_CLIENT_ID',
  authUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  scope: 'files.content.read files.content.write files.metadata.read',
};

export const GDRIVE_OAUTH: ProviderOAuthConfig = {
  provider: 'gdrive',
  clientId: import.meta.env.VITE_GDRIVE_CLIENT_ID ?? 'GDRIVE_CLIENT_ID',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'https://www.googleapis.com/auth/drive.file',
};

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateVerifier(): string {
  const bytes = new Uint8Array(48); // 48 bytes → 64 base64url chars
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

export function buildAuthUrl(cfg: ProviderOAuthConfig, redirectUri: string, challenge: string): string {
  const u = new URL(cfg.authUrl);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', cfg.scope);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('token_access_type', 'offline'); // Dropbox: ask for a refresh token
  u.searchParams.set('access_type', 'offline');        // Google: ask for a refresh token
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

function refreshKey(provider: string): string { return `oauth_refresh_${provider}`; }

async function getRefreshToken(provider: string): Promise<string | null> {
  const got = await chrome.storage.local.get(refreshKey(provider));
  return (got[refreshKey(provider)] as string | undefined) ?? null;
}
async function setRefreshToken(provider: string, token: string): Promise<void> {
  await chrome.storage.local.set({ [refreshKey(provider)]: token });
}

export async function disconnect(provider: 'dropbox' | 'gdrive'): Promise<void> {
  await chrome.storage.local.remove(refreshKey(provider));
}

interface TokenResponse { access_token: string; refresh_token?: string }

async function exchangeCode(cfg: ProviderOAuthConfig, code: string, verifier: string, redirectUri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code, client_id: cfg.clientId, code_verifier: verifier, redirect_uri: redirectUri,
  });
  const res = await fetch(cfg.tokenUrl, { method: 'POST', body });
  if (!res.ok) throw new Error('authRequired');
  return res.json() as Promise<TokenResponse>;
}

async function refreshAccess(cfg: ProviderOAuthConfig, refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId,
  });
  const res = await fetch(cfg.tokenUrl, { method: 'POST', body });
  if (!res.ok) throw new Error('authRequired');
  return res.json() as Promise<TokenResponse>;
}

/** Full interactive flow: PKCE → launchWebAuthFlow → code exchange → store refresh token. */
async function runInteractiveFlow(cfg: ProviderOAuthConfig): Promise<string> {
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = generateVerifier();
  const challenge = await challengeFromVerifier(verifier);
  const authUrl = buildAuthUrl(cfg, redirectUri, challenge);

  const redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!redirect) throw new Error('authRequired');
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('authRequired');

  const tok = await exchangeCode(cfg, code, verifier, redirectUri);
  if (tok.refresh_token) await setRefreshToken(cfg.provider, tok.refresh_token);
  return tok.access_token;
}

/** Get a usable access token: refresh silently if possible, else run the flow. */
export async function getAccessToken(cfg: ProviderOAuthConfig): Promise<string> {
  const refresh = await getRefreshToken(cfg.provider);
  if (refresh) {
    try {
      const tok = await refreshAccess(cfg, refresh);
      if (tok.refresh_token) await setRefreshToken(cfg.provider, tok.refresh_token);
      return tok.access_token;
    } catch {
      // refresh expired/revoked → fall through to interactive
    }
  }
  return runInteractiveFlow(cfg);
}
