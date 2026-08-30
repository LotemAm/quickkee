import { fireEvent, render, screen } from '@testing-library/react';
import type { EntryView } from '../../shared/entry';
import { ScannedTotpDialog } from './ScannedTotpDialog';

const config = {
  secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256' as const, digits: 8, period: 45,
  issuer: 'Acme', account: 'alice@example.com',
};

const entry: EntryView = {
  id: 'entry-1', title: 'Acme login', username: 'alice@example.com', url: 'https://example.com',
  password: 'existing-password', fields: [], expired: false, created: null, expires: null,
  isCard: false, hasTotp: false, totpPeriod: null, attachments: [],
};

const groups = [
  { groupId: 'root', name: 'Root', depth: 0 },
  { groupId: 'work', name: 'Work', depth: 1 },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof ScannedTotpDialog>> = {}) {
  const props: React.ComponentProps<typeof ScannedTotpDialog> = {
    config,
    pageUrl: 'https://example.com/login?private=value',
    entries: [entry],
    groups,
    defaultGroupId: 'root',
    onCancel: vi.fn(),
    onConfirm: vi.fn(async () => null),
    ...overrides,
  };
  render(<ScannedTotpDialog {...props} />);
  return props;
}

test('previews only non-secret metadata and suggests one matching entry without TOTP', () => {
  renderDialog();

  expect(screen.getByText('Acme')).toBeTruthy();
  expect(screen.getByText('alice@example.com')).toBeTruthy();
  expect(screen.getByText('SHA-256')).toBeTruthy();
  expect(screen.getByText('8 digits')).toBeTruthy();
  expect(screen.getByText('45 seconds')).toBeTruthy();
  expect((screen.getByLabelText('Destination') as HTMLSelectElement).value).toBe('existing:entry-1');
  expect(document.body.textContent).not.toContain(config.secret);
  expect(document.body.textContent).not.toContain('otpauth://');
  expect(document.body.innerHTML).not.toContain('private=value');
});

test('requires a destination choice when multiple entries match and excludes cards', () => {
  renderDialog({
    entries: [entry, { ...entry, id: 'entry-2', title: 'Other' }, { ...entry, id: 'card', title: 'Card', isCard: true }],
  });

  const destination = screen.getByLabelText('Destination') as HTMLSelectElement;
  expect(destination.value).toBe('');
  expect((screen.getByRole('button', { name: 'Add authenticator code' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('option', { name: /Card/ })).toBeNull();
});

test('creates editable defaults in the selected existing group', async () => {
  const props = renderDialog({ entries: [] });

  expect((screen.getByLabelText('Destination') as HTMLSelectElement).value).toBe('new');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Acme');
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('alice@example.com');
  expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('https://example.com/');
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'work' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Acme 2FA' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add authenticator code' }));

  expect(props.onConfirm).toHaveBeenCalledWith({
    type: 'new', groupId: 'work',
    fields: { Title: 'Acme 2FA', UserName: 'alice@example.com', Password: '', URL: 'https://example.com/' },
  });
});

test('cancels without confirming and blocks duplicate submission', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const onConfirm = vi.fn(async () => { await pending; return null; });
  const props = renderDialog({ onConfirm });

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(props.onCancel).toHaveBeenCalledOnce();

  const add = screen.getByRole('button', { name: 'Add authenticator code' });
  fireEvent.click(add);
  fireEvent.click(add);
  expect(onConfirm).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement).disabled).toBe(true);
  release();
});

test('requires a second explicit confirmation before replacing existing TOTP', () => {
  const props = renderDialog({ entries: [{ ...entry, hasTotp: true }] });
  fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'existing:entry-1' } });

  fireEvent.click(screen.getByRole('button', { name: 'Add authenticator code' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('already has an authenticator code');

  fireEvent.click(screen.getByRole('button', { name: 'Replace existing authenticator code' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ type: 'existing', entryId: 'entry-1' });
});
