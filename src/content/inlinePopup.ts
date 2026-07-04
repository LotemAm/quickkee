import type { EntrySummary } from '../shared/entry';
import { loadSettings } from '../shared/settings';
import tailwindCss from '../assets/styles/tailwind.css?raw';

type EntryStub = Pick<EntrySummary, 'id' | 'title' | 'username'>;
type Palette = { bg: string; border: string; text: string; muted: string; hover: string; shadow: string };

// CSS custom properties on the extension's own document don't reach a shadow
// root injected into a host page's document, so the :root/.dark palette from
// tailwind.css is read out of the source file at build time (via Vite's ?raw
// import) instead of being hand-copied here.
function cssVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function palette(selector: string, fallback: Palette): Palette {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(tailwindCss)?.[1] ?? '';
  const vars = cssVars(block);
  return {
    bg: vars['surface-raised'] ?? fallback.bg,
    border: vars['border'] ?? fallback.border,
    text: vars['text'] ?? fallback.text,
    muted: vars['text-muted'] ?? fallback.muted,
    hover: vars['btn-bg'] ?? fallback.hover,
    shadow: vars['shadow'] ?? fallback.shadow,
  };
}

// Fallbacks only guard against tailwind.css being restructured unexpectedly —
// tailwind.css is the source of truth, these values are not meant to be edited here.
const LIGHT = palette(':root', { bg: '#ffffff', border: '#e4edf3', text: '#1e293b', muted: '#64748b', hover: '#eef6fb', shadow: '0 2px 6px rgba(12,74,110,.10)' });
const DARK = palette('\\.dark', { bg: '#16202f', border: '#1f3346', text: '#d8eaf7', muted: '#7a96ad', hover: '#1d2b3d', shadow: '0 2px 8px rgba(0,0,0,.45)' });

let host: HTMLElement | null = null;
let activeIndex = 0;
let currentEntries: EntryStub[] = [];
let currentField: HTMLElement | null = null;
let currentOnSelect: ((e: EntryStub) => void) | null = null;
let keydownBound = false;
let dark = false;

void loadSettings().then(s => {
  dark = s.theme === 'dark' || (s.theme === 'system'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches);
});

function ensureHost(): ShadowRoot {
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-quickkee-popup', 'true');
    host.style.cssText = 'position:absolute;z-index:2147483647;display:none';
    host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
  }
  return host.shadowRoot!;
}

function render(shadow: ShadowRoot): void {
  const c = dark ? DARK : LIGHT;

  shadow.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `
    .p{background:${c.bg};border:1px solid ${c.border};border-radius:6px;
       box-shadow:${c.shadow};overflow:hidden;
       font:13px/1.4 system-ui,-apple-system,sans-serif;color:${c.text}}
    .h{padding:5px 10px;font-size:11px;color:${c.muted};border-bottom:1px solid ${c.border}}
    .e{padding:7px 10px;cursor:pointer;border-bottom:1px solid ${c.border}}
    .e:last-child{border-bottom:none}
    .e:hover,.e.active{background:${c.hover}}
    .t{font-weight:500}
    .u{font-size:11px;color:${c.muted};margin-top:1px}
  `;

  const panel = document.createElement('div');
  panel.className = 'p';

  const header = document.createElement('div');
  header.className = 'h';
  header.textContent = 'QuickKee';
  panel.appendChild(header);

  currentEntries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = i === activeIndex ? 'e active' : 'e';

    const title = document.createElement('div');
    title.className = 't';
    title.textContent = e.title;

    const username = document.createElement('div');
    username.className = 'u';
    username.textContent = e.username;

    row.appendChild(title);
    row.appendChild(username);
    row.addEventListener('mousedown', ev => { ev.preventDefault(); select(i); });

    panel.appendChild(row);
  });

  shadow.appendChild(style);
  shadow.appendChild(panel);
}

function select(i: number): void {
  const entry = currentEntries[i];
  if (entry && currentOnSelect) currentOnSelect(entry);
  hidePopup();
}

function onKeydown(ev: KeyboardEvent): void {
  if (!host || host.style.display === 'none' || currentEntries.length === 0) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    activeIndex = (activeIndex + 1) % currentEntries.length;
    render(host.shadowRoot!);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    activeIndex = (activeIndex - 1 + currentEntries.length) % currentEntries.length;
    render(host.shadowRoot!);
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    select(activeIndex);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    hidePopup();
    currentField?.focus();
  }
}

export function showPopup(field: HTMLElement, entries: EntryStub[], onSelect: (e: EntryStub) => void): void {
  const shadow = ensureHost();
  const rect = field.getBoundingClientRect();
  host!.style.cssText =
    `position:absolute;z-index:2147483647;` +
    `top:${rect.bottom + window.scrollY + 2}px;` +
    `left:${rect.left + window.scrollX}px;` +
    `min-width:${rect.width}px`;

  currentEntries = entries;
  currentField = field;
  currentOnSelect = onSelect;
  activeIndex = 0;
  render(shadow);

  if (!keydownBound) { document.addEventListener('keydown', onKeydown, true); keydownBound = true; }
}

export function hidePopup(): void {
  if (host) host.style.display = 'none';
}
