import type { CredentialCandidate } from '../content/credentialCapture';
import { urlMatches } from './matcher';
import { CREDENTIAL_CAPTURE_TTL_MS } from '../shared/credentialCapture';

export const CREDENTIAL_CAPTURE_KEY = 'quickkee.credentialCaptures.v1';
export const CREDENTIAL_USERNAME_KEY = 'quickkee.credentialUsernames.v1';
export { CREDENTIAL_CAPTURE_TTL_MS } from '../shared/credentialCapture';

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface CredentialCaptureRecord extends CredentialCandidate {
  id: string;
  tabId: number;
  sourceUrl: string;
  sourceOrigin: string;
  createdAt: number;
  expiresAt: number;
  promptOrigin?: string;
  mutation?: { type: 'create' | 'update'; entryId: string };
}

interface CredentialUsernameRecord {
  tabId: number;
  sourceUrl: string;
  sourceOrigin: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

export type SafeCredentialCapture = Pick<CredentialCaptureRecord, 'username' | 'kind'> & {
  captureId: string;
  site: string;
};

export interface CaptureAuthority { tabId: number; url: string }

interface StoreOptions {
  storage?: SessionStorageArea | null;
  now?: () => number;
  randomId?: () => string;
  ttlMs?: number;
}

export class CredentialCaptureStore {
  private storage: SessionStorageArea | null;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly ttlMs: number;
  private records: Record<string, CredentialCaptureRecord> = {};
  private usernames: Record<string, CredentialUsernameRecord> = {};
  private hydrated = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: StoreOptions = {}) {
    this.storage = options.storage === undefined ? this.defaultStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.ttlMs = options.ttlMs ?? CREDENTIAL_CAPTURE_TTL_MS;
  }

  private defaultStorage(): SessionStorageArea | null {
    try { return chrome.storage.session as SessionStorageArea; }
    catch { return null; }
  }

  private async load(): Promise<Record<string, CredentialCaptureRecord>> {
    if (!this.hydrated) {
      this.hydrated = true;
      if (this.storage) {
        try {
          const [got, usernameGot] = await Promise.all([
            this.storage.get(CREDENTIAL_CAPTURE_KEY),
            this.storage.get(CREDENTIAL_USERNAME_KEY),
          ]);
          const stored = got[CREDENTIAL_CAPTURE_KEY];
          if (stored && typeof stored === 'object' && !Array.isArray(stored))
            this.records = stored as Record<string, CredentialCaptureRecord>;
          const storedUsernames = usernameGot[CREDENTIAL_USERNAME_KEY];
          if (storedUsernames && typeof storedUsernames === 'object' && !Array.isArray(storedUsernames))
            this.usernames = storedUsernames as Record<string, CredentialUsernameRecord>;
        } catch { this.storage = null; }
      }
    }

    const now = this.now();
    let pruned = false;
    for (const [id, record] of Object.entries(this.records)) {
      if (!record || typeof record.expiresAt !== 'number' || now >= record.expiresAt) {
        delete this.records[id]; pruned = true;
      }
    }
    for (const [tabId, record] of Object.entries(this.usernames)) {
      if (!record || typeof record.expiresAt !== 'number' || now >= record.expiresAt) {
        delete this.usernames[tabId]; pruned = true;
      }
    }
    if (pruned) await this.persist();
    return this.records;
  }

  private async persist(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.set({
        [CREDENTIAL_CAPTURE_KEY]: this.records,
        [CREDENTIAL_USERNAME_KEY]: this.usernames,
      });
    }
    catch { this.storage = null; }
  }

  private pageOrigin(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
    } catch { return null; }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  private async authorized(captureId: string, authority: CaptureAuthority): Promise<CredentialCaptureRecord | null> {
    const origin = this.pageOrigin(authority.url);
    if (!origin) return null;
    const record = (await this.load())[captureId];
    return record && record.tabId === authority.tabId && record.promptOrigin === origin ? record : null;
  }

  async stageUsername(input: { tabId: number; sourceUrl: string; username: string }): Promise<void> {
    await this.exclusive(async () => {
      const sourceOrigin = this.pageOrigin(input.sourceUrl);
      const username = input.username.trim();
      if (!sourceOrigin || !username) throw new Error('invalidSource');
      const records = await this.load();
      for (const [id, record] of Object.entries(records))
        if (record.tabId === input.tabId) delete records[id];
      const createdAt = this.now();
      this.usernames[String(input.tabId)] = {
        ...input, username, sourceOrigin, createdAt, expiresAt: createdAt + this.ttlMs,
      };
      await this.persist();
    });
  }

  async stage(input: CredentialCandidate & { tabId: number; sourceUrl: string }): Promise<string> {
    return this.exclusive(async () => {
      const sourceOrigin = this.pageOrigin(input.sourceUrl);
      if (!sourceOrigin) throw new Error('invalidSource');
      const records = await this.load();
      for (const [id, record] of Object.entries(records))
        if (record.tabId === input.tabId) delete records[id];
      const usernameKey = String(input.tabId);
      const stagedUsername = this.usernames[usernameKey];
      delete this.usernames[usernameKey];
      const username = input.username.trim()
        ? input.username
        : stagedUsername && urlMatches(stagedUsername.sourceUrl, input.sourceUrl) ? stagedUsername.username : '';
      let id = this.randomId();
      while (records[id]) id = this.randomId();
      const createdAt = this.now();
      records[id] = { ...input, username, id, sourceOrigin, createdAt, expiresAt: createdAt + this.ttlMs };
      await this.persist();
      return id;
    });
  }

  async pendingForPage(tabId: number, pageUrl: string): Promise<SafeCredentialCapture | null> {
    return this.exclusive(async () => {
      const promptOrigin = this.pageOrigin(pageUrl);
      if (!promptOrigin) return null;
      const records = await this.load();
      const record = Object.values(records)
        .filter(candidate => candidate.tabId === tabId && urlMatches(candidate.sourceUrl, pageUrl))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!record) return null;
      record.promptOrigin = promptOrigin;
      await this.persist();
      return {
        captureId: record.id,
        site: new URL(record.sourceUrl).hostname.toLowerCase().replace(/^www\./, ''),
        username: record.username,
        kind: record.kind,
      };
    });
  }

  async authorizeAction(captureId: string, authority: CaptureAuthority): Promise<CredentialCaptureRecord | null> {
    return this.exclusive(() => this.authorized(captureId, authority));
  }

  async markMutation(captureId: string, authority: CaptureAuthority, mutation: NonNullable<CredentialCaptureRecord['mutation']>): Promise<boolean> {
    return this.exclusive(async () => {
      const record = await this.authorized(captureId, authority);
      if (!record) return false;
      record.mutation = mutation;
      await this.persist();
      return true;
    });
  }

  async dismiss(captureId: string, authority: CaptureAuthority): Promise<boolean> {
    return this.exclusive(async () => {
      const record = await this.authorized(captureId, authority);
      if (!record) return false;
      delete this.records[captureId];
      await this.persist();
      return true;
    });
  }

  async clearTab(tabId: number): Promise<void> {
    await this.exclusive(async () => {
      const records = await this.load();
      let changed = false;
      for (const [id, record] of Object.entries(records)) {
        if (record.tabId === tabId) { delete records[id]; changed = true; }
      }
      if (this.usernames[String(tabId)]) { delete this.usernames[String(tabId)]; changed = true; }
      if (changed) await this.persist();
    });
  }

  async clearAll(): Promise<void> {
    await this.exclusive(async () => {
      this.records = {};
      this.usernames = {};
      this.hydrated = true;
      if (!this.storage) return;
      try {
        await this.storage.remove(CREDENTIAL_CAPTURE_KEY);
        await this.storage.remove(CREDENTIAL_USERNAME_KEY);
      }
      catch { this.storage = null; }
    });
  }
}
