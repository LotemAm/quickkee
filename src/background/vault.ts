import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto';
import { urlMatches } from './matcher';
import type { EntryView, EntryField, TreeNode, EntrySummary, AttachmentMeta } from '../shared/entry';
import { CARD_FLAG_KEY, OTP_FIELD_KEY } from '../shared/entry';
import type { TotpImportAssignment } from '../shared/totpImport';
import { parseTotpInput, toOtpUri, type TotpConfig } from './totp';
import { analyzePasswordHealth, type PasswordHealthInput } from './passwordHealth';
import type { PasswordHealthReport } from '../shared/passwordHealth';

const TOTP_SEED_KEY = 'TOTP Seed';
const TOTP_SETTINGS_KEY = 'TOTP Settings';
const KP_TOTP_SECRET_KEY = 'TimeOtp-Secret-Base32';
const KP_TOTP_ALGORITHM_KEY = 'TimeOtp-Algorithm';
const KP_TOTP_LENGTH_KEY = 'TimeOtp-Length';
const KP_TOTP_PERIOD_KEY = 'TimeOtp-Period';
const TOTP_KEYS = [
  OTP_FIELD_KEY, TOTP_SEED_KEY, TOTP_SETTINGS_KEY, KP_TOTP_SECRET_KEY,
  KP_TOTP_ALGORITHM_KEY, KP_TOTP_LENGTH_KEY, KP_TOTP_PERIOD_KEY,
];
const STD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', CARD_FLAG_KEY, ...TOTP_KEYS]);

/** True only when an error means the password/key file was wrong — not when load
 *  failed for another reason (corrupt file, missing Argon2/WASM, runtime fault). */
export function isInvalidKey(e: unknown): boolean {
  return e instanceof kdbxweb.KdbxError && e.code === kdbxweb.Consts.ErrorCodes.InvalidKey;
}
const str = (v: unknown): string =>
  v == null ? '' : v instanceof kdbxweb.ProtectedValue ? v.getText() : String(v);

/** Opaque, single-use preparation: only encrypted bytes can leave the candidate. */
export interface PreparedOpen {
  mergeRemote(bytes: ArrayBuffer, isCurrent?: () => boolean): Promise<void>;
  serialize(): Promise<ArrayBuffer>;
  markCached(): void;
  discard(): void;
}

export class Vault {
  private static readonly prepared = new WeakMap<PreparedOpen, {
    owner: Vault; candidate: Vault; generation: number; version: number; busy: boolean;
  }>();
  private db: kdbxweb.Kdbx | null = null;
  private creds: kdbxweb.Credentials | null = null;
  private generation = 0;
  private version = 0;
  dirty = false;

  /** Live mutations are independent of lifecycle identity and persisted KeePass times. */
  get mutationVersion(): number { return this.version; }
  private markMutation(): void { ++this.version; this.dirty = true; }

  acknowledgeCached(session: number, mutationVersion: number): void {
    if (this.isSessionCurrent(session) && this.version === mutationVersion) this.dirty = false;
  }

  /** Identity of the current lifecycle, unchanged by ordinary entry edits. */
  get lifecycleGeneration(): number { return this.generation; }
  isSessionCurrent(token: number): boolean { return this.isOpen() && token === this.generation; }

  async open(bytes: ArrayBuffer, password: string | null, keyFile: ArrayBuffer | null): Promise<number> {
    const generation = this.generation;
    registerArgon2();
    const pv = password ? kdbxweb.ProtectedValue.fromString(password) : null;
    const creds = new kdbxweb.Credentials(pv, keyFile);
    const db = await kdbxweb.Kdbx.load(bytes, creds);
    // A lock or another successful open owns the lifecycle now.
    if (generation !== this.generation) throw new Error('staleSession');
    this.db = db;
    this.creds = creds;
    this.dirty = false;
    return ++this.generation;
  }

  async prepareOpen(bytes: ArrayBuffer, password: string | null, keyFile: ArrayBuffer | null): Promise<PreparedOpen> {
    const state = { owner: this, candidate: new Vault(), generation: this.generation, version: this.version, busy: false };
    await state.candidate.open(bytes, password, keyFile);
    if (this.generation !== state.generation || this.version !== state.version) {
      state.candidate.lock();
      throw new Error('staleSession');
    }
    const current = () => {
      if (!Vault.prepared.has(prepared)) throw new Error('consumedPreparedOpen');
      if (state.busy) throw new Error('busyPreparedOpen');
    };
    const run = async <T>(work: () => Promise<T>): Promise<T> => {
      current(); state.busy = true;
      try { return await work(); }
      finally { state.busy = false; }
    };
    const prepared: PreparedOpen = {
      mergeRemote: (remote, isCurrent) => run(() => state.candidate.mergeRemote(remote, isCurrent)),
      serialize: () => run(() => state.candidate.serialize()),
      markCached: () => { current(); state.candidate.dirty = false; },
      discard: () => { Vault.prepared.delete(prepared); state.candidate.lock(); },
    };
    Vault.prepared.set(prepared, state);
    return prepared;
  }

  /** Synchronous ownership transfer into this same live Vault; never copy candidate counters. */
  adoptPrepared(prepared: PreparedOpen): number {
    const state = Vault.prepared.get(prepared);
    if (!state) throw new Error('consumedPreparedOpen');
    if (state.owner !== this) throw new Error('foreignPreparedOpen');
    if (state.busy) throw new Error('busyPreparedOpen');
    if (this.generation !== state.generation || this.version !== state.version) throw new Error('staleSession');
    this.db = state.candidate.db;
    this.creds = state.candidate.creds;
    this.dirty = state.candidate.dirty;
    ++this.version;
    Vault.prepared.delete(prepared);
    state.candidate.lock();
    return ++this.generation;
  }

  isOpen() { return this.db !== null; }
  lock() { ++this.generation; this.db = null; this.creds = null; this.dirty = false; }

  private get root() { if (!this.db) throw new Error('locked'); return this.db.getDefaultGroup(); }

  private findEntry(id: string): kdbxweb.KdbxEntry | null {
    if (!this.db) return null;
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (e.uuid.id === id) return e;
    return null;
  }

  private findGroup(id: string): kdbxweb.KdbxGroup | null {
    if (!this.db) return null;
    for (const g of this.allGroups(this.root)) if (g.uuid.id === id) return g;
    return null;
  }

  // True for the Recycle Bin group itself: kdbxweb's db.remove() moves deleted
  // entries/groups there rather than purging them, but a "deleted" item must
  // not stay visible to lookups, listings, or autofill. Recycle-bin management
  // UI (view/restore/empty) is explicitly out of scope.
  private isRecycleBin(g: kdbxweb.KdbxGroup): boolean {
    return !!this.db?.meta.recycleBinUuid && g.uuid.id === this.db.meta.recycleBinUuid.id;
  }

  // Skips the Recycle Bin group and its descendants (see isRecycleBin above).
  private *allGroups(g: kdbxweb.KdbxGroup): Generator<kdbxweb.KdbxGroup> {
    if (this.isRecycleBin(g)) return;
    yield g; for (const c of g.groups) yield* this.allGroups(c);
  }

  private isExpired(e: kdbxweb.KdbxEntry, now = Date.now()): boolean {
    return e.times.expires === true && e.times.expiryTime
      ? e.times.expiryTime.getTime() < now
      : false;
  }

  private readTotp(e: kdbxweb.KdbxEntry): TotpConfig | null {
    const otp = str(e.fields.get(OTP_FIELD_KEY));
    if (otp) return parseTotpInput(otp);

    const legacySettings = str(e.fields.get(TOTP_SETTINGS_KEY));
    const legacySeed = str(e.fields.get(TOTP_SEED_KEY));
    if (legacySettings || legacySeed) {
      const params = new URLSearchParams(legacySettings);
      if (params.has('key')) {
        return this.totpFromParts(
          params.get('key') ?? legacySeed,
          params.get('otpHashMode'),
          params.get('size'),
          params.get('step'),
        );
      }
      const [period, digits] = legacySettings.split(';');
      return this.totpFromParts(legacySeed, null, digits, period);
    }

    const nativeSeed = str(e.fields.get(KP_TOTP_SECRET_KEY));
    if (!nativeSeed) return null;
    return this.totpFromParts(
      nativeSeed,
      str(e.fields.get(KP_TOTP_ALGORITHM_KEY)) || null,
      str(e.fields.get(KP_TOTP_LENGTH_KEY)) || null,
      str(e.fields.get(KP_TOTP_PERIOD_KEY)) || null,
    );
  }

  private totpFromParts(secret: string, algorithm: string | null, digits: string | null, period: string | null): TotpConfig {
    const query = new URLSearchParams({ secret });
    if (algorithm) query.set('algorithm', algorithm);
    if (digits) query.set('digits', digits);
    if (period) query.set('period', period);
    return parseTotpInput(`otpauth://totp/QuickKee:none?${query}`);
  }

  private totpMeta(e: kdbxweb.KdbxEntry): { hasTotp: boolean; totpPeriod: number | null } {
    const configured = TOTP_KEYS.some(key => str(e.fields.get(key)) !== '');
    if (!configured) return { hasTotp: false, totpPeriod: null };
    try {
      const config = this.readTotp(e);
      return { hasTotp: true, totpPeriod: config?.period ?? null };
    } catch {
      return { hasTotp: true, totpPeriod: null };
    }
  }

  private toSummary(e: kdbxweb.KdbxEntry): EntrySummary {
    const totp = this.totpMeta(e);
    return {
      id: e.uuid.id,
      title: str(e.fields.get('Title')),
      username: str(e.fields.get('UserName')),
      url: str(e.fields.get('URL')),
      expired: this.isExpired(e),
      isCard: str(e.fields.get(CARD_FLAG_KEY)) === '1',
      ...totp,
      hasAttachments: e.binaries.size > 0,
    };
  }

  private toAttachments(e: kdbxweb.KdbxEntry): AttachmentMeta[] {
    const out: AttachmentMeta[] = [];
    e.binaries.forEach((b, name) => {
      const val = 'hash' in b ? b.value : b;
      out.push({ name, size: val.byteLength });
    });
    return out;
  }

  private toView(e: kdbxweb.KdbxEntry): EntryView {
    const fields: EntryField[] = [];
    e.fields.forEach((v, k) => {
      if (!STD.has(k)) fields.push({ key: k, value: str(v), protected: v instanceof kdbxweb.ProtectedValue });
    });
    return {
      id: e.uuid.id,
      title: str(e.fields.get('Title')),
      username: str(e.fields.get('UserName')),
      url: str(e.fields.get('URL')),
      password: str(e.fields.get('Password')),
      fields,
      expired: this.isExpired(e),
      created: e.times.creationTime ? e.times.creationTime.getTime() : null,
      expires: e.times.expires === true && e.times.expiryTime ? e.times.expiryTime.getTime() : null,
      isCard: str(e.fields.get(CARD_FLAG_KEY)) === '1',
      ...this.totpMeta(e),
      attachments: this.toAttachments(e),
    };
  }

  getEntry(id: string): EntryView | null { const e = this.findEntry(id); return e ? this.toView(e) : null; }

  getTotpConfig(id: string): TotpConfig | null {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    return this.readTotp(e);
  }

  setTotpConfig(id: string, config: TotpConfig | null): void {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    const otpUri = config ? toOtpUri(config) : null;
    this.replaceTotp(e, otpUri);
    e.times.update(); this.markMutation();
  }

  entriesForUrl(pageUrl: string): EntryView[] {
    const out: EntryView[] = [];
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (urlMatches(str(e.fields.get('URL')), pageUrl)) out.push(this.toView(e));
    return out;
  }

  entrySummariesForUrl(pageUrl: string): EntrySummary[] {
    const out: EntrySummary[] = [];
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (urlMatches(str(e.fields.get('URL')), pageUrl)) out.push(this.toSummary(e));
    return out;
  }

  // Card entries aren't inherently tied to one site the way logins are, so an entry
  // left without a URL is treated as matching every site here (unlike entrySummariesForUrl,
  // which requires a URL match unconditionally). A card entry that DOES have a URL set is
  // still restricted to that site, same as a regular login entry.
  cardSummariesForUrl(pageUrl: string): EntrySummary[] {
    const out: EntrySummary[] = [];
    for (const g of this.allGroups(this.root)) for (const e of g.entries) {
      if (str(e.fields.get(CARD_FLAG_KEY)) !== '1') continue;
      const url = str(e.fields.get('URL'));
      if (!url || urlMatches(url, pageUrl)) out.push(this.toSummary(e));
    }
    return out;
  }

  countForUrl(pageUrl: string): number {
    let n = 0;
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (urlMatches(str(e.fields.get('URL')), pageUrl)) n++;
    return n;
  }

  getTree(): TreeNode {
    // Mirrors allGroups()'s exclusion so the Recycle Bin subtree never shows
    // up in the panel's tree/search, consistent with findEntry/findGroup/
    // entriesForUrl (see isRecycleBin above).
    const build = (g: kdbxweb.KdbxGroup): TreeNode => ({
      groupId: g.uuid.id, name: str(g.name),
      entries: g.entries.map(e => { const v = this.toView(e);
        return {
          id: v.id, title: v.title, username: v.username, url: v.url, expired: v.expired,
          isCard: v.isCard, hasTotp: v.hasTotp, totpPeriod: v.totpPeriod,
          hasAttachments: v.attachments.length > 0,
        }; }),
      children: g.groups.filter(c => !this.isRecycleBin(c)).map(build),
    });
    return build(this.root);
  }

  getPasswordHealthReport(now = Date.now()): PasswordHealthReport {
    const inputs: PasswordHealthInput[] = [];
    for (const group of this.allGroups(this.root)) for (const entry of group.entries) {
      const isCard = str(entry.fields.get(CARD_FLAG_KEY)) === '1';
      if (isCard) continue;
      const username = str(entry.fields.get('UserName'));
      const url = str(entry.fields.get('URL'));
      const password = str(entry.fields.get('Password'));
      if (!username && !url && !password) continue;
      inputs.push({
        entryId: entry.uuid.id,
        title: str(entry.fields.get('Title')),
        username,
        url,
        password,
        modifiedAt: entry.times.lastModTime?.getTime() ?? null,
        expired: this.isExpired(entry, now),
        isCard,
      });
    }
    return analyzePasswordHealth(inputs, now);
  }

  createEntry(groupId: string, fields: Record<string, string>, totp?: TotpConfig): string {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(groupId);
    if (!g) throw new Error('no group');
    const otpUri = totp ? toOtpUri(totp) : null;
    const e = this.db.createEntry(g);
    this.applyFields(e, fields);
    if (otpUri) e.fields.set(OTP_FIELD_KEY, kdbxweb.ProtectedValue.fromString(otpUri));
    this.markMutation(); return e.uuid.id;
  }

  updateEntry(id: string, fields: Record<string, string>, expires?: number | null, removeKeys?: string[], totp?: TotpConfig | null, groupId?: string): void {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    const destination = groupId === undefined ? null : this.findGroup(groupId);
    if (groupId !== undefined && !destination) throw new Error('no group');
    const otpUri = totp ? toOtpUri(totp) : null;
    if (removeKeys) for (const k of removeKeys) if (!STD.has(k)) e.fields.delete(k);
    this.applyFields(e, fields);
    if (totp !== undefined) {
      this.replaceTotp(e, otpUri);
    }
    if (expires !== undefined) {
      if (expires === null) { e.times.expires = false; }
      else { e.times.expires = true; e.times.expiryTime = new Date(expires); }
    }
    if (destination && e.parentGroup !== destination) this.db!.move(e, destination);
    e.times.update(); this.markMutation();
  }

  moveEntry(id: string, groupId: string): void {
    if (!this.db) throw new Error('locked');
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    const destination = this.findGroup(groupId); if (!destination) throw new Error('no group');
    if (e.parentGroup === destination) return;
    this.db.move(e, destination);
    e.times.update(); this.markMutation();
  }

  importTotp(assignments: TotpImportAssignment[]): void {
    if (!this.db) throw new Error('locked');
    if (assignments.length === 0) throw new Error('no TOTP keys');

    const keyIds = new Set<string>();
    const existingEntryIds = new Set<string>();
    type PreparedImport =
      | { kind: 'existing'; assignment: TotpImportAssignment; otpUri: string; entry: kdbxweb.KdbxEntry }
      | { kind: 'new'; assignment: TotpImportAssignment; otpUri: string; group: kdbxweb.KdbxGroup };
    const prepared: PreparedImport[] = assignments.map(assignment => {
      if (keyIds.has(assignment.keyId)) throw new Error('duplicate TOTP key');
      keyIds.add(assignment.keyId);
      const otpUri = toOtpUri(assignment.config);
      if (assignment.destination.type === 'existing') {
        if (existingEntryIds.has(assignment.destination.entryId)) throw new Error('duplicate entry destination');
        existingEntryIds.add(assignment.destination.entryId);
        const entry = this.findEntry(assignment.destination.entryId);
        if (!entry) throw new Error('no entry');
        return { kind: 'existing', assignment, otpUri, entry };
      }
      const group = this.findGroup(assignment.destination.groupId);
      if (!group) throw new Error('no group');
      return { kind: 'new', assignment, otpUri, group };
    });

    for (const item of prepared) {
      if (item.kind === 'existing') {
        this.replaceTotp(item.entry, item.otpUri);
        item.entry.times.update();
      } else {
        const entry = this.db.createEntry(item.group);
        this.applyFields(entry, item.assignment.destination.type === 'new' ? item.assignment.destination.fields : {});
        this.replaceTotp(entry, item.otpUri);
      }
    }
    this.markMutation();
  }

  updateGroup(id: string, fields: Record<string, string>): void {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(id); if (!g) throw new Error('no group');
    if (fields.Name != null) {
      g.name = fields.Name;
      g.times.update();
    }
    this.markMutation();
  }

  createGroup(parentId: string, name: string): string {
    if (!this.db) throw new Error('locked');
    const parent = this.findGroup(parentId); if (!parent) throw new Error('no group');
    const g = this.db.createGroup(parent, name);
    this.markMutation(); return g.uuid.id;
  }

  deleteGroup(id: string): void {
    if (!this.db) throw new Error('locked');
    if (id === this.root.uuid.id) throw new Error('cannot delete root');
    const g = this.findGroup(id); if (!g) throw new Error('no group');
    this.db.remove(g); this.markMutation();
  }

  deleteEntry(id: string): void {
    if (!this.db) throw new Error('locked');
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    this.db.remove(e); this.markMutation();
  }

  async addAttachment(entryId: string, name: string, data: ArrayBuffer): Promise<void> {
    if (!this.db) throw new Error('locked');
    const db = this.db; const session = this.generation;
    const e = this.findEntry(entryId); if (!e) throw new Error('no entry');
    const bin = await db.createBinary(data);
    if (!this.isSessionCurrent(session) || this.db !== db) throw new Error('staleSession');
    e.binaries.set(name, bin);
    e.times.update();
    this.markMutation();
    // Cleans up the previous pool entry if `name` was overwritten and its hash isn't shared elsewhere.
    db.cleanup({ binaries: true });
  }

  removeAttachment(entryId: string, name: string): void {
    if (!this.db) throw new Error('locked');
    const e = this.findEntry(entryId); if (!e) throw new Error('no entry');
    if (!e.binaries.delete(name)) throw new Error('no attachment');
    e.times.update();
    this.db.cleanup({ binaries: true });
    this.markMutation();
  }

  getAttachmentBytes(entryId: string, name: string): ArrayBuffer | null {
    const e = this.findEntry(entryId); if (!e) return null;
    const b = e.binaries.get(name); if (!b) return null;
    const val = 'hash' in b ? b.value : b;
    return val instanceof kdbxweb.ProtectedValue ? val.getBinary().buffer as ArrayBuffer : val;
  }

  private applyFields(e: kdbxweb.KdbxEntry, fields: Record<string, string>) {
    for (const [k, val] of Object.entries(fields)) {
      const prot = k === 'Password' || k === OTP_FIELD_KEY || k === TOTP_SEED_KEY || k === KP_TOTP_SECRET_KEY
        || (e.fields.get(k) instanceof kdbxweb.ProtectedValue);
      e.fields.set(k, prot ? kdbxweb.ProtectedValue.fromString(val) : val);
    }
  }

  private replaceTotp(e: kdbxweb.KdbxEntry, otpUri: string | null): void {
    for (const key of TOTP_KEYS) e.fields.delete(key);
    if (otpUri) e.fields.set(OTP_FIELD_KEY, kdbxweb.ProtectedValue.fromString(otpUri));
  }

  /** Load remote bytes with the same credentials and merge them into the
   *  in-memory DB (KeePass-native union; local.merge(remote)). */
  async mergeRemote(remoteBytes: ArrayBuffer, isCurrent: () => boolean = () => true): Promise<void> {
    if (!this.db || !this.creds) throw new Error('locked');
    const db = this.db; const creds = this.creds; const session = this.generation;
    if (!isCurrent()) throw new Error('staleSession');
    const remote = await kdbxweb.Kdbx.load(remoteBytes, creds);
    if (!this.isSessionCurrent(session) || this.db !== db || !isCurrent()) throw new Error('staleSession');
    db.merge(remote);
    this.markMutation();
  }

  async serialize(): Promise<ArrayBuffer> {
    if (!this.db) throw new Error('locked');
    return this.db.save();
  }
}
