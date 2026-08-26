import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto';
import { urlMatches } from './matcher';
import type { EntryView, EntryField, TreeNode, EntrySummary, AttachmentMeta } from '../shared/entry';
import { CARD_FLAG_KEY, OTP_FIELD_KEY } from '../shared/entry';
import type { TotpImportAssignment } from '../shared/totpImport';
import { parseTotpInput, toOtpUri, type TotpConfig } from './totp';

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

export class Vault {
  private db: kdbxweb.Kdbx | null = null;
  private creds: kdbxweb.Credentials | null = null;
  dirty = false;

  async open(bytes: ArrayBuffer, password: string | null, keyFile: ArrayBuffer | null): Promise<void> {
    registerArgon2();
    const pv = password ? kdbxweb.ProtectedValue.fromString(password) : null;
    const creds = new kdbxweb.Credentials(pv, keyFile);
    this.db = await kdbxweb.Kdbx.load(bytes, creds);
    this.creds = creds;
    this.dirty = false;
  }

  isOpen() { return this.db !== null; }
  lock() { this.db = null; this.creds = null; this.dirty = false; }

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

  private isExpired(e: kdbxweb.KdbxEntry): boolean {
    return e.times.expires === true && e.times.expiryTime
      ? e.times.expiryTime.getTime() < Date.now()
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
    e.times.update(); this.dirty = true;
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

  createEntry(groupId: string, fields: Record<string, string>, totp?: TotpConfig): string {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(groupId);
    if (!g) throw new Error('no group');
    const otpUri = totp ? toOtpUri(totp) : null;
    const e = this.db.createEntry(g);
    this.applyFields(e, fields);
    if (otpUri) e.fields.set(OTP_FIELD_KEY, kdbxweb.ProtectedValue.fromString(otpUri));
    this.dirty = true; return e.uuid.id;
  }

  updateEntry(id: string, fields: Record<string, string>, expires?: number | null, removeKeys?: string[], totp?: TotpConfig | null): void {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
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
    e.times.update(); this.dirty = true;
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
    this.dirty = true;
  }

  updateGroup(id: string, fields: Record<string, string>): void {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(id); if (!g) throw new Error('no group');
    if (fields.Name != null) g.name = fields.Name; this.dirty = true;
  }

  createGroup(parentId: string, name: string): string {
    if (!this.db) throw new Error('locked');
    const parent = this.findGroup(parentId); if (!parent) throw new Error('no group');
    const g = this.db.createGroup(parent, name);
    this.dirty = true; return g.uuid.id;
  }

  deleteGroup(id: string): void {
    if (!this.db) throw new Error('locked');
    if (id === this.root.uuid.id) throw new Error('cannot delete root');
    const g = this.findGroup(id); if (!g) throw new Error('no group');
    this.db.remove(g); this.dirty = true;
  }

  deleteEntry(id: string): void {
    if (!this.db) throw new Error('locked');
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    this.db.remove(e); this.dirty = true;
  }

  async addAttachment(entryId: string, name: string, data: ArrayBuffer): Promise<void> {
    if (!this.db) throw new Error('locked');
    const e = this.findEntry(entryId); if (!e) throw new Error('no entry');
    const bin = await this.db.createBinary(data);
    e.binaries.set(name, bin);
    // Cleans up the previous pool entry if `name` was overwritten and its hash isn't shared elsewhere.
    await this.db.cleanup({ binaries: true });
    this.dirty = true;
  }

  removeAttachment(entryId: string, name: string): void {
    if (!this.db) throw new Error('locked');
    const e = this.findEntry(entryId); if (!e) throw new Error('no entry');
    if (!e.binaries.delete(name)) throw new Error('no attachment');
    this.db.cleanup({ binaries: true });
    this.dirty = true;
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
  async mergeRemote(remoteBytes: ArrayBuffer): Promise<void> {
    if (!this.db || !this.creds) throw new Error('locked');
    const remote = await kdbxweb.Kdbx.load(remoteBytes, this.creds);
    this.db.merge(remote);
    this.dirty = true;
  }

  async serialize(): Promise<ArrayBuffer> {
    if (!this.db) throw new Error('locked');
    return this.db.save();
  }
}
