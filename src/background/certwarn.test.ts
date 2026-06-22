import { shouldWarnCertError } from './certwarn';
test('flags cert errors', () => {
  expect(shouldWarnCertError({ error: 'net::ERR_CERT_DATE_INVALID' })).toBe(true);
  expect(shouldWarnCertError({ error: 'net::ERR_CERT_AUTHORITY_INVALID' })).toBe(true);
});
test('ignores non-cert errors', () => {
  expect(shouldWarnCertError({ error: 'net::ERR_ABORTED' })).toBe(false);
  expect(shouldWarnCertError({})).toBe(false);
});
