import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto';
import { urlMatches } from './matcher';
import type { EntryView, EntryField, TreeNode, EntrySummary } from '../shared/entry';
import { CARD_FLAG_KEY } from '../shared/entry';

const STD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', CARD_FLAG_KEY]);

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

  private toSummary(e: kdbxweb.KdbxEntry): EntrySummary {
    return {
      id: e.uuid.id,
      title: str(e.fields.get('Title')),
      username: str(e.fields.get('UserName')),
      url: str(e.fields.get('URL')),
      expired: this.isExpired(e),
      isCard: str(e.fields.get(CARD_FLAG_KEY)) === '1',
    };
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
    };
  }

  getEntry(id: string): EntryView | null { const e = this.findEntry(id); return e ? this.toView(e) : null; }

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
        return { id: v.id, title: v.title, username: v.username, url: v.url, expired: v.expired, isCard: v.isCard }; }),
      children: g.groups.filter(c => !this.isRecycleBin(c)).map(build),
    });
    return build(this.root);
  }

  createEntry(groupId: string, fields: Record<string, string>): string {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(groupId);
    if (!g) throw new Error('no group');
    const e = this.db.createEntry(g);
    this.applyFields(e, fields); this.dirty = true; return e.uuid.id;
  }

  updateEntry(id: string, fields: Record<string, string>, expires?: number | null, removeKeys?: string[]): void {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    if (removeKeys) for (const k of removeKeys) if (!STD.has(k)) e.fields.delete(k);
    this.applyFields(e, fields);
    if (expires !== undefined) {
      if (expires === null) { e.times.expires = false; }
      else { e.times.expires = true; e.times.expiryTime = new Date(expires); }
    }
    e.times.update(); this.dirty = true;
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

  private applyFields(e: kdbxweb.KdbxEntry, fields: Record<string, string>) {
    for (const [k, val] of Object.entries(fields)) {
      const prot = k === 'Password' || (e.fields.get(k) instanceof kdbxweb.ProtectedValue);
      e.fields.set(k, prot ? kdbxweb.ProtectedValue.fromString(val) : val);
    }
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
