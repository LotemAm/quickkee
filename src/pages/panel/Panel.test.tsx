import { render, screen } from '@testing-library/react';
import { EntryIndicators } from './Panel';

test('shows an authenticator indicator only for entries with TOTP', () => {
  const { rerender } = render(<EntryIndicators hasTotp={false} hasAttachments={false} expired={false} />);
  expect(screen.queryByLabelText('Has authenticator code')).toBeNull();

  rerender(<EntryIndicators hasTotp hasAttachments={false} expired={false} />);
  expect(screen.getByLabelText('Has authenticator code')).toBeTruthy();
});
