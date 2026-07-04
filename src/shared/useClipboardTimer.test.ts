import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useClipboardTimer } from './useClipboardTimer';
import { sendToSW } from './messages';

vi.mock('./clipboard', () => ({ copyWithClear: vi.fn() }));
vi.mock('./messages', () => ({ sendToSW: vi.fn().mockResolvedValue({ ok: true }) }));

const writeTextMock = vi.fn().mockResolvedValue(undefined);
(globalThis as any).navigator = {
  clipboard: { writeText: writeTextMock, readText: vi.fn().mockResolvedValue('') },
};

beforeEach(() => {
  vi.useFakeTimers();
  writeTextMock.mockClear();
  vi.mocked(sendToSW).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

test('starts with null state', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  expect(result.current.state).toBeNull();
});

test('sets state to full progress immediately on copy', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('secret', 'Password'); });
  expect(result.current.state).toEqual({ label: 'Password', progress: 1 });
});

test('progress decreases over time', () => {
  const { result } = renderHook(() => useClipboardTimer(10));
  act(() => { result.current.copy('secret', 'Password'); });
  act(() => { vi.advanceTimersByTime(5000); });
  expect(result.current.state?.progress).toBeCloseTo(0.5, 1);
  expect(result.current.state?.label).toBe('Password');
});

test('state becomes null after full duration', () => {
  const { result } = renderHook(() => useClipboardTimer(10));
  act(() => { result.current.copy('secret', 'Password'); });
  act(() => { vi.advanceTimersByTime(10_100); });
  expect(result.current.state).toBeNull();
});

test('does not show bar when clearSecs is 0', () => {
  const { result } = renderHook(() => useClipboardTimer(0));
  act(() => { result.current.copy('secret', 'Password'); });
  expect(result.current.state).toBeNull();
});

test('re-copy resets label and progress to 1', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { vi.advanceTimersByTime(15_000); });
  act(() => { result.current.copy('user', 'Username'); });
  expect(result.current.state).toEqual({ label: 'Username', progress: 1 });
});

test('cancel sets state to null', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { result.current.cancel(); });
  expect(result.current.state).toBeNull();
});

test('cancel writes empty string to clipboard', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { result.current.cancel(); });
  expect(writeTextMock).toHaveBeenCalledWith('');
});

test('cancel also cancels the background clear', () => {
  const { result } = renderHook(() => useClipboardTimer(30));
  act(() => { result.current.copy('pass', 'Password'); });
  act(() => { result.current.cancel(); });
  expect(sendToSW).toHaveBeenCalledWith({ type: 'cancelClipboardClear' });
});
