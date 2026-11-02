import { useState } from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UsernameField } from './UsernameField';
import { DEFAULT_NAMEGEN } from './namegen';
import { useNameGenOptions } from './namegenSettings';

let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(store, values); }),
  } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Form({ disabled = false, canGenerate = () => true }: { disabled?: boolean; canGenerate?: () => boolean }) {
  const [username, setUsername] = useState('typed-name');
  const generator = useNameGenOptions();
  return <UsernameField value={username} onChange={setUsername} generator={generator} disabled={disabled} canGenerate={canGenerate} />;
}

async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: 'Generate username' })).toBeEnabled()); }

test('loads saved defaults, changes options only in this form, and generates only on click', async () => {
  store.nameGeneratorOptions = { ...DEFAULT_NAMEGEN, separator: '_' };
  const view = render(<Form />);
  await ready();
  expect(screen.queryByLabelText('Name style')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Username options' }));
  expect(screen.getByLabelText('Word separator')).toHaveValue('_');
  fireEvent.change(screen.getByLabelText('Word separator'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Name casing'), { target: { value: 'capitalized' } });
  fireEvent.change(screen.getByLabelText('Digit suffix'), { target: { value: '4' } });
  expect(screen.getByLabelText('Username')).toHaveValue('typed-name');
  fireEvent.click(screen.getByRole('button', { name: 'Generate username' }));
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{4}$/);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
  view.unmount();
  render(<Form />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Username options' }));
  expect(screen.getByLabelText('Word separator')).toHaveValue('_');
  expect(screen.getByLabelText('Name casing')).toHaveValue('lowercase');
  expect(screen.getByLabelText('Digit suffix')).toHaveValue('0');
});

test('preference read failure shows a notice but allows generation with built-in defaults', async () => {
  vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('unavailable'));
  render(<Form />);
  await ready();
  expect(screen.getByRole('status')).toHaveTextContent('Could not load username defaults');
  fireEvent.click(screen.getByRole('button', { name: 'Generate username' }));
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toMatch(/^[a-z]+-[a-z]+$/);
});

test('generation failure preserves the current username and can be retried', async () => {
  render(<Form />);
  await ready();
  const random = vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(() => { throw new Error('unavailable'); });
  fireEvent.click(screen.getByRole('button', { name: 'Generate username' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not generate a username');
  expect(screen.getByLabelText('Username')).toHaveValue('typed-name');
  random.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Generate username' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'edited-result' } });
  expect(screen.getByLabelText('Username')).toHaveValue('edited-result');
});

test('disabled forms disable the field, generator, and open options', async () => {
  const view = render(<Form />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Username options' }));
  view.rerender(<Form disabled />);
  expect(screen.getByLabelText('Username')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generate username' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Username options' })).toBeDisabled();
  expect(screen.getByLabelText('Word separator')).toBeDisabled();
});

test('session/submission guard prevents generation', async () => {
  render(<Form canGenerate={() => false} />);
  await ready();
  const random = vi.spyOn(crypto, 'getRandomValues');
  fireEvent.click(screen.getByRole('button', { name: 'Generate username' }));
  expect(random).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Username')).toHaveValue('typed-name');
});

test('late preference loading cannot affect an unmounted form or its replacement', async () => {
  let resolve!: (value: Record<string, unknown>) => void;
  vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<Form />);
  expect(screen.getByRole('button', { name: 'Generate username' })).toBeDisabled();
  view.unmount();
  render(<Form />);
  await ready();
  await act(async () => { resolve({ nameGeneratorOptions: { ...DEFAULT_NAMEGEN, separator: '_' } }); });
  fireEvent.click(screen.getByRole('button', { name: 'Username options' }));
  expect(screen.getByLabelText('Word separator')).toHaveValue('-');
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});
