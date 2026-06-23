import { providerFor } from './cloudRouting';
import { DropboxProvider } from '../../background/sources/dropbox';
import { GDriveProvider } from '../../background/sources/gdrive';

test('providerFor returns the matching provider impl', () => {
  expect(providerFor('dropbox')).toBeInstanceOf(DropboxProvider);
  expect(providerFor('gdrive')).toBeInstanceOf(GDriveProvider);
});

test('providerFor memoizes one instance per provider', () => {
  expect(providerFor('dropbox')).toBe(providerFor('dropbox'));
});
