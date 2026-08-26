import tailwindCss from '../assets/styles/tailwind.css?raw';
import type { ThemeMode } from '../shared/theme';

export interface ShadowPalette {
  bg: string;
  border: string;
  text: string;
  muted: string;
  hover: string;
  shadow: string;
  primary: string;
  primaryOn: string;
  dangerText: string;
  ring: string;
}

function cssVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

function palette(selector: string, fallback: ShadowPalette): ShadowPalette {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(tailwindCss)?.[1] ?? '';
  const vars = cssVars(block);
  return {
    bg: vars['surface-raised'] ?? fallback.bg,
    border: vars['border'] ?? fallback.border,
    text: vars['text'] ?? fallback.text,
    muted: vars['text-muted'] ?? fallback.muted,
    hover: vars['btn-bg'] ?? fallback.hover,
    shadow: vars['shadow'] ?? fallback.shadow,
    primary: vars['primary'] ?? fallback.primary,
    primaryOn: vars['primary-on'] ?? fallback.primaryOn,
    dangerText: vars['danger-text'] ?? fallback.dangerText,
    ring: vars['ring'] ?? fallback.ring,
  };
}

const LIGHT = palette(':root', {
  bg: '#ffffff', border: '#e4edf3', text: '#1e293b', muted: '#64748b', hover: '#eef6fb',
  shadow: '0 2px 6px rgba(12,74,110,.10)', primary: '#0ea5e9', primaryOn: '#ffffff',
  dangerText: '#b91c1c', ring: 'rgba(14,165,233,.35)',
});
const DARK = palette('\\.dark', {
  bg: '#16202f', border: '#1f3346', text: '#d8eaf7', muted: '#7a96ad', hover: '#1d2b3d',
  shadow: '0 2px 8px rgba(0,0,0,.45)', primary: '#0ea5e9', primaryOn: '#ffffff',
  dangerText: '#fecaca', ring: 'rgba(56,189,248,.40)',
});

export function shadowPalette(dark: boolean): ShadowPalette {
  return dark ? DARK : LIGHT;
}

export function resolvesDark(theme: ThemeMode, view: Window | null = typeof window === 'undefined' ? null : window): boolean {
  return theme === 'dark' || (theme === 'system' && typeof view?.matchMedia === 'function'
    && view.matchMedia('(prefers-color-scheme: dark)').matches);
}
