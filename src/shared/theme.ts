export type ThemeMode = 'system' | 'light' | 'dark';

let mql: MediaQueryList | null = null;
let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function setDark(on: boolean): void {
  document.documentElement.classList.toggle('dark', on);
}

function clearSystemListener(): void {
  if (mql && mqlHandler) mql.removeEventListener('change', mqlHandler);
  mql = null;
  mqlHandler = null;
}

export function applyTheme(theme: ThemeMode): void {
  clearSystemListener();
  if (theme === 'system') {
    setDark(prefersDark());
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mqlHandler = (e) => setDark(e.matches);
      mql.addEventListener('change', mqlHandler);
    }
    return;
  }
  setDark(theme === 'dark');
}
