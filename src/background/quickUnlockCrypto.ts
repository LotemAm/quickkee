import { base64UrlToBytes, bytesToBase64Url } from '../shared/deviceQuickUnlock';
import {
  QUICK_UNLOCK_VERSION,
  type QuickUnlockMaterial,
  type QuickUnlockRecord,
  type QuickUnlockSource,
} from '../shared/quickUnlock';

const PRF_BYTES = 32;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const AES_TAG_BYTES = 16;
const INFO = new TextEncoder().encode('QuickKee device quick unlock v1');

/**
 * Threat boundary: this envelope prevents casual inspection of stored unlock
 * material and requires a fresh platform user-verification ceremony to recover
 * its wrapping key. It cannot protect against a compromised QuickKee extension,
 * browser profile, or operating system while the user authorizes verification.
 */

export class QuickUnlockCryptoError extends Error {
  constructor(message = 'corrupt quick-unlock enrollment') {
    super(message);
    this.name = 'QuickUnlockCryptoError';
  }
}

function decode(value: unknown, expectedLength?: number): Uint8Array {
  if (typeof value !== 'string') throw new QuickUnlockCryptoError();
  try {
    const bytes = base64UrlToBytes(value);
    if (expectedLength !== undefined && bytes.byteLength !== expectedLength) throw new QuickUnlockCryptoError();
    return bytes;
  } catch { throw new QuickUnlockCryptoError(); }
}

function validText(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function assertSource(value: unknown): asserts value is QuickUnlockSource {
  if (!value || typeof value !== 'object') throw new QuickUnlockCryptoError();
  const source = value as Partial<QuickUnlockSource>;
  if (!validText(source.label)) throw new QuickUnlockCryptoError();
  if (source.kind === 'local') return;
  if (source.kind !== 'cloud' || (source.provider !== 'dropbox' && source.provider !== 'gdrive')
    || !validText(source.fileId, 2048)) throw new QuickUnlockCryptoError();
}

export function assertQuickUnlockRecord(value: unknown): QuickUnlockRecord {
  if (!value || typeof value !== 'object') throw new QuickUnlockCryptoError();
  const record = value as Partial<QuickUnlockRecord>;
  if (record.version !== QUICK_UNLOCK_VERSION
    || !validText(record.credentialId, 2048)
    || !Number.isFinite(record.createdAt) || (record.createdAt ?? 0) < 0
    || !Number.isFinite(record.updatedAt) || (record.updatedAt ?? 0) < (record.createdAt ?? 0))
    throw new QuickUnlockCryptoError();
  const credentialId = decode(record.credentialId);
  if (credentialId.byteLength === 0 || credentialId.byteLength > 1024) throw new QuickUnlockCryptoError();
  decode(record.prfInput, PRF_BYTES);
  decode(record.salt, SALT_BYTES);
  decode(record.iv, IV_BYTES);
  if (decode(record.ciphertext).byteLength <= AES_TAG_BYTES) throw new QuickUnlockCryptoError();
  assertSource(record.source);
  return record as QuickUnlockRecord;
}

function aad(record: Pick<QuickUnlockRecord, 'version' | 'credentialId' | 'source'>): Uint8Array {
  const source = record.source.kind === 'local'
    ? ['local', record.source.label]
    : ['cloud', record.source.provider, record.source.fileId, record.source.label];
  return new TextEncoder().encode(JSON.stringify([record.version, record.credentialId, source]));
}

async function deriveKey(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  if (prfOutput.byteLength !== PRF_BYTES || salt.byteLength !== SALT_BYTES) throw new QuickUnlockCryptoError();
  const copy = new Uint8Array(prfOutput);
  try {
    const material = await crypto.subtle.importKey('raw', copy, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch { throw new QuickUnlockCryptoError(); }
  finally { copy.fill(0); }
}

function materialPayload(material: QuickUnlockMaterial): Uint8Array {
  if (material.password === null && material.keyFile === null) throw new QuickUnlockCryptoError('empty unlock material');
  if (material.password !== null && typeof material.password !== 'string') throw new QuickUnlockCryptoError();
  return new TextEncoder().encode(JSON.stringify({
    version: QUICK_UNLOCK_VERSION,
    password: material.password,
    keyFile: material.keyFile ? bytesToBase64Url(material.keyFile) : null,
  }));
}

export async function wrapQuickUnlockMaterial(input: {
  credentialId: string;
  prfInput: string;
  prfOutput: Uint8Array;
  source: QuickUnlockSource;
  material: QuickUnlockMaterial;
  now?: number;
}): Promise<QuickUnlockRecord> {
  const now = input.now ?? Date.now();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const recordBase = {
    version: QUICK_UNLOCK_VERSION,
    credentialId: input.credentialId,
    source: input.source,
  } as const;
  // Validate all public inputs before performing any cryptographic operation.
  assertQuickUnlockRecord({
    ...recordBase,
    prfInput: input.prfInput,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(AES_TAG_BYTES + 1)),
    createdAt: now,
    updatedAt: now,
  });
  const plaintext = materialPayload(input.material);
  try {
    const key = await deriveKey(input.prfOutput, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(recordBase), tagLength: 128 },
      key,
      plaintext,
    );
    return {
      ...recordBase,
      prfInput: input.prfInput,
      salt: bytesToBase64Url(salt),
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    if (error instanceof QuickUnlockCryptoError) throw error;
    throw new QuickUnlockCryptoError();
  } finally { plaintext.fill(0); }
}

function parseMaterial(bytes: Uint8Array): QuickUnlockMaterial {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      version?: unknown; password?: unknown; keyFile?: unknown;
    };
    if (value.version !== QUICK_UNLOCK_VERSION
      || (value.password !== null && typeof value.password !== 'string')
      || (value.keyFile !== null && typeof value.keyFile !== 'string')) throw new QuickUnlockCryptoError();
    const keyFile = value.keyFile === null ? null : decode(value.keyFile);
    if (value.password === null && keyFile === null) throw new QuickUnlockCryptoError();
    return { password: value.password, keyFile } as QuickUnlockMaterial;
  } catch (error) {
    if (error instanceof QuickUnlockCryptoError) throw error;
    throw new QuickUnlockCryptoError();
  }
}

export async function unwrapQuickUnlockMaterial(recordValue: unknown, prfOutput: Uint8Array): Promise<QuickUnlockMaterial> {
  const record = assertQuickUnlockRecord(recordValue);
  if (prfOutput.byteLength !== PRF_BYTES) throw new QuickUnlockCryptoError();
  const salt = decode(record.salt, SALT_BYTES);
  const iv = decode(record.iv, IV_BYTES);
  const ciphertext = decode(record.ciphertext);
  let plaintext: Uint8Array | null = null;
  try {
    const key = await deriveKey(prfOutput, salt);
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(record), tagLength: 128 },
      key,
      ciphertext,
    );
    plaintext = new Uint8Array(opened);
    return parseMaterial(plaintext);
  } catch (error) {
    if (error instanceof QuickUnlockCryptoError) throw error;
    throw new QuickUnlockCryptoError();
  } finally { plaintext?.fill(0); }
}
