import { useEffect, useRef, useState } from 'react';
import { DEFAULT_NAMEGEN, normalizeNameGenOptions, type NameGenOptions } from './namegen';
import { useSessionLifetime } from './useSessionLifetime';

const KEY = 'nameGeneratorOptions';

export async function loadNameGenOptions(): Promise<NameGenOptions> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeNameGenOptions(stored[KEY]);
}

export async function saveNameGenOptions(options: NameGenOptions): Promise<void> {
  await chrome.storage.local.set({ [KEY]: normalizeNameGenOptions(options) });
}

// Inline forms only read defaults. Only the Settings page opts into persistence.
export function useNameGenOptions(persist = false) {
  const [options, setOptions] = useState(DEFAULT_NAMEGEN);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const captureLifetime = useSessionLifetime();
  const writes = useRef(Promise.resolve());
  const revision = useRef(0);
  useEffect(() => {
    const isAlive = captureLifetime();
    void loadNameGenOptions().then(value => {
      if (isAlive()) setOptions(value);
    }).catch(() => {
      if (isAlive()) setNotice('Could not load username defaults. Using built-in defaults.');
    }).finally(() => { if (isAlive()) setReady(true); });
  }, [captureLifetime]);

  function changeOptions(next: NameGenOptions) {
    const isAlive = captureLifetime();
    if (!isAlive() || !ready) return;
    setOptions(next);
    if (!persist) return;
    const version = ++revision.current;
    // Finish accepted Settings changes even if the page closes while an earlier write is pending.
    const write = writes.current.then(() => saveNameGenOptions(next));
    writes.current = write.catch(() => undefined);
    void write.then(() => {
      if (isAlive() && version === revision.current) setNotice('');
    }).catch(() => {
      if (isAlive() && version === revision.current) setNotice('Could not save username defaults. Changes apply here only.');
    });
  }
  return { options, changeOptions, ready, notice };
}
