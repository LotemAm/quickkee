import { render, screen } from '@testing-library/react';
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
