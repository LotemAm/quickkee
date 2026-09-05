/** This channel contains lifecycle metadata only; never entries or credentials. */
export const VAULT_STATUS_PORT = 'quickkee-vault-status';

export interface VaultStatusState {
  generation: number;
  locked: boolean;
  dbName?: string;
  dirty: boolean;
}

export interface VaultStatusSnapshot extends VaultStatusState {
  workerIdentity: string;
  sequence: number;
}

export interface VaultStatusMessage {
  type: 'snapshot';
  snapshot: VaultStatusSnapshot;
  requestId?: number;
}

export interface VaultStatusRequest {
  type: 'refresh';
  requestId: number;
}

export function isVaultStatusMessage(value: unknown): value is VaultStatusMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<VaultStatusMessage>;
  const s = message.snapshot;
  return message.type === 'snapshot' && !!s && typeof s.workerIdentity === 'string'
    && s.workerIdentity.length > 0 && Number.isSafeInteger(s.sequence) && s.sequence >= 0
    && Number.isSafeInteger(s.generation) && s.generation >= 0
    && typeof s.locked === 'boolean' && typeof s.dirty === 'boolean'
    && (s.dbName === undefined || typeof s.dbName === 'string')
    && (message.requestId === undefined || Number.isSafeInteger(message.requestId));
}
