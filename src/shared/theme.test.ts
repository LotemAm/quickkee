import { applyTheme } from './theme';

function mockMatchMedia(matchesDark: boolean) {
  window.matchMedia = (query: string) => ({
    matches: query.includes('dark') ? matchesDark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
});

test('explicit dark adds the dark class', () => {
  applyTheme('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('explicit light removes the dark class', () => {
  document.documentElement.classList.add('dark');
  applyTheme('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

test('system follows OS preference (dark)', () => {
  mockMatchMedia(true);
  applyTheme('system');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('system follows OS preference (light)', () => {
  mockMatchMedia(false);
  document.documentElement.classList.add('dark');
  applyTheme('system');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});