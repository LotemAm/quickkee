import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    pwgen={{ length: 20, lower: true, upper: true, digits: true, symbols: true }}
    onChanged={vi.fn()} onDeleted={vi.fn()} />);

  await screen.findByRole('button', { name: 'Apply changes' });
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
