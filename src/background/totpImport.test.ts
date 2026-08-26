import { mergeTotpImportChunks } from '../shared/totpImport';
import { googleAuthenticatorImporter } from './totpImport';

const GOOGLE_EXPORT = 'otpauth-migration://offline?data=CikKBkhlbGxvIRIRYWxpY2VAZXhhbXBsZS5jb20aBkdpdEh1YiABKAEwAgooCgoxMjM0NTY3ODkwEhRBY21lOmJvYkBleGFtcGxlLmNvbSADKAIwAhABGAEgAChj';
const GOOGLE_EXPORT_V2 = 'otpauth-migration://offline?data=CikKBkhlbGxvIRIRYWxpY2VAZXhhbXBsZS5jb20aBkdpdEh1YiABKAEwAgooCgoxMjM0NTY3ODkwEhRBY21lOmJvYkBleGFtcGxlLmNvbSADKAIwAhACGAEgAChj';

test('decodes Google Authenticator migration keys into provider-neutral TOTP keys', () => {
  const chunk = googleAuthenticatorImporter.parse(GOOGLE_EXPORT);

  expect(chunk.provider).toBe('google-authenticator');
  expect(chunk.batch).toEqual({ id: 99, size: 1, index: 0 });
  expect(chunk.keys).toEqual([
    {
      id: 'google-authenticator:99:0:0',
      issuer: 'GitHub',
      account: 'alice@example.com',
      config: {
        secret: 'JBSWY3DPEE', algorithm: 'SHA1', digits: 6, period: 30,
        issuer: 'GitHub', account: 'alice@example.com',
      },
    },
    {
      id: 'google-authenticator:99:0:1',
      issuer: 'Acme',
      account: 'bob@example.com',
      config: {
        secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA512', digits: 8, period: 30,
        issuer: 'Acme', account: 'bob@example.com',
      },
    },
  ]);
  expect(chunk.warnings).toEqual([]);
});

test('rejects input that is not a Google Authenticator migration QR payload', () => {
  expect(() => googleAuthenticatorImporter.parse('otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP'))
    .toThrow('Not a Google Authenticator export');
});

test('decodes Google Authenticator migration payload version 2', () => {
  expect(googleAuthenticatorImporter.parse(GOOGLE_EXPORT_V2))
    .toEqual(googleAuthenticatorImporter.parse(GOOGLE_EXPORT));
});

test('requires every QR from a multi-code export and returns keys in batch order', () => {
  const makeChunk = (index: number) => ({
    provider: 'google-authenticator' as const,
    keys: [{
      id: `key-${index}`,
      issuer: 'Example',
      account: `user-${index}`,
      config: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1' as const, digits: 6, period: 30 },
    }],
    warnings: [],
    batch: { id: 7, size: 2, index },
  });

  expect(() => mergeTotpImportChunks([makeChunk(0)])).toThrow('Missing export QR code 2 of 2');
  expect(mergeTotpImportChunks([makeChunk(1), makeChunk(0)]).keys.map(key => key.id))
    .toEqual(['key-0', 'key-1']);
});
