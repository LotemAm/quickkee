import { encodeBase32, type TotpAlgorithm, type TotpConfig } from './totp';
import type { TotpImporter, TotpImportChunk, TotpImportKey } from '../shared/totpImport';

class ProtobufReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean { return this.offset >= this.bytes.length; }

  readVarint(): number {
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < 10; count++) {
      if (this.offset >= this.bytes.length) throw new Error('Truncated protobuf value');
      const byte = this.bytes[this.offset++];
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new Error('Invalid protobuf value');
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    const end = this.offset + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > this.bytes.length) throw new Error('Truncated protobuf field');
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readString(): string { return new TextDecoder('utf-8', { fatal: true }).decode(this.readBytes()); }

  skip(wireType: number): void {
    if (wireType === 0) { this.readVarint(); return; }
    if (wireType === 1) { this.advance(8); return; }
    if (wireType === 2) { this.readBytes(); return; }
    if (wireType === 5) { this.advance(4); return; }
    throw new Error('Unsupported protobuf field');
  }

  private advance(length: number): void {
    if (this.offset + length > this.bytes.length) throw new Error('Truncated protobuf field');
    this.offset += length;
  }
}

interface GoogleOtpParameters {
  secret: Uint8Array;
  name: string;
  issuer: string;
  algorithm: number;
  digits: number;
  type: number;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/ /g, '+').replace(/[\r\n\t]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary: string;
  try { binary = atob(padded); }
  catch { throw new Error('Invalid Google Authenticator export data'); }
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function parseOtpParameters(bytes: Uint8Array): GoogleOtpParameters {
  const reader = new ProtobufReader(bytes);
  const out: GoogleOtpParameters = {
    secret: new Uint8Array(), name: '', issuer: '', algorithm: 0, digits: 0, type: 0,
  };
  while (!reader.done) {
    const tag = reader.readVarint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1 && wire === 2) out.secret = reader.readBytes();
    else if (field === 2 && wire === 2) out.name = reader.readString();
    else if (field === 3 && wire === 2) out.issuer = reader.readString();
    else if (field === 4 && wire === 0) out.algorithm = reader.readVarint();
    else if (field === 5 && wire === 0) out.digits = reader.readVarint();
    else if (field === 6 && wire === 0) out.type = reader.readVarint();
    else reader.skip(wire);
  }
  return out;
}

function algorithm(value: number): TotpAlgorithm | null {
  if (value === 0 || value === 1) return 'SHA1';
  if (value === 2) return 'SHA256';
  if (value === 3) return 'SHA512';
  return null;
}

function digits(value: number): number | null {
  if (value === 0 || value === 1) return 6;
  if (value === 2) return 8;
  return null;
}

function labels(parameters: GoogleOtpParameters): { issuer: string; account: string } {
  let issuer = parameters.issuer.trim();
  let account = parameters.name.trim();
  if (issuer && account.startsWith(`${issuer}:`)) account = account.slice(issuer.length + 1).trim();
  else if (!issuer) {
    const separator = account.indexOf(':');
    if (separator >= 0) {
      issuer = account.slice(0, separator).trim();
      account = account.slice(separator + 1).trim();
    }
  }
  return { issuer, account };
}

function toImportKey(parameters: GoogleOtpParameters, id: string): TotpImportKey | string {
  const { issuer, account } = labels(parameters);
  const label = account || issuer || 'Unnamed account';
  if (parameters.type === 1) return `Skipped ${label}: HOTP is not supported`;
  if (parameters.type !== 2) return `Skipped ${label}: unsupported OTP type`;
  if (parameters.secret.length === 0) return `Skipped ${label}: missing secret`;
  const mappedAlgorithm = algorithm(parameters.algorithm);
  if (!mappedAlgorithm) return `Skipped ${label}: unsupported algorithm`;
  const mappedDigits = digits(parameters.digits);
  if (!mappedDigits) return `Skipped ${label}: unsupported digit count`;

  const config: TotpConfig = {
    secret: encodeBase32(parameters.secret),
    algorithm: mappedAlgorithm,
    digits: mappedDigits,
    period: 30,
    ...(issuer ? { issuer } : {}),
    ...(account ? { account } : {}),
  };
  return { id, issuer, account, config };
}

function parseGoogleAuthenticator(value: string): TotpImportChunk {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Not a Google Authenticator export'); }
  if (url.protocol !== 'otpauth-migration:' || url.hostname !== 'offline') {
    throw new Error('Not a Google Authenticator export');
  }
  const data = url.searchParams.get('data');
  if (!data) throw new Error('Google Authenticator export is missing data');

  const reader = new ProtobufReader(decodeBase64(data));
  const parameters: GoogleOtpParameters[] = [];
  let version = 0;
  let batchSize = 1;
  let batchIndex = 0;
  let batchId = 0;
  while (!reader.done) {
    const tag = reader.readVarint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1 && wire === 2) parameters.push(parseOtpParameters(reader.readBytes()));
    else if (field === 2 && wire === 0) version = reader.readVarint();
    else if (field === 3 && wire === 0) batchSize = reader.readVarint();
    else if (field === 4 && wire === 0) batchIndex = reader.readVarint();
    else if (field === 5 && wire === 0) batchId = reader.readVarint();
    else reader.skip(wire);
  }
  if (version !== 1 && version !== 2) throw new Error(`Unsupported Google Authenticator export version ${version}`);
  if (!Number.isInteger(batchSize) || batchSize < 1 || !Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= batchSize) {
    throw new Error('Google Authenticator export has invalid batch information');
  }

  const keys: TotpImportKey[] = [];
  const warnings: string[] = [];
  parameters.forEach((item, index) => {
    const mapped = toImportKey(item, `google-authenticator:${batchId}:${batchIndex}:${index}`);
    if (typeof mapped === 'string') warnings.push(mapped); else keys.push(mapped);
  });
  if (keys.length === 0) throw new Error(warnings[0] ?? 'Google Authenticator export contains no TOTP keys');
  return {
    provider: 'google-authenticator', keys, warnings,
    batch: { id: batchId, size: batchSize, index: batchIndex },
  };
}

export const googleAuthenticatorImporter: TotpImporter = {
  id: 'google-authenticator',
  label: 'Google Authenticator',
  parse: parseGoogleAuthenticator,
};
