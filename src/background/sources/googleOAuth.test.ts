import {
  GOOGLE_HOSTED_CALLBACK_URL,
  buildHostedGoogleAuthUrl,
  handleHostedGoogleOAuthMessage,
  shouldUseHostedGoogleOAuth,
  validateHostedGoogleCallback,
} from './googleOAuth';

const EXTENSION_ID = 'jngjnmfmodbiogpcadigjcflkbkhfnfb';

test('hosted Google auth requests a short-lived access token at the exact callback URL', () => {
  const url = new URL(buildHostedGoogleAuthUrl('web-client.apps.googleusercontent.com', 'STATE', false));

  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('client_id')).toBe('web-client.apps.googleusercontent.com');
  expect(url.searchParams.get('redirect_uri')).toBe(GOOGLE_HOSTED_CALLBACK_URL);
  expect(url.searchParams.get('response_type')).toBe('token');
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
  expect(url.searchParams.get('state')).toBe('STATE');
  expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  expect(url.searchParams.has('prompt')).toBe(false);
});

test('silent hosted renewal suppresses Google UI', () => {
  const url = new URL(buildHostedGoogleAuthUrl('web-client.apps.googleusercontent.com', 'STATE', true));
  expect(url.searchParams.get('prompt')).toBe('none');
});

test('uses hosted OAuth when Chromium rewrites its identity callback or the browser is Brave', () => {
  const normal = `https://${EXTENSION_ID}.chromiumapp.org/`;
  expect(shouldUseHostedGoogleOAuth(normal, EXTENSION_ID, false)).toBe(false);
  expect(shouldUseHostedGoogleOAuth(normal, EXTENSION_ID, true)).toBe(true);
  expect(shouldUseHostedGoogleOAuth(`https://${EXTENSION_ID}.ch40m1umapp.qjz9zk/`, EXTENSION_ID, false)).toBe(true);
});

test('accepts a valid token only from the hosted callback with matching state', () => {
  expect(validateHostedGoogleCallback({
    type: 'quickkee-google-oauth-callback',
    state: 'STATE',
    accessToken: 'ACCESS_TOKEN',
    expiresIn: 3600,
  }, GOOGLE_HOSTED_CALLBACK_URL, 'STATE', 1_000)).toEqual({
    accessToken: 'ACCESS_TOKEN',
    expiresAt: 3_601_000,
  });
});

test.each([
  ['wrong origin', 'https://attacker.example/callback/', 'STATE'],
  ['wrong state', GOOGLE_HOSTED_CALLBACK_URL, 'OTHER'],
])('rejects callback with %s', (_label, senderUrl, expectedState) => {
  expect(() => validateHostedGoogleCallback({
    type: 'quickkee-google-oauth-callback',
    state: 'STATE',
    accessToken: 'ACCESS_TOKEN',
    expiresIn: 3600,
  }, senderUrl, expectedState)).toThrow('authRequired');
});

test('rejects callback errors and malformed token lifetimes', () => {
  expect(() => validateHostedGoogleCallback({
    type: 'quickkee-google-oauth-callback', state: 'STATE', error: 'access_denied',
  }, GOOGLE_HOSTED_CALLBACK_URL, 'STATE')).toThrow('authRequired');

  expect(() => validateHostedGoogleCallback({
    type: 'quickkee-google-oauth-callback', state: 'STATE', accessToken: 'TOKEN', expiresIn: 0,
  }, GOOGLE_HOSTED_CALLBACK_URL, 'STATE')).toThrow('authRequired');
});

test('stores an accepted hosted token in session storage and consumes the pending state', async () => {
  const session: Record<string, unknown> = {
    gdriveHostedOAuthPending: { state: 'STATE', createdAt: Date.now(), interactive: true },
  };
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: session[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(session, values); }),
        remove: vi.fn(async (key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key]) delete session[item];
        }),
      },
    },
  });

  const response = await handleHostedGoogleOAuthMessage({
    type: 'quickkee-google-oauth-callback',
    state: 'STATE',
    accessToken: 'ACCESS_TOKEN',
    expiresIn: 3600,
  }, { url: GOOGLE_HOSTED_CALLBACK_URL });

  expect(response).toEqual({ ok: true, close: true });
  expect(session.gdriveHostedOAuthPending).toBeUndefined();
  expect(session.gdriveHostedOAuthToken).toMatchObject({ accessToken: 'ACCESS_TOKEN' });
  vi.unstubAllGlobals();
});

test('an unrelated sender cannot consume the pending hosted state', async () => {
  const pending = { state: 'STATE', createdAt: Date.now(), interactive: true };
  const session: Record<string, unknown> = { gdriveHostedOAuthPending: pending };
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: session[key] })),
        remove: vi.fn(async () => {}),
      },
    },
  });

  const response = await handleHostedGoogleOAuthMessage({
    type: 'quickkee-google-oauth-callback', state: 'STATE', accessToken: 'TOKEN', expiresIn: 3600,
  }, { url: 'https://attacker.example/' });

  expect(response).toEqual({ ok: false, close: false, error: 'authRequired' });
  expect(session.gdriveHostedOAuthPending).toBe(pending);
  vi.unstubAllGlobals();
});
