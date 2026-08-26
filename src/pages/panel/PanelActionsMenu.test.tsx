import { fireEvent, render, screen } from '@testing-library/react';
import { PanelActionsMenu } from './PanelActionsMenu';

afterEach(() => vi.unstubAllGlobals());

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

test('opens the settings page from the three-dot menu', () => {
  const openOptionsPage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { openOptionsPage } });
  const { container } = render(<PanelActionsMenu onImportTotp={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

  const item = screen.getByRole('menuitem', { name: 'Settings' });
  expect(container.querySelector('.lucide-settings')).toBeTruthy();
  fireEvent.click(item);

  expect(openOptionsPage).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
