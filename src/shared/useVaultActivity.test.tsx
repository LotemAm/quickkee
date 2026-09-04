import { fireEvent, renderHook } from '@testing-library/react';
import { useVaultActivity } from './useVaultActivity';
import { sendToSW } from './messages';

vi.mock('./messages', () => ({ sendToSW: vi.fn().mockResolvedValue({ ok: true }) }));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

test('attaches once while enabled and removes the same capture listeners on lock and unmount', () => {
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const { rerender, unmount } = renderHook(({ enabled }) => useVaultActivity(enabled), {
    initialProps: { enabled: false },
  });
  const activityCalls = () => add.mock.calls.filter(([type]) => type === 'pointerdown' || type === 'keydown');
  expect(activityCalls()).toHaveLength(0);
  rerender({ enabled: true });
  expect(activityCalls()).toHaveLength(2);
  rerender({ enabled: true });
  expect(activityCalls()).toHaveLength(2);
  rerender({ enabled: false });
  for (const call of activityCalls()) expect(remove).toHaveBeenCalledWith(...call);
  rerender({ enabled: true });
  expect(activityCalls()).toHaveLength(4);
  unmount();
  for (const call of activityCalls()) expect(remove).toHaveBeenCalledWith(...call);
  fireEvent.keyDown(document, { key: 'a' });
  fireEvent.pointerDown(document);
  expect(sendToSW).not.toHaveBeenCalled();
});

test('synthetic events and focus/movement cannot report activity from a mounted surface', () => {
  const { unmount } = renderHook(() => useVaultActivity(true));
  fireEvent.keyDown(document, { key: 'a' });
  fireEvent.pointerDown(document);
  fireEvent.focusIn(document);
  fireEvent.mouseMove(document);
  expect(sendToSW).not.toHaveBeenCalled();
  unmount();
});
