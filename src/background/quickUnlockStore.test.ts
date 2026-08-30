// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import type { QuickUnlockRecord } from '../shared/quickUnlock';
import {
  clearQuickUnlockEnrollment,
  loadQuickUnlockEnrollment,
  saveQuickUnlockEnrollment,
} from './quickUnlockStore';
import { bytesToBase64Url } from '../shared/deviceQuickUnlock';

const record: QuickUnlockRecord = {
  version: 1,
  credentialId: 'AQIDBA',
  prfInput: bytesToBase64Url(new Uint8Array(32).fill(1)),
  salt: bytesToBase64Url(new Uint8Array(32).fill(2)),
  iv: bytesToBase64Url(new Uint8Array(12).fill(3)),
  ciphertext: bytesToBase64Url(new Uint8Array(24).fill(4)),
  source: { kind: 'local', label: 'Vault.kdbx' },
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(async () => { await clearQuickUnlockEnrollment(); });

describe('quick-unlock store', () => {
  test('saves and loads a local record with its structured-cloned handle', async () => {
    const handle = { kind: 'file', name: 'Vault.kdbx' } as FileSystemFileHandle;
    await saveQuickUnlockEnrollment(record, handle);
    const loaded = await loadQuickUnlockEnrollment();
    expect(loaded?.record).toEqual(record);
    expect(loaded?.localHandle).toEqual(handle);
  });

  test('replaces local enrollment atomically and removes its handle for cloud', async () => {
    await saveQuickUnlockEnrollment(record, { kind: 'file', name: 'Vault.kdbx' } as FileSystemFileHandle);
    const cloud: QuickUnlockRecord = {
      ...record,
      source: { kind: 'cloud', provider: 'dropbox', fileId: 'dbx-1', label: 'Cloud.kdbx' },
      updatedAt: 2,
    };
    await saveQuickUnlockEnrollment(cloud, null);
    await expect(loadQuickUnlockEnrollment()).resolves.toEqual({ record: cloud, localHandle: null });
  });

  test('delete clears both record and local handle', async () => {
    await saveQuickUnlockEnrollment(record, { kind: 'file', name: 'Vault.kdbx' } as FileSystemFileHandle);
    await clearQuickUnlockEnrollment();
    await expect(loadQuickUnlockEnrollment()).resolves.toBeNull();
  });
});
