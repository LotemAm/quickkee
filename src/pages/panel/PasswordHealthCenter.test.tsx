import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PasswordHealthReport } from '../../shared/passwordHealth';
import { PasswordHealthCenter } from './PasswordHealthCenter';

function report(overrides: Partial<PasswordHealthReport> = {}): PasswordHealthReport {
  return {
    generatedAt: Date.now(),
    totalEntries: 4,
    needsAttention: 3,
    reviewCount: 1,
    counts: {
      'empty-password': 0,
      'weak-password': 1,
      'reused-password': 1,
      'stale-entry': 1,
      'expired-entry': 1,
    },
    entries: [
      {
        entryId: 'weak', title: 'Alpha', username: 'alice', url: 'https://alpha.example/login', modifiedAt: Date.now(),
        issues: [{ code: 'weak-password', reasons: ['short'] }],
      },
      {
        entryId: 'reuse', title: 'Beta', username: 'bob', url: 'https://beta.example', modifiedAt: Date.now(),
        issues: [{ code: 'reused-password', reuseGroupId: 'reuse-1' }],
      },
      {
        entryId: 'review', title: 'Gamma', username: 'carol', url: '', modifiedAt: Date.now() - 400 * 86_400_000,
        issues: [{ code: 'stale-entry' }, { code: 'expired-entry' }],
      },
    ],
    ...overrides,
  };
}

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => vi.unstubAllGlobals());

test('shows loading, then the local-only summary and accessible controls', async () => {
  let resolve!: (value: unknown) => void;
  sendMessage.mockReturnValue(new Promise(value => { resolve = value; }));
  render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);

  expect(screen.getByRole('status').textContent).toContain('Checking');
  resolve({ ok: true, report: report() });

  expect(await screen.findByText('3 of 4 login entries need attention')).toBeTruthy();
  expect(screen.getByText('Checks run locally while your vault is unlocked.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Recheck password health' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Open entry' })).toHaveLength(3);
  expect(screen.getByText('Checked just now')).toBeTruthy();
});

test('shows a retryable generic error without raw exception text', async () => {
  sendMessage.mockRejectedValue(new Error('Sensitive internal failure'));
  render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Could not check password health');
  expect(alert.textContent).not.toContain('Sensitive internal failure');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

test('keeps the prior report visible when a recheck fails and offers another recheck', async () => {
  sendMessage
    .mockResolvedValueOnce({ ok: true, report: report() })
    .mockRejectedValueOnce(new Error('Sensitive refresh failure'));
  render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);
  await screen.findByText('3 of 4 login entries need attention');

  fireEvent.click(screen.getByRole('button', { name: 'Recheck password health' }));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Could not refresh password health');
  expect(alert.textContent).not.toContain('Sensitive refresh failure');
  expect(screen.getByText('3 of 4 login entries need attention')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Recheck password health' })).toBeTruthy();
});

test('distinguishes an empty vault from an all-clear report', async () => {
  sendMessage.mockResolvedValue({ ok: true, report: report({ totalEntries: 0, needsAttention: 0, reviewCount: 0, entries: [] }) });
  const view = render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);
  expect(await screen.findByText('No login entries to check yet.')).toBeTruthy();

  sendMessage.mockResolvedValue({ ok: true, report: report({ totalEntries: 2, needsAttention: 0, reviewCount: 0, entries: [], counts: {
    'empty-password': 0, 'weak-password': 0, 'reused-password': 0,
    'stale-entry': 0, 'expired-entry': 0,
  } }) });
  view.unmount();
  render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);
  expect(await screen.findByText('No issues found by these checks.')).toBeTruthy();
});

test('shows categories and filters visible rows with counts without a missing-TOTP check', async () => {
  sendMessage.mockResolvedValue({ ok: true, report: report() });
  render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);
  expect(await screen.findByText('Alpha')).toBeTruthy();
  expect(screen.getByText('Entry not updated in over a year. This may not reflect when the password changed.')).toBeTruthy();
  expect(screen.queryByText('TOTP not stored')).toBeNull();
  expect(screen.queryByRole('button', { name: /TOTP info/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Reused 1' }));
  expect(screen.getByText('Beta')).toBeTruthy();
  expect(screen.queryByText('Alpha')).toBeNull();
  expect(screen.queryByText('Gamma')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Review 1' }));
  expect(screen.getByText('Gamma')).toBeTruthy();
  expect(screen.queryByText('Beta')).toBeNull();
});

test('opens a finding and refreshes with a concise message if it disappeared', async () => {
  const onOpenEntry = vi.fn().mockResolvedValue(false);
  sendMessage.mockResolvedValue({ ok: true, report: report() });
  render(<PasswordHealthCenter onOpenEntry={onOpenEntry} />);
  await screen.findByText('Alpha');

  fireEvent.click(screen.getAllByRole('button', { name: 'Open entry' })[0]);

  await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith('weak'));
  expect((await screen.findByRole('status')).textContent).toContain('That entry is no longer available. The report was refreshed.');
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

test('uses semantic theme tokens and never renders unexpected secret-bearing fields', async () => {
  const secret = 'DOM-Must-Not-Contain-This-Secret-938475';
  const unsafe = report() as PasswordHealthReport & { password: string };
  unsafe.password = secret;
  (unsafe.entries[0] as PasswordHealthReport['entries'][number] & { password: string }).password = secret;
  sendMessage.mockResolvedValue({ ok: true, report: unsafe });
  const { container } = render(<PasswordHealthCenter onOpenEntry={vi.fn()} />);
  await screen.findByText('Alpha');

  expect(container.innerHTML).toContain('var(--surface)');
  expect(container.innerHTML).not.toContain(secret);
});
