import type { CloudProvider } from '../../background/sources/cloudProvider';
import { DropboxProvider } from '../../background/sources/dropbox';
import { GDriveProvider } from '../../background/sources/gdrive';

const instances = new Map<'dropbox' | 'gdrive', CloudProvider>();

export function providerFor(id: 'dropbox' | 'gdrive'): CloudProvider {
  let p = instances.get(id);
  if (!p) { p = id === 'dropbox' ? new DropboxProvider() : new GDriveProvider(); instances.set(id, p); }
  return p;
}
