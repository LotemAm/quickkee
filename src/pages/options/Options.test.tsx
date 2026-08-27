// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Options } from './Options';
import { DEFAULT_SETTINGS } from '../../shared/settings';

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  sendToSW: vi.fn(),
}));

vi.mock('../../shared/settings', async () => ({
  ...await vi.importActual<typeof import('../../shared/settings')>('../../shared/settings'),
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings,
}));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.sendToSW }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.sendToSW.mockImplementation(async (request: { type: string; provider?: string }) => {
    if (request.type === 'getCloudConnectionStatus')
      return { ok: true, connected: { dropbox: true, gdrive: false } };
    return { ok: true };
  });
});

function accountRow(label: string): HTMLElement {
  return screen.getByText(label).closest<HTMLElement>('.account-row')!;
}

describe('Connected accounts', () => {
  test('shows persisted connections and disables sign out for disconnected providers', async () => {
    render(<Options />);

    await screen.findByLabelText('Dropbox connected');
    const rows = ['Dropbox', 'Google Drive'].map(accountRow);
    expect(within(rows[0]).getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(within(rows[1]).getByRole('button', { name: 'Sign out' })).toBeDisabled();
    expect(within(rows[1]).getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  test('shows a success indicator and disables sign out after disconnecting', async () => {
    render(<Options />);
    await screen.findByLabelText('Dropbox connected');
    const dropboxRow = accountRow('Dropbox');

    fireEvent.click(within(dropboxRow).getByRole('button', { name: 'Sign out' }));

    expect(await within(dropboxRow).findByRole('status')).toHaveTextContent('Signed out');
    expect(within(dropboxRow).getByRole('button', { name: 'Sign out' })).toBeDisabled();
    expect(within(dropboxRow).getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  test('replaces Connect with the Connected pill after connecting', async () => {
    render(<Options />);
    await screen.findByLabelText('Dropbox connected');
    const gdriveRow = accountRow('Google Drive');

    fireEvent.click(within(gdriveRow).getByRole('button', { name: 'Connect' }));

    expect(await within(gdriveRow).findByLabelText('Google Drive connected')).toHaveTextContent('Connected');
    expect(within(gdriveRow).getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
});
