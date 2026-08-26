// @vitest-environment node
import { generateTotp, parseTotpInput, toOtpUri } from './totp';

describe('parseTotpInput', () => {
  test('uses standard defaults for a bare Base32 secret', () => {
    expect(parseTotpInput('jbsw y3dp-ehpk3pxp', { issuer: 'Example', account: 'alice@example.com' })).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      issuer: 'Example',
      account: 'alice@example.com',
    });
  });

  test('preserves parameters and label metadata from an otpauth URI', () => {
    expect(parseTotpInput(
      'otpauth://totp/Acme:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme&algorithm=SHA256&digits=8&period=45',
    )).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA256',
      digits: 8,
      period: 45,
      issuer: 'Acme',
      account: 'alice@example.com',
    });
  });

  test.each([
    ['otpauth://hotp/Example:a?secret=JBSWY3DPEHPK3PXP&counter=1', 'Only TOTP'],
    ['otpauth://totp/Example:a?secret=not_base32!', 'Base32'],
    ['otpauth://totp/Example:a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5', 'algorithm'],
    ['otpauth://totp/Example:a?secret=JBSWY3DPEHPK3PXP&digits=5', 'digits'],
    ['otpauth://totp/Example:a?secret=JBSWY3DPEHPK3PXP&period=0', 'period'],
  ])('rejects invalid input: %s', (input, message) => {
    expect(() => parseTotpInput(input)).toThrow(message);
  });
});

test('toOtpUri emits one normalized KeePassXC-compatible URI', () => {
  const config = parseTotpInput(
    'otpauth://totp/Acme:alice%40example.com?digits=8&secret=jbswy3dpehpk3pxp&period=45&algorithm=sha512&issuer=Acme',
  );
  expect(toOtpUri(config)).toBe(
    'otpauth://totp/Acme:alice%40example.com?secret=JBSWY3DPEHPK3PXP&period=45&digits=8&issuer=Acme&algorithm=SHA512',
  );
});

describe('generateTotp RFC 6238 vectors', () => {
  test.each([
    ['SHA1', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '94287082'],
    ['SHA256', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA', '46119246'],
    ['SHA512', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA', '90693936'],
  ] as const)('%s', async (algorithm, secret, expected) => {
    const result = await generateTotp({ secret, algorithm, digits: 8, period: 30 }, 59_000);
    expect(result).toEqual({ code: expected, period: 30, expiresAt: 60_000 });
  });
});
