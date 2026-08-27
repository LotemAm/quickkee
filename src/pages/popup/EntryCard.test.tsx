import { fireEvent, render, screen } from '@testing-library/react';
import type { EntryView } from '../../shared/entry';
import { EntryCard } from './EntryCard';

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
