export const QUICK_UNLOCK_VERSION = 1 as const;
export const QUICK_UNLOCK_LOCAL_HANDLE_KEY = 'quickUnlockLocalHandle';

export type QuickUnlockProvider = 'dropbox' | 'gdrive';

export interface QuickUnlockLocalSource {
  kind: 'local';
  label: string;
}

export interface QuickUnlockCloudSource {
  kind: 'cloud';
  provider: QuickUnlockProvider;
  fileId: string;
  label: string;
}

export type QuickUnlockSource = QuickUnlockLocalSource | QuickUnlockCloudSource;

export interface QuickUnlockRecord {
  version: typeof QUICK_UNLOCK_VERSION;
  credentialId: string;
  prfInput: string;
  salt: string;
  iv: string;
  ciphertext: string;
  source: QuickUnlockSource;
  createdAt: number;
  updatedAt: number;
}

export interface QuickUnlockStatus {
  enrolled: boolean;
  corrupt: boolean;
  source: QuickUnlockSource | null;
  credentialId?: string;
  prfInput?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface QuickUnlockMaterial {
  password: string | null;
  keyFile: Uint8Array | null;
}
