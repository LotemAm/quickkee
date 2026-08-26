import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TotpCodeDisplay, TotpSetup } from './TotpSetup';

beforeEach(() => {
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
});

test('accepts a manual setup key with entry-derived defaults', () => {
  const onChange = vi.fn();
  render(<TotpSetup initialConfig={null} issuer="GitHub" account="octocat" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('TOTP setup key or URI'), { target: { value: 'jbsw y3dp-ehpk3pxp' } });
  expect(onChange).toHaveBeenLastCalledWith({
    secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
    issuer: 'GitHub', account: 'octocat',
  }, null);
});

test('keeps invalid input visible and reports a specific error', () => {
  const onChange = vi.fn();
  render(<TotpSetup initialConfig={null} issuer="GitHub" account="octocat" onChange={onChange} />);
  const input = screen.getByLabelText('TOTP setup key or URI');
  const hotp = 'otpauth://hotp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&counter=1';
  fireEvent.change(input, { target: { value: hotp } });
  expect((input as HTMLInputElement).value).toBe(hotp);
  expect(screen.getByRole('alert').textContent).toContain('Only TOTP');
  expect(onChange).toHaveBeenLastCalledWith(null, expect.stringContaining('Only TOTP'));
});

test('manual code display requests and renders only the current code with a progress bar', async () => {
  const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
  sendMessage.mockResolvedValue({ ok: true, code: '123456', period: 30, expiresAt: Date.now() + 30_000 });
  render(<TotpCodeDisplay entryId="entry-1" onCopy={vi.fn()} />);
  expect((await screen.findByText('123456')).textContent).toBe('123456');
  expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('TOTP time remaining');
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'getTotpCode', entryId: 'entry-1' }));
});
