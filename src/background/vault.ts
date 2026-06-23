import * as kdbxweb from 'kdbxweb';
import { registerArgon2 } from './crypto';
import { urlMatches } from './matcher';
import type { EntryView, EntryField, TreeNode } from '../shared/entry';

const STD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);

/** True only when an error means the password/key file was wrong — not when load
 *  failed for another reason (corrupt file, missing Argon2/WASM, runtime fault). */
export function isInvalidKey(e: unknown): boolean {
  return e instanceof kdbxweb.KdbxError && e.code === kdbxweb.Consts.ErrorCodes.InvalidKey;
}
const str = (v: unknown): string =>
  v == null ? '' : v instanceof kdbxweb.ProtectedValue ? v.getText() : String(v);

export class Vault {
  private db: kdbxweb.Kdbx | null = null;
  dirty = false;

  async open(bytes: ArrayBuffer, password: string | null, keyFile: ArrayBuffer | null): Promise<void> {
    registerArgon2();
    const pv = password ? kdbxweb.ProtectedValue.fromString(password) : null;
    const creds = new kdbxweb.Credentials(pv, keyFile);
    this.db = await kdbxweb.Kdbx.load(bytes, creds);
    this.dirty = false;
  }

  isOpen() { return this.db !== null; }
  lock() { this.db = null; this.dirty = false; }

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

  private *allGroups(g: kdbxweb.KdbxGroup): Generator<kdbxweb.KdbxGroup> {
    yield g; for (const c of g.groups) yield* this.allGroups(c);
  }

  private toView(e: kdbxweb.KdbxEntry): EntryView {
    const fields: EntryField[] = [];
    e.fields.forEach((v, k) => {
      if (!STD.has(k)) fields.push({ key: k, value: str(v), protected: v instanceof kdbxweb.ProtectedValue });
    });
    const exp = e.times.expires === true && e.times.expiryTime
      ? e.times.expiryTime.getTime() < Date.now()
      : false;
    return {
      id: e.uuid.id,
      title: str(e.fields.get('Title')),
      username: str(e.fields.get('UserName')),
      url: str(e.fields.get('URL')),
      password: str(e.fields.get('Password')),
      fields,
      expired: exp,
    };
  }

  getEntry(id: string): EntryView | null { const e = this.findEntry(id); return e ? this.toView(e) : null; }

  entriesForUrl(pageUrl: string): EntryView[] {
    const out: EntryView[] = [];
    for (const g of this.allGroups(this.root)) for (const e of g.entries)
      if (urlMatches(str(e.fields.get('URL')), pageUrl)) out.push(this.toView(e));
    return out;
  }

  getTree(): TreeNode {
    const build = (g: kdbxweb.KdbxGroup): TreeNode => ({
      groupId: g.uuid.id, name: str(g.name),
      entries: g.entries.map(e => { const v = this.toView(e);
        return { id: v.id, title: v.title, username: v.username, url: v.url, expired: v.expired }; }),
      children: g.groups.map(build),
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

  updateEntry(id: string, fields: Record<string, string>): void {
    const e = this.findEntry(id); if (!e) throw new Error('no entry');
    this.applyFields(e, fields); e.times.update(); this.dirty = true;
  }

  updateGroup(id: string, fields: Record<string, string>): void {
    if (!this.db) throw new Error('locked');
    const g = this.findGroup(id); if (!g) throw new Error('no group');
    if (fields.Name != null) g.name = fields.Name; this.dirty = true;
  }

  private applyFields(e: kdbxweb.KdbxEntry, fields: Record<string, string>) {
    for (const [k, val] of Object.entries(fields)) {
      const prot = k === 'Password' || (e.fields.get(k) instanceof kdbxweb.ProtectedValue);
      e.fields.set(k, prot ? kdbxweb.ProtectedValue.fromString(val) : val);
    }
  }

  async serialize(): Promise<ArrayBuffer> {
    if (!this.db) throw new Error('locked');
    const buf = await this.db.save(); this.dirty = false; return buf;
  }
}
