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
