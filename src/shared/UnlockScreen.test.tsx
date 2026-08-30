// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { UnlockScreen } from './UnlockScreen';

const mocks = vi.hoisted(() => ({
  sendToSW: vi.fn(),
  loadHandle: vi.fn(),
  ensurePermission: vi.fn(),
  loadKeyHandle: vi.fn(),
  loadLastCloud: vi.fn(),
  saveLastCloud: vi.fn(),
  clearLastCloud: vi.fn(),
  clearKeyHandle: vi.fn(),
  readStoredKeyBytes: vi.fn(),
  createDeviceCredential: vi.fn(),
  getDevicePrfOutput: vi.fn(),
  isDeviceQuickUnlockAvailable: vi.fn(),
}));

vi.mock('./messages', () => ({ sendToSW: mocks.sendToSW }));
vi.mock('../background/fileHandle', () => ({
  loadHandle: mocks.loadHandle,
  ensurePermission: mocks.ensurePermission,
  loadKeyHandle: mocks.loadKeyHandle,
  loadLastCloud: mocks.loadLastCloud,
  saveLastCloud: mocks.saveLastCloud,
  clearLastCloud: mocks.clearLastCloud,
  clearKeyHandle: mocks.clearKeyHandle,
}));
vi.mock('./pickFile', () => ({
  pickAndStoreDb: vi.fn(),
  pickKeyFile: vi.fn(),
  readStoredKeyBytes: mocks.readStoredKeyBytes,
}));
vi.mock('./deviceQuickUnlock', async () => ({
  ...await vi.importActual<typeof import('./deviceQuickUnlock')>('./deviceQuickUnlock'),
  createDeviceCredential: mocks.createDeviceCredential,
  getDevicePrfOutput: mocks.getDevicePrfOutput,
  isDeviceQuickUnlockAvailable: mocks.isDeviceQuickUnlockAvailable,
}));

const emptyStatus = { ok: true, enrolled: false, corrupt: false, source: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadHandle.mockResolvedValue({ kind: 'file', name: 'Vault.kdbx' });
  mocks.ensurePermission.mockResolvedValue(true);
  mocks.loadKeyHandle.mockResolvedValue(null);
  mocks.loadLastCloud.mockResolvedValue(null);
  mocks.readStoredKeyBytes.mockResolvedValue(null);
  mocks.isDeviceQuickUnlockAvailable.mockResolvedValue(true);
  mocks.createDeviceCredential.mockResolvedValue({
    credentialId: 'credential-id',
    prfInput: 'prf-input',
    prfOutput: new Uint8Array(32).fill(4),
  });
  mocks.getDevicePrfOutput.mockResolvedValue(new Uint8Array(32).fill(4));
  mocks.sendToSW.mockImplementation(async (request: { type: string }) => {
    if (request.type === 'getQuickUnlockStatus') return emptyStatus;
    return { ok: true };
  });
});

async function enterPasswordAndUnlock() {
  const password = await screen.findByPlaceholderText('Master password');
  fireEvent.change(password, { target: { value: 'correct horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
}

describe('device quick unlock UI', () => {
  test('shows quick unlock beside the password as an off-by-default toggle with a tooltip', async () => {
    render(<UnlockScreen onUnlocked={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Unlock' })).toBeVisible();
    const optIn = await screen.findByRole('button', { name: /set up device quick unlock/i });
    expect(screen.getByPlaceholderText('Master password').nextElementSibling).toContainElement(optIn);
    expect(optIn).not.toHaveTextContent(/quick unlock/i);
    expect(optIn).toHaveAttribute('aria-pressed', 'false');
    expect(optIn).not.toHaveAttribute('title');
    expect(optIn).toHaveAttribute('aria-describedby', 'quick-unlock-tooltip');
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Quick unlock');
    expect(tooltip).toHaveTextContent(/encrypted copy of your master password and\/or key-file material/i);
    fireEvent.click(optIn);
    expect(optIn).toHaveAttribute('aria-pressed', 'true');
  });

  test('disables quick unlock when the browser or device does not support it', async () => {
    mocks.isDeviceQuickUnlockAvailable.mockResolvedValue(false);
    render(<UnlockScreen onUnlocked={vi.fn()} />);

    const optIn = await screen.findByRole('button', { name: /set up device quick unlock/i });
    expect(optIn).toBeDisabled();
    expect(optIn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('tooltip')).toHaveTextContent(/not supported by this browser or device/i);
  });

  test('sets up only after manual unlock succeeds and does not expose secrets in the DOM', async () => {
    const onUnlocked = vi.fn();
    render(<UnlockScreen onUnlocked={onUnlocked} />);
    fireEvent.click(await screen.findByRole('button', { name: /set up device quick unlock/i }));
    await enterPasswordAndUnlock();

    await waitFor(() => expect(mocks.createDeviceCredential).toHaveBeenCalledOnce());
    const enrollment = mocks.sendToSW.mock.calls.find(([request]) => request.type === 'enrollQuickUnlock')?.[0];
    expect(enrollment).toMatchObject({
      source: { kind: 'local', label: 'Vault.kdbx' },
      password: 'correct horse',
      keyFile: null,
      credentialId: 'credential-id',
      replaceExisting: false,
    });
    expect(onUnlocked).toHaveBeenCalledOnce();
    expect(document.body).not.toHaveTextContent('correct horse');
  });

  test('setup cancellation or failure does not undo a successful manual unlock', async () => {
    const onUnlocked = vi.fn();
    mocks.createDeviceCredential.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    render(<UnlockScreen onUnlocked={onUnlocked} />);
    fireEvent.click(await screen.findByRole('button', { name: /set up device quick unlock/i }));
    await enterPasswordAndUnlock();
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(onUnlocked).toHaveBeenCalledWith(expect.stringMatching(/vault is open.*not set up/i));
    expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'enrollQuickUnlock')).toBe(false);
  });

  test('names and unlocks the enrolled vault while retaining the manual path', async () => {
    const onUnlocked = vi.fn();
    mocks.loadLastCloud.mockResolvedValue({
      provider: 'dropbox', fileId: 'file-1', fileName: 'Work.kdbx',
    });
    mocks.sendToSW.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'getQuickUnlockStatus') return {
        ok: true,
        enrolled: true,
        corrupt: false,
        source: { kind: 'cloud', provider: 'dropbox', fileId: 'file-1', label: 'Work.kdbx' },
        credentialId: 'credential-id',
        prfInput: 'prf-input',
      };
      return { ok: true };
    });
    render(<UnlockScreen onUnlocked={onUnlocked} />);

    const quickButton = await screen.findByRole('button', { name: 'Quick unlock “Work.kdbx” with device' });
    const manualButton = screen.getByRole('button', { name: 'Unlock' });
    expect(manualButton.parentElement).toContainElement(quickButton);
    expect(quickButton).toHaveClass('btn-quick-unlock');
    expect(quickButton).toHaveTextContent(/^Quick$/);
    const tooltip = document.getElementById('saved-quick-unlock-tooltip');
    expect(tooltip).toHaveClass('tooltip-content-top');
    expect(tooltip).toHaveTextContent(/Windows Hello/i);
    fireEvent.click(quickButton);

    await waitFor(() => expect(mocks.getDevicePrfOutput).toHaveBeenCalledWith('credential-id', 'prf-input'));
    expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'quickUnlock')).toBe(true);
    expect(onUnlocked).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('tab', { name: /local file/i }));
    expect(screen.queryByRole('button', { name: /quick unlock “Work\.kdbx”/i })).not.toBeInTheDocument();
  });

  test('shows safe retry guidance for a revoked local-file permission', async () => {
    mocks.sendToSW.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'getQuickUnlockStatus') return {
        ok: true, enrolled: true, corrupt: false,
        source: { kind: 'local', label: 'Vault.kdbx' }, credentialId: 'credential-id', prfInput: 'prf-input',
      };
      if (request.type === 'quickUnlock') return { ok: false, error: 'permissionRequired' };
      return { ok: true };
    });
    render(<UnlockScreen onUnlocked={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Quick unlock “Vault.kdbx” with device' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/grant file access.*manual unlock/i);
  });
});
