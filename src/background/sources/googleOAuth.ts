import { disconnect, generateState } from './oauth';

export const GOOGLE_HOSTED_CALLBACK_URL = 'https://lotemam.github.io/quickkee/oauth/callback/';
export const GOOGLE_HOSTED_CALLBACK_MESSAGE = 'quickkee-google-oauth-callback';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const HOSTED_TOKEN_KEY = 'gdriveHostedOAuthToken';
const HOSTED_PENDING_KEY = 'gdriveHostedOAuthPending';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const FLOW_TIMEOUT_MS = 5 * 60_000;

interface HostedGoogleCallback {
  type: typeof GOOGLE_HOSTED_CALLBACK_MESSAGE;
  state?: unknown;
  accessToken?: unknown;
  expiresIn?: unknown;
  error?: unknown;
}

interface HostedToken {
  accessToken: string;
  expiresAt: number;
}

interface PendingHostedFlow {
  state: string;
  createdAt: number;
  interactive: boolean;
  tabId?: number;
}

interface HostedWaiter {
  state: string;
  resolve(token: string): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface HostedGoogleCallbackResponse {
  ok: boolean;
  close: boolean;
  error?: 'authRequired';
}

let hostedWaiter: HostedWaiter | null = null;
let hostedFlowPromise: Promise<string> | null = null;

export function buildHostedGoogleAuthUrl(clientId: string, state: string, silent: boolean): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', GOOGLE_HOSTED_CALLBACK_URL);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', GOOGLE_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('include_granted_scopes', 'true');
  if (silent) url.searchParams.set('prompt', 'none');
  return url.toString();
}

export function shouldUseHostedGoogleOAuth(redirectUrl: string, runtimeId: string, isBrave: boolean): boolean {
  return isBrave || redirectUrl !== `https://${runtimeId}.chromiumapp.org/`;
}

function isHostedGoogleCallbackUrl(senderUrl: string | undefined): boolean {
  if (!senderUrl) return false;
  try {
    const sender = new URL(senderUrl);
    const callback = new URL(GOOGLE_HOSTED_CALLBACK_URL);
    return sender.origin === callback.origin
      && sender.pathname === callback.pathname
      && sender.search === callback.search;
  } catch {
    return false;
  }
}

export function validateHostedGoogleCallback(
  message: unknown,
  senderUrl: string | undefined,
  expectedState: string,
  now = Date.now(),
): HostedToken {
  if (!isHostedGoogleCallbackUrl(senderUrl) || typeof message !== 'object' || message === null)
    throw new Error('authRequired');

  const callback = message as HostedGoogleCallback;
  if (callback.type !== GOOGLE_HOSTED_CALLBACK_MESSAGE || callback.state !== expectedState || callback.error)
    throw new Error('authRequired');
  if (typeof callback.accessToken !== 'string' || callback.accessToken.length === 0
    || typeof callback.expiresIn !== 'number' || !Number.isFinite(callback.expiresIn)
    || callback.expiresIn <= 0 || callback.expiresIn > 86_400)
    throw new Error('authRequired');

  return { accessToken: callback.accessToken, expiresAt: now + callback.expiresIn * 1_000 };
}

function isPendingHostedFlow(value: unknown): value is PendingHostedFlow {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<PendingHostedFlow>;
  return typeof pending.state === 'string' && typeof pending.createdAt === 'number'
    && typeof pending.interactive === 'boolean';
}

function isHostedToken(value: unknown): value is HostedToken {
  if (typeof value !== 'object' || value === null) return false;
  const token = value as Partial<HostedToken>;
  return typeof token.accessToken === 'string' && typeof token.expiresAt === 'number';
}

async function getPendingFlow(): Promise<PendingHostedFlow | null> {
  const stored = await chrome.storage.session.get(HOSTED_PENDING_KEY);
  const pending = stored[HOSTED_PENDING_KEY];
  return isPendingHostedFlow(pending) ? pending : null;
}

async function removePendingFlow(state: string): Promise<void> {
  const current = await getPendingFlow();
  if (current?.state === state) await chrome.storage.session.remove(HOSTED_PENDING_KEY);
}

function settleWaiter(state: string, token?: string): void {
  if (hostedWaiter?.state !== state) return;
  const waiter = hostedWaiter;
  hostedWaiter = null;
  if (waiter.timer) clearTimeout(waiter.timer);
  if (token) waiter.resolve(token);
  else waiter.reject(new Error('authRequired'));
}

async function browserIsBrave(): Promise<boolean> {
  const brave = (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave;
  try { return await brave?.isBrave?.() ?? false; }
  catch { return false; }
}

async function getNativeGoogleToken(interactive: boolean): Promise<string> {
  const result = await chrome.identity.getAuthToken({ interactive });
  if (!result.token) throw new Error('authRequired');
  return result.token;
}

async function getStoredHostedToken(): Promise<string | null> {
  const stored = await chrome.storage.session.get(HOSTED_TOKEN_KEY);
  const token = stored[HOSTED_TOKEN_KEY];
  if (!isHostedToken(token) || token.expiresAt <= Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    await chrome.storage.session.remove(HOSTED_TOKEN_KEY);
    return null;
  }
  return token.accessToken;
}

function startHostedFlow(interactive: boolean): Promise<string> {
  const clientId = import.meta.env.VITE_GDRIVE_WEB_CLIENT_ID;
  if (!clientId || !clientId.endsWith('.apps.googleusercontent.com'))
    return Promise.reject(new Error('gdriveWebClientMissing'));

  const state = generateState();
  const pending: PendingHostedFlow = { state, createdAt: Date.now(), interactive };

  return new Promise<string>((resolve, reject) => {
    hostedWaiter = { state, resolve, reject };
    void (async () => {
      try {
        await chrome.storage.session.set({ [HOSTED_PENDING_KEY]: pending });
        const tab = await chrome.tabs.create({
          url: buildHostedGoogleAuthUrl(clientId, state, !interactive),
          active: interactive,
        });
        if (tab.id != null) {
          const current = await getPendingFlow();
          if (current?.state === state) {
            pending.tabId = tab.id;
            await chrome.storage.session.set({ [HOSTED_PENDING_KEY]: pending });
          }
        }
        if (hostedWaiter?.state === state) {
          hostedWaiter.timer = setTimeout(() => {
            void removePendingFlow(state);
            settleWaiter(state);
          }, FLOW_TIMEOUT_MS);
        }
      } catch {
        await removePendingFlow(state).catch(() => {});
        settleWaiter(state);
      }
    })();
  });
}

export async function getGoogleAccessToken(options: { interactive?: boolean } = {}): Promise<string> {
  const interactive = options.interactive ?? false;
  const redirectUrl = chrome.identity.getRedirectURL();
  const useHosted = shouldUseHostedGoogleOAuth(redirectUrl, chrome.runtime.id, await browserIsBrave());
  if (!useHosted) return getNativeGoogleToken(interactive);

  const stored = await getStoredHostedToken();
  if (stored) return stored;
  if (!hostedFlowPromise) {
    hostedFlowPromise = startHostedFlow(interactive).finally(() => { hostedFlowPromise = null; });
  }
  return hostedFlowPromise;
}

export async function handleHostedGoogleOAuthMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<HostedGoogleCallbackResponse> {
  if (typeof message !== 'object' || message === null
    || (message as Partial<HostedGoogleCallback>).type !== GOOGLE_HOSTED_CALLBACK_MESSAGE)
    return { ok: false, close: false, error: 'authRequired' };

  const pending = await getPendingFlow();
  if (!pending || Date.now() - pending.createdAt > FLOW_TIMEOUT_MS) {
    if (pending) await removePendingFlow(pending.state);
    return { ok: false, close: false, error: 'authRequired' };
  }
  if (!isHostedGoogleCallbackUrl(sender.url)
    || (message as Partial<HostedGoogleCallback>).state !== pending.state)
    return { ok: false, close: false, error: 'authRequired' };

  try {
    const token = validateHostedGoogleCallback(message, sender.url, pending.state);
    await chrome.storage.session.set({ [HOSTED_TOKEN_KEY]: token });
    await removePendingFlow(pending.state);
    settleWaiter(pending.state, token.accessToken);
    return { ok: true, close: true };
  } catch {
    await removePendingFlow(pending.state);
    settleWaiter(pending.state);
    return { ok: false, close: !pending.interactive, error: 'authRequired' };
  }
}

export async function disconnectGoogle(): Promise<void> {
  if (hostedWaiter) settleWaiter(hostedWaiter.state);
  await Promise.all([
    chrome.storage.session.remove([HOSTED_TOKEN_KEY, HOSTED_PENDING_KEY]),
    disconnect('gdrive'),
    chrome.identity.clearAllCachedAuthTokens().catch(() => {}),
  ]);
}
