// @vitest-environment node
import { describe, expect, test } from 'vitest';
import type { QuickUnlockMaterial, QuickUnlockSource } from '../shared/quickUnlock';
import {
  QuickUnlockCryptoError,
  assertQuickUnlockRecord,
  unwrapQuickUnlockMaterial,
  wrapQuickUnlockMaterial,
} from './quickUnlockCrypto';
import { bytesToBase64Url } from '../shared/deviceQuickUnlock';

const credentialId = 'AQIDBA';
const prfInput = bytesToBase64Url(new Uint8Array(32).fill(3));
const prfOutput = new Uint8Array(32).fill(17);
const local: QuickUnlockSource = { kind: 'local', label: 'Vault.kdbx' };

async function wrap(material: QuickUnlockMaterial, source = local) {
  return wrapQuickUnlockMaterial({
    credentialId,
    prfInput,
    prfOutput,
    source,
    material,
    now: 1_750_000_000_000,
  });
}

describe('quick-unlock envelope', () => {
  test.each([
    ['password-only', { password: 'correct horse', keyFile: null }],
    ['key-file-only', { password: null, keyFile: new Uint8Array([0, 1, 127, 255]) }],
    ['combined', { password: 'correct horse', keyFile: new Uint8Array([9, 8, 7]) }],
  ] as const)('round trips %s material', async (_name, material) => {
    const record = await wrap(material);
    const opened = await unwrapQuickUnlockMaterial(record, prfOutput);
    expect(opened.password).toBe(material.password);
    expect(opened.keyFile).toEqual(material.keyFile);
  });

  test('uses fresh salt and IV for every envelope', async () => {
    const material = { password: 'same', keyFile: null };
    const first = await wrap(material);
    const second = await wrap(material);
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  test.each(['ciphertext', 'salt', 'iv'] as const)('rejects tampered %s', async field => {
    const record = await wrap({ password: 'secret', keyFile: null });
    const changed = { ...record, [field]: record[field].replace(/^./u, record[field][0] === 'A' ? 'B' : 'A') };
    await expect(unwrapQuickUnlockMaterial(changed, prfOutput)).rejects.toBeInstanceOf(QuickUnlockCryptoError);
  });

  test('rejects the wrong PRF output and modified source AAD', async () => {
    const record = await wrap({ password: 'secret', keyFile: null });
    await expect(unwrapQuickUnlockMaterial(record, new Uint8Array(32).fill(99)))
      .rejects.toBeInstanceOf(QuickUnlockCryptoError);
    await expect(unwrapQuickUnlockMaterial({ ...record, source: { ...local, label: 'Other.kdbx' } }, prfOutput))
      .rejects.toBeInstanceOf(QuickUnlockCryptoError);
  });

  test('rejects unsupported versions and malformed lengths before decrypting', async () => {
    const record = await wrap({ password: 'secret', keyFile: null });
    expect(() => assertQuickUnlockRecord({ ...record, version: 2 })).toThrow(QuickUnlockCryptoError);
    expect(() => assertQuickUnlockRecord({ ...record, iv: 'AQID' })).toThrow(QuickUnlockCryptoError);
    await expect(unwrapQuickUnlockMaterial(record, new Uint8Array(31))).rejects.toBeInstanceOf(QuickUnlockCryptoError);
  });

  test('serialized records contain no plaintext material, PRF output, or derived key', async () => {
    const keyFile = new Uint8Array([222, 173, 190, 239]);
    const record = await wrap({ password: 'plaintext-password-marker', keyFile });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('plaintext-password-marker');
    expect(serialized).not.toContain(Buffer.from(keyFile).toString('base64'));
    expect(serialized).not.toContain(Buffer.from(prfOutput).toString('base64'));
    expect(Object.keys(record).sort()).toEqual([
      'ciphertext', 'createdAt', 'credentialId', 'iv', 'prfInput', 'salt', 'source', 'updatedAt', 'version',
    ]);
  });
});
