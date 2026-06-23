import type { CloudProvider } from '../../background/sources/cloudProvider';
import { DropboxProvider } from '../../background/sources/dropbox';
import { GDriveProvider } from '../../background/sources/gdrive';
import { FakeCloudProvider } from '../../background/sources/fakeCloudProvider';

const instances = new Map<'dropbox' | 'gdrive', CloudProvider>();

let override: CloudProvider | null = null;

/** TEST ONLY: force providerFor to return a scriptable fake. */
export function __setProviderOverride(p: CloudProvider | null): void {
  if (import.meta.env.VITE_QK_TEST !== '1') return;
  override = p;
}

export function providerFor(id: 'dropbox' | 'gdrive'): CloudProvider {
  if (override) return override;
  let p = instances.get(id);
  if (!p) { p = id === 'dropbox' ? new DropboxProvider() : new GDriveProvider(); instances.set(id, p); }
  return p;
}

export function __makeFake(id: 'dropbox' | 'gdrive'): FakeCloudProvider { return new FakeCloudProvider(id); }

/** TEST ONLY: true when a fake override is active. */
export function __hasOverride(): boolean { return override !== null; }
