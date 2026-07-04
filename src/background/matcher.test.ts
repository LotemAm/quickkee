import { siteKey, urlMatches } from './matcher';

test('siteKey strips scheme/path/www', () => {
  expect(siteKey('https://www.GitHub.com/login')).toBe('github.com');
});
test('siteKey null for invalid', () => { expect(siteKey('not a url')).toBeNull(); });
test('matches same host', () => {
  expect(urlMatches('https://github.com', 'https://github.com/login')).toBe(true);
});
test('matches subdomain of entry host', () => {
  expect(urlMatches('https://github.com', 'https://gist.github.com/x')).toBe(true);
});
test('no match different domain', () => {
  expect(urlMatches('https://github.com', 'https://gitlab.com')).toBe(false);
});
test('bare entry value (no scheme) still matches', () => {
  expect(urlMatches('github.com', 'https://github.com/login')).toBe(true);
});
test('https entry does not match http page (downgrade blocked)', () => {
  expect(urlMatches('https://example.com', 'http://example.com/login')).toBe(false);
});
test('http entry matches http page', () => {
  expect(urlMatches('http://example.com', 'http://example.com/login')).toBe(true);
});
test('bare entry (defaults to https) does not match http page', () => {
  expect(urlMatches('example.com', 'http://example.com')).toBe(false);
});
test('https entry matches https page', () => {
  expect(urlMatches('https://example.com', 'https://example.com')).toBe(true);
});
test('localhost exemption allows http', () => {
  expect(urlMatches('localhost:8123', 'http://localhost:8123/form')).toBe(true);
});
test('non-web schemes do not match', () => {
  expect(urlMatches('https://example.com', 'file:///etc/hosts')).toBe(false);
});
