import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Welcome } from './Welcome';

const mocks = vi.hoisted(() => ({ send: vi.fn(), pickNewDb: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../background/fileHandle', () => ({
  loadHandle: async () => ({ name: 'Existing.kdbx' }),
  loadKeyHandle: async () => null,
  loadLastCloud: async () => null,
  ensurePermission: async () => true,
  clearLastCloud: vi.fn(),
}));
vi.mock('../../shared/pickFile', () => ({
  pickAndStoreNewDb: mocks.pickNewDb,
  pickAndStoreNewKeyFile: vi.fn(),
  readStoredKeyBytes: async () => null,
}));
vi.mock('../../shared/deviceQuickUnlock', () => ({ isDeviceQuickUnlockAvailable: async () => false }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://quickkee/${path}` },
    storage: { local: { get: async () => ({ settings: { theme: 'light' } }) } },
  });
  mocks.pickNewDb.mockResolvedValue('Personal.kdbx');
  mocks.send.mockImplementation(async ({ type }: { type: string }) => type === 'getQuickUnlockStatus'
    ? { ok: true, enrolled: false, corrupt: false, source: null } : { ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('introduces KeePass and exposes both database choices', () => {
  render(<Welcome />);
  expect(screen.getByRole('heading', { name: 'Welcome to QuickKee' })).toBeVisible();
  expect(screen.getByRole('button', { name: /Create database/ })).toBeVisible();
  expect(screen.getByRole('button', { name: /Open existing database/ })).toBeVisible();
  expect(screen.getByText(/free, open-source password manager/)).toBeVisible();
  expect(screen.getByRole('link', { name: /More about KeePass/ })).toHaveAttribute('href', 'https://keepass.info/');
});

test('creates a database through the shared form and offers entry into QuickKee', async () => {
  render(<Welcome />);
  fireEvent.click(screen.getByRole('button', { name: /Create database/ }));
  expect(screen.getByRole('heading', { name: 'New database' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Choose database location…' }));
  await screen.findByRole('button', { name: 'Database: Personal.kdbx' });
  fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'correct horse' } });
  fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: 'correct horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create database' }));
  expect(await screen.findByRole('heading', { name: 'Your database is ready' })).toHaveFocus();
  expect(mocks.send).toHaveBeenCalledWith({ type: 'createDatabase', destination: { kind: 'local' }, password: 'correct horse' });
  expect(screen.getByRole('link', { name: 'Open database' })).toHaveAttribute('href', 'chrome-extension://quickkee/src/pages/panel/index.html');
  expect(document.body).not.toHaveTextContent('correct horse');
});

test('opens an existing database and keeps an unlock error recoverable', async () => {
  render(<Welcome />);
  fireEvent.click(screen.getByRole('button', { name: /Open existing database/ }));
  await screen.findByRole('button', { name: 'Database: Existing.kdbx' });
  expect(screen.getByRole('tab', { name: 'Dropbox' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Google Drive' })).toBeVisible();
  mocks.send.mockResolvedValueOnce({ ok: false, error: 'badCredentials' });
  fireEvent.change(screen.getByPlaceholderText('Master password'), { target: { value: 'incorrect' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByText('Wrong password or key file')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Master password'), { target: { value: 'correct horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByRole('heading', { name: 'Your database is ready' })).toBeVisible();
});

test.each(['Create database', 'Open existing database'])('returns from %s to the focused choice', async choice => {
  render(<Welcome />);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(choice) }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to welcome' }));
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(choice) })).toHaveFocus());
});
