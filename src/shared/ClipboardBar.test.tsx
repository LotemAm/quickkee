import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClipboardBar } from './ClipboardBar';

test('shows "{label} copied" text', () => {
  render(<ClipboardBar state={{ label: 'Password', progress: 0.7 }} onCancel={vi.fn()} />);
  expect(screen.getByText('Password copied')).toBeInTheDocument();
});

test('fill div width reflects progress percentage', () => {
  const { container } = render(
    <ClipboardBar state={{ label: 'Password', progress: 0.6 }} onCancel={vi.fn()} />
  );
  const fill = container.querySelector('[data-testid="clipboard-bar-fill"]') as HTMLElement;
  expect(fill.style.width).toBe('60%');
});

test('cancel button calls onCancel', () => {
  const onCancel = vi.fn();
  render(<ClipboardBar state={{ label: 'Password', progress: 0.5 }} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: /cancel clipboard clear/i }));
  expect(onCancel).toHaveBeenCalledOnce();
});

test('shows custom field label', () => {
  render(<ClipboardBar state={{ label: 'API Key', progress: 0.3 }} onCancel={vi.fn()} />);
  expect(screen.getByText('API Key copied')).toBeInTheDocument();
});
