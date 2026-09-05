import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, test, vi } from 'vitest';
import { EntryEditor } from './EntryEditor';

const mocks = vi.hoisted(() => ({
  sendToSW: vi.fn(),
  scanVisibleTabForTotp: vi.fn(),
}));

vi.mock('../../shared/messages', () => ({ sendToSW: mocks.sendToSW }));
vi.mock('../popup/scanVisibleTabForTotp', () => ({ scanVisibleTabForTotp: mocks.scanVisibleTabForTotp }));

const scannedConfig = {
  secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1' as const, digits: 6, period: 30,
  issuer: 'Acme', account: 'alice',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scanVisibleTabForTotp.mockResolvedValue({
    tabId: 12, pageUrl: 'https://example.com/login', config: scannedConfig,
  });
  mocks.sendToSW.mockImplementation(async (request: { type: string }) => {
    if (request.type === 'getEntry') return { ok: true, entry: {
      id: 'entry-1', title: 'Acme', username: 'alice', url: 'https://example.com', password: 'secret',
      fields: [], expired: false, created: null, expires: null, isCard: false,
      hasTotp: false, totpPeriod: null, attachments: [],
    } };
    if (request.type === 'getTotpConfig') return { ok: true, config: null };
    if (request.type === 'previewTotp') return {
      ok: true, code: '123456', period: 30, expiresAt: Date.now() + 30_000,
    };
    return { ok: true };
  });
});

test('scans a page QR into the side-panel editor without saving immediately', async () => {
  render(<EntryEditor entryId="entry-1" groupId="group-1" clearSecs={30}
    groups={[{ groupId: 'group-1', name: 'Sites', depth: 0 }]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={vi.fn()} onDeleted={vi.fn()} />);

  await screen.findByRole('button', { name: 'Apply changes' });
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith({ type: 'getTotpConfig', entryId: 'entry-1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Authenticator code' }));

  const input = screen.getByLabelText('TOTP setup key or URI');
  const scanButton = screen.getByRole('button', { name: 'Scan page QR' });
  expect(input.nextElementSibling).toContainElement(scanButton);
  expect(scanButton).not.toHaveAttribute('title');
  const tooltipId = scanButton.getAttribute('aria-describedby');
  expect(document.getElementById(tooltipId!)).toHaveTextContent('Scan page QR');
  expect(document.getElementById(tooltipId!)).toHaveTextContent('Scan the visible tab locally.');

  fireEvent.click(scanButton);
  expect(await screen.findByText('123456')).toBeVisible();
  expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'updateEntry')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'TOTP settings' }));
  expect((screen.getByLabelText('TOTP setup key or URI') as HTMLInputElement).value).toContain('otpauth://totp/');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'entry-1', totp: scannedConfig,
  })));
});

test('changes an existing entry group through the same update request', async () => {
  const onChanged = vi.fn();
  render(<EntryEditor entryId="entry-1" groupId="sites" clearSecs={30}
    groups={[
      { groupId: 'root', name: 'Vault', depth: 0 },
      { groupId: 'sites', name: 'Sites', depth: 1 },
    ]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={onChanged} onDeleted={vi.fn()} />);

  await screen.findByRole('button', { name: 'Apply changes' });
  const groupSelect = screen.getByLabelText('Group');
  expect(groupSelect.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('More'));
  fireEvent.change(groupSelect, { target: { value: 'root' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));

  await waitFor(() => expect(mocks.sendToSW).toHaveBeenCalledWith(expect.objectContaining({
    type: 'updateEntry', entryId: 'entry-1', groupId: 'root',
  })));
  expect(onChanged).toHaveBeenCalledWith('root');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('a held attachment file read sends no attachment or parent callback after session unmount', async () => {
  const fileRead = deferred<ArrayBuffer>();
  const onChanged = vi.fn();
  const view = render(<EntryEditor entryId="entry-1" groupId="group-1" clearSecs={30}
    groups={[{ groupId: 'group-1', name: 'Sites', depth: 0 }]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={onChanged} onDeleted={vi.fn()} />);
  await screen.findByRole('button', { name: 'Apply changes' });
  const file = new File(['private attachment'], 'private.txt');
  Object.defineProperty(file, 'arrayBuffer', { value: () => fileRead.promise });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  view.unmount();
  await act(async () => { fileRead.resolve(new ArrayBuffer(8)); });
  expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === 'addAttachment')).toBe(false);
  expect(onChanged).not.toHaveBeenCalled();
});

test.each(['createEntry', 'updateEntry'])('%s reply cannot invoke parent callbacks after session unmount', async type => {
  const reply = deferred<unknown>();
  const original = mocks.sendToSW.getMockImplementation()!;
  mocks.sendToSW.mockImplementation((request: { type: string }) => request.type === type ? reply.promise : original(request));
  const onChanged = vi.fn(); const onCreated = vi.fn();
  const view = render(<EntryEditor entryId={type === 'createEntry' ? null : 'entry-1'} groupId="group-1" clearSecs={30}
    groups={[{ groupId: 'group-1', name: 'Sites', depth: 0 }]}
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={onChanged} onCreated={onCreated} onDeleted={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: type === 'createEntry' ? 'Create' : 'Apply changes' }));
  await waitFor(() => expect(mocks.sendToSW.mock.calls.some(([request]) => request.type === type)).toBe(true));
  view.unmount();
  await act(async () => { reply.resolve({ ok: true, entryId: 'new' }); });
  expect(onChanged).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});
