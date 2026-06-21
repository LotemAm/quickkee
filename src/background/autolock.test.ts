import { AutoLock } from './autolock';

test('fires after the armed window', () => {
  vi.useFakeTimers(); let locked = false;
  const a = new AutoLock(() => { locked = true; });
  a.arm(1); // 1 hour
  vi.advanceTimersByTime(60 * 60 * 1000 - 1); expect(locked).toBe(false);
  vi.advanceTimersByTime(2); expect(locked).toBe(true);
  vi.useRealTimers();
});

test('touch resets the window', () => {
  vi.useFakeTimers(); let locked = false;
  const a = new AutoLock(() => { locked = true; });
  a.arm(1); vi.advanceTimersByTime(50 * 60 * 1000); a.touch();
  vi.advanceTimersByTime(50 * 60 * 1000); expect(locked).toBe(false);
  vi.advanceTimersByTime(11 * 60 * 1000); expect(locked).toBe(true);
  vi.useRealTimers();
});
