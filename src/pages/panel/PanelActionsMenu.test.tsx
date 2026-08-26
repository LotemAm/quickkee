import { fireEvent, render, screen } from '@testing-library/react';
import { PanelActionsMenu } from './PanelActionsMenu';

test('opens a three-dot menu and invokes TOTP import from an icon-bearing menu item', () => {
  const onImportTotp = vi.fn();
  const { container } = render(<PanelActionsMenu onImportTotp={onImportTotp} />);

  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

  const item = screen.getByRole('menuitem', { name: 'Import TOTP' });
  expect(item).toBeTruthy();
  expect(container.querySelector('.lucide-qr-code')).toBeTruthy();
  fireEvent.click(item);

  expect(onImportTotp).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
