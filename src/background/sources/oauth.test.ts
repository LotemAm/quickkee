import { generateVerifier, challengeFromVerifier, buildAuthUrl, generateState, parseAuthRedirect, DROPBOX_OAUTH } from './oauth';

const B64URL = /^[A-Za-z0-9\-_]+$/;

test('verifier is 64 base64url chars', () => {
  const v = generateVerifier();
  expect(v).toHaveLength(64);
  expect(v).toMatch(B64URL);
});

test('verifier is random each call', () => {
  expect(generateVerifier()).not.toBe(generateVerifier());
});

test('challenge is base64url SHA-256 of the verifier and is stable', async () => {
  const v = 'a'.repeat(64);
  const c1 = await challengeFromVerifier(v);
  const c2 = await challengeFromVerifier(v);
  expect(c1).toBe(c2);
  expect(c1).toMatch(B64URL);
  expect(c1).not.toContain('='); // no padding
});

test('buildAuthUrl includes PKCE + redirect params', () => {
  const url = new URL(buildAuthUrl(DROPBOX_OAUTH, 'https://ext.chromiumapp.org/', 'CHAL', 'teststate'));
  expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
  expect(url.searchParams.get('client_id')).toBe(DROPBOX_OAUTH.clientId);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('code_challenge')).toBe('CHAL');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe('https://ext.chromiumapp.org/');
  expect(url.searchParams.get('token_access_type')).toBe('offline'); // request refresh token
  expect(url.searchParams.get('state')).toBe('teststate');
});

test('generateState is a non-empty base64url string, random each call', () => {
  const s = generateState();
  expect(s.length).toBeGreaterThan(0);
  expect(s).toMatch(B64URL);
  expect(generateState()).not.toBe(s);
});

test('parseAuthRedirect returns the code when state matches', () => {
  const code = parseAuthRedirect('https://ext.chromiumapp.org/?code=AUTHCODE&state=teststate', 'teststate');
  expect(code).toBe('AUTHCODE');
});

test('parseAuthRedirect throws authRequired when state does not match', () => {
  expect(() =>
    parseAuthRedirect('https://ext.chromiumapp.org/?code=AUTHCODE&state=wrongstate', 'teststate'),
  ).toThrow('authRequired');
});

test('parseAuthRedirect throws authRequired when code is missing', () => {
  expect(() => parseAuthRedirect('https://ext.chromiumapp.org/?state=teststate', 'teststate')).toThrow(
    'authRequired',
  );
});
