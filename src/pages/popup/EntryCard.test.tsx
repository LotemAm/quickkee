import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import type { EntrySummary, EntryView } from '../../shared/entry';
const mocks = vi.hoisted(() => ({ send: vi.fn(), openEntry: vi.fn() }));
vi.mock('../../shared/messages', () => ({ sendToSW: mocks.send }));
vi.mock('../../shared/openEntry', () => ({ requestOpenEntry: mocks.openEntry }));
import { EntryCard } from './EntryCard';

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ ok: true });
  mocks.openEntry.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { sidePanel: { open: vi.fn() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const entry: EntryView = {
  id: 'entry-1',
  title: 'Example',
  username: 'person@example.com',
  url: 'https://example.com',
  password: 'secret',
  fields: [],
  expired: false,
  created: null,
  expires: null,
  isCard: false,
  hasTotp: false,
  totpPeriod: null,
  attachments: [],
};

test('shows the Fields action only when the entry has details to reveal', () => {
  const props = { tabId: 1, onCopy: vi.fn(), groupName: 'Personal' };
  const { rerender } = render(<EntryCard entry={entry} {...props} />);

  expect(screen.queryByRole('button', { name: 'Toggle fields' })).toBeNull();

  rerender(<EntryCard entry={{ ...entry, fields: [{ key: 'PIN', value: '1234', protected: true }] }} {...props} />);

  expect(screen.getByRole('button', { name: 'Toggle fields' })).toBeTruthy();

  rerender(<EntryCard entry={{ ...entry, expires: Date.now() + 60_000 }} {...props} />);

  expect(screen.getByRole('button', { name: 'Toggle fields' })).toBeTruthy();
});

test('places the sidebar action before the group chip', () => {
  render(<EntryCard entry={entry} tabId={1} onCopy={vi.fn()} groupName="Personal" />);

  const sidebar = screen.getByRole('button', { name: 'Open in sidebar' });
  const group = screen.getByText('Personal');

  expect(sidebar.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('uses icon-only controls to copy the username and password', () => {
  const onCopy = vi.fn();
  render(<EntryCard entry={entry} tabId={1} onCopy={onCopy} />);

  const copyUsername = screen.getByRole('button', { name: 'Copy username' });
  const copyPassword = screen.getByRole('button', { name: 'Copy password' });

  expect(copyUsername.textContent).toBe('');
  expect(copyPassword.textContent).toBe('');

  fireEvent.click(copyUsername);
  fireEvent.click(copyPassword);

  expect(onCopy).toHaveBeenNthCalledWith(1, entry.username, 'Username');
  expect(onCopy).toHaveBeenNthCalledWith(2, entry.password, 'Password');
});

test('summary cards render labels, masking and controls without retrieving secrets', () => {
  const summary: EntrySummary = { id: 'card', title: 'Payment card', username: '4111111111111111',
    url: '', isCard: true, expired: true, hasTotp: true, totpPeriod: 30, hasAttachments: true };
  render(<EntryCard entry={summary} tabId={1} onCopy={vi.fn()} groupName="Cards" />);
  expect(screen.getByText('Payment card')).toBeTruthy();
  expect(screen.getByText('Cards')).toBeTruthy();
  expect(screen.getByText('EXPIRED')).toBeTruthy();
  expect(screen.queryByText(summary.username)).toBeNull();
  expect(screen.getByText('•••• 1111')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Toggle fields' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show authenticator code' })).toBeTruthy();
  expect(mocks.send).not.toHaveBeenCalled();
});



const summary: EntrySummary = { id: entry.id, title: entry.title, username: entry.username, url: entry.url,
  expired: false, isCard: false, hasTotp: false, totpPeriod: null, hasAttachments: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('summary username/sidebar/autofill and explicit TOTP use metadata or ID without loading details', async () => {
  const onCopy = vi.fn();
  mocks.send.mockImplementation(async request => request.type === 'getTotpCode'
    ? { ok: true, code: '654321', period: 30, expiresAt: Date.now() + 30_000 } : { ok: true });
  render(<EntryCard entry={{ ...summary, hasTotp: true, totpPeriod: 30 }} tabId={42} onCopy={onCopy} />);
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy username' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open in sidebar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Autofill' }));
  expect(onCopy).toHaveBeenCalledWith(summary.username, 'Username');
  expect(mocks.openEntry).toHaveBeenCalledWith(summary.id);
  expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ type: 'fillRequest', entryId: summary.id, tabId: 42 });
  fireEvent.click(screen.getByRole('button', { name: 'Show authenticator code' }));
  await screen.findByText('654321');
  fireEvent.click(screen.getByRole('button', { name: 'Copy TOTP code' }));
  expect(onCopy).toHaveBeenLastCalledWith('654321', 'Authenticator code');
  expect(mocks.send.mock.calls.map(([request]) => request.type)).toEqual(['fillRequest', 'getTotpCode']);
});

test.each(['password', 'fields'])('%s first shares one pending row read with the other detail action and reuses its cache', async first => {
  const late = deferred<unknown>();
  const onCopy = vi.fn();
  mocks.send.mockReturnValue(late.promise);
  render(<StrictMode><EntryCard entry={summary} tabId={1} onCopy={onCopy} /></StrictMode>);
  const password = screen.getByRole('button', { name: 'Copy password' });
  const fields = screen.getByRole('button', { name: 'Toggle fields' });
  fireEvent.click(first === 'password' ? password : fields);
  fireEvent.click(first === 'password' ? fields : password);
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ type: 'getEntry', entryId: summary.id });
  expect(screen.getByRole('status')).toHaveTextContent('Loading entry details');
  expect(password).toHaveAttribute('aria-busy', 'true');
  expect(onCopy).not.toHaveBeenCalled();
  await act(async () => { late.resolve({ ok: true, entry: { ...entry, expires: 2_000_000_000_000,
    fields: [{ key: 'PIN', value: '1234', protected: true }] } }); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('Expires')).toBeVisible();
  expect(screen.getByText(new Date(2_000_000_000_000).toLocaleDateString())).toBeVisible();
  expect(screen.getByText('PIN')).toBeVisible();
  expect(screen.queryByText('1234')).not.toBeInTheDocument();
  expect(onCopy).toHaveBeenCalledExactlyOnceWith(entry.password, 'Password');
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(onCopy).toHaveBeenLastCalledWith('1234', 'PIN');
  await act(async () => { fireEvent.click(password); });
  fireEvent.click(fields); fireEvent.click(fields);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(onCopy).toHaveBeenLastCalledWith(entry.password, 'Password');
});

test('successful summary details with no fields or expiry keep an explicit empty state and toggle', async () => {
  mocks.send.mockResolvedValue({ ok: true, entry });
  render(<EntryCard entry={summary} tabId={1} onCopy={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  await screen.findByText('No additional details.');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  expect(screen.queryByText('No additional details.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  expect(screen.getByText('No additional details.')).toBeVisible();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

test.each(['error', 'missing', 'wrong ID', 'rejection', 'synchronous throw'])('%s details never copy and remain retryable', async failure => {
  const onCopy = vi.fn();
  if (failure === 'synchronous throw') mocks.send.mockImplementationOnce(() => { throw new Error('transport failed'); });
  else if (failure === 'rejection') mocks.send.mockRejectedValueOnce(new Error('transport failed'));
  else mocks.send.mockResolvedValueOnce(failure === 'error' ? { ok: false, error: 'locked' }
    : { ok: true, entry: failure === 'missing' ? null : { ...entry, id: 'another-entry', password: 'wrong' } });
  mocks.send.mockResolvedValue({ ok: true, entry });
  render(<EntryCard entry={summary} tabId={1} onCopy={onCopy} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load entry details. Try again.');
  expect(onCopy).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry details' })); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(onCopy).toHaveBeenCalledExactlyOnceWith(entry.password, 'Password');
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

test('a failed password action can be retried directly using Copy password', async () => {
  const onCopy = vi.fn();
  mocks.send.mockResolvedValueOnce({ ok: false, error: 'failed' }).mockResolvedValue({ ok: true, entry });
  render(<EntryCard entry={summary} tabId={1} onCopy={onCopy} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  await screen.findByRole('alert');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(onCopy).toHaveBeenCalledExactlyOnceWith(entry.password, 'Password');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

test.each(['resolve', 'reject'])('unmounted detail work ignores a late %s and a new row requests fresh data', async completion => {
  const late = deferred<unknown>();
  const onCopy = vi.fn();
  mocks.send.mockReturnValueOnce(late.promise).mockResolvedValue({ ok: true, entry: { ...entry, password: 'fresh' } });
  const view = render(<EntryCard key="old" entry={summary} tabId={1} onCopy={onCopy} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  view.rerender(<EntryCard key="new" entry={summary} tabId={1} onCopy={onCopy} />);
  await act(async () => {
    if (completion === 'resolve') late.resolve({ ok: true, entry });
    else late.reject(new Error('obsolete'));
  });
  expect(onCopy).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('No additional details.')).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy password' })); });
  expect(onCopy).toHaveBeenCalledExactlyOnceWith('fresh', 'Password');
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

test('full-view expiry and custom-field copies use supplied data without a lazy read', () => {
  const onCopy = vi.fn();
  render(<EntryCard entry={{ ...entry, expired: true, expires: 1_000_000_000_000,
    fields: [{ key: 'PIN', value: '9876', protected: true }] }} tabId={1} onCopy={onCopy} groupName="Personal" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(onCopy.mock.calls).toEqual([[entry.password, 'Password'], ['9876', 'PIN']]);
  expect(screen.getByText('EXPIRED')).toBeVisible();
  expect(screen.getByText('Personal')).toBeVisible();
  expect(screen.getByText(new Date(1_000_000_000_000).toLocaleDateString())).toBeVisible();
  expect(mocks.send).not.toHaveBeenCalled();
});
