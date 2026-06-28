import { useState, useRef, useCallback, useEffect } from 'react';
import { copyWithClear } from './clipboard';

export interface ClipboardTimerState {
  label: string;
  progress: number;
}

export function useClipboardTimer(clearSecs: number) {
  const [state, setState] = useState<ClipboardTimerState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => stopInterval(), [stopInterval]);

  const cancel = useCallback(() => {
    stopInterval();
    setState(null);
    navigator.clipboard.writeText('').catch(() => {});
  }, [stopInterval]);

  const copy = useCallback((text: string, label: string) => {
    copyWithClear(text, clearSecs);
    if (clearSecs <= 0) return;
    stopInterval();
    const start = Date.now();
    const totalMs = clearSecs * 1000;
    setState({ label, progress: 1 });
    intervalRef.current = setInterval(() => {
      const progress = Math.max(0, 1 - (Date.now() - start) / totalMs);
      if (progress <= 0) {
        stopInterval();
        setState(null);
      } else {
        setState({ label, progress });
      }
    }, 100);
  }, [clearSecs, stopInterval]);

  return { copy, state, cancel };
}
