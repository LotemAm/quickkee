export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpConfig {
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  issuer?: string;
  account?: string;
}

export interface TotpCode {
  code: string;
  period: number;
  expiresAt: number;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += BASE32[(value << (5 - bits)) & 31];
  return encoded;
}

function normalizeSecret(value: string): string {
  const secret = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!secret || !/^[A-Z2-7]+$/.test(secret)) throw new Error('Invalid Base32 secret');
  return secret;
}

function parseAlgorithm(value: string | null): TotpAlgorithm {
  const normalized = (value ?? 'SHA1').toUpperCase().replace(/-/g, '').replace(/^HMAC/, '');
  if (normalized === 'SHA1' || normalized === 'SHA256' || normalized === 'SHA512') return normalized;
  throw new Error('Unsupported TOTP algorithm');
}

function parseDigits(value: string | null): number {
  const digits = value == null || value === '' ? 6 : Number(value);
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error('TOTP digits must be between 6 and 8');
  return digits;
}

function parsePeriod(value: string | null): number {
  const period = value == null || value === '' ? 30 : Number(value);
  if (!Number.isInteger(period) || period < 1 || period > 86_400) throw new Error('TOTP period must be between 1 and 86400 seconds');
  return period;
}

export function parseTotpInput(input: string, defaults: Pick<TotpConfig, 'issuer' | 'account'> = {}): TotpConfig {
  const value = input.trim();
  if (!value.toLowerCase().startsWith('otpauth://')) {
    return {
      secret: normalizeSecret(value),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      ...(defaults.issuer ? { issuer: defaults.issuer } : {}),
      ...(defaults.account ? { account: defaults.account } : {}),
    };
  }

  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Invalid otpauth URI'); }
  if (url.hostname.toLowerCase() !== 'totp') throw new Error('Only TOTP otpauth URIs are supported');

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const colon = rawLabel.indexOf(':');
  const labelIssuer = colon >= 0 ? rawLabel.slice(0, colon) : '';
  const account = colon >= 0 ? rawLabel.slice(colon + 1) : rawLabel;
  const issuer = url.searchParams.get('issuer') ?? labelIssuer;

  return {
    secret: normalizeSecret(url.searchParams.get('secret') ?? ''),
    algorithm: parseAlgorithm(url.searchParams.get('algorithm')),
    digits: parseDigits(url.searchParams.get('digits')),
    period: parsePeriod(url.searchParams.get('period')),
    ...(issuer ? { issuer } : {}),
    ...(account ? { account } : {}),
  };
}

export function toOtpUri(config: TotpConfig): string {
  const secret = normalizeSecret(config.secret);
  const algorithm = parseAlgorithm(config.algorithm);
  const digits = parseDigits(String(config.digits));
  const period = parsePeriod(String(config.period));
  const issuer = config.issuer?.trim() ?? '';
  const account = config.account?.trim() ?? '';
  const label = issuer || account
    ? `${issuer ? `${encodeURIComponent(issuer)}:` : ''}${encodeURIComponent(account || 'none')}`
    : 'QuickKee:none';
  let uri = `otpauth://totp/${label}?secret=${secret}&period=${period}&digits=${digits}`;
  if (issuer) uri += `&issuer=${encodeURIComponent(issuer)}`;
  if (algorithm !== 'SHA1') uri += `&algorithm=${algorithm}`;
  return uri;
}

function decodeBase32(secret: string): Uint8Array {
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of normalizeSecret(secret)) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

export async function generateTotp(config: TotpConfig, now = Date.now()): Promise<TotpCode> {
  const algorithm = parseAlgorithm(config.algorithm);
  const digits = parseDigits(String(config.digits));
  const period = parsePeriod(String(config.period));
  const counter = BigInt(Math.floor(now / 1000 / period));
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let i = counterBytes.length - 1; i >= 0; i--) {
    counterBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  const hash = algorithm === 'SHA1' ? 'SHA-1' : algorithm === 'SHA256' ? 'SHA-256' : 'SHA-512';
  const key = await crypto.subtle.importKey('raw', decodeBase32(config.secret), { name: 'HMAC', hash }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  const code = String(binary % (10 ** digits)).padStart(digits, '0');
  const expiresAt = (Math.floor(now / (period * 1000)) + 1) * period * 1000;
  return { code, period, expiresAt };
}
