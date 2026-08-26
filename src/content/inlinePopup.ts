import type { EntrySummary } from '../shared/entry';
import { loadSettings } from '../shared/settings';
import { resolvesDark, shadowPalette } from './shadowPalette';

type EntryStub = Pick<EntrySummary, 'id' | 'title' | 'username'>
  & Partial<Pick<EntrySummary, 'hasTotp' | 'totpPeriod'>>;

let host: HTMLElement | null = null;
let activeIndex = 0;
let currentEntries: EntryStub[] = [];
let currentField: HTMLElement | null = null;
let currentOnSelect: ((e: EntryStub) => void) | null = null;
let keydownBound = false;
let dark = false;
let progressTimer: ReturnType<typeof setInterval> | null = null;

function updateProgressBars(): void {
  const shadow = host?.shadowRoot;
  if (!shadow) return;
  shadow.querySelectorAll<HTMLElement>('.bar[data-period]').forEach(bar => {
    const period = Number(bar.dataset.period);
    if (!period) return;
    const periodMs = period * 1000;
    const remainingMs = periodMs - (Date.now() % periodMs);
    bar.setAttribute('aria-valuenow', String(Math.max(1, Math.ceil(remainingMs / 1000))));
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${(remainingMs / periodMs) * 100}%`;
  });
}

void loadSettings().then(s => {
  dark = resolvesDark(s.theme);
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
  const c = shadowPalette(dark);

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
    .bar{height:3px;margin-top:5px;background:${c.hover};border-radius:999px;overflow:hidden}
    .bar>span{display:block;height:100%;background:${c.text};border-radius:999px}
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
    if (e.hasTotp && e.totpPeriod) {
      const periodMs = e.totpPeriod * 1000;
      const remainingMs = periodMs - (Date.now() % periodMs);
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'TOTP time remaining');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(e.totpPeriod));
      bar.setAttribute('aria-valuenow', String(Math.max(1, Math.ceil(remainingMs / 1000))));
      bar.dataset.period = String(e.totpPeriod);
      const fill = document.createElement('span');
      fill.style.width = `${(remainingMs / periodMs) * 100}%`;
      bar.appendChild(fill); row.appendChild(bar);
    }
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

  if (progressTimer) clearInterval(progressTimer);
  progressTimer = entries.some(entry => entry.hasTotp && entry.totpPeriod)
    ? setInterval(updateProgressBars, 250)
    : null;

  if (!keydownBound) { document.addEventListener('keydown', onKeydown, true); keydownBound = true; }
}

export function hidePopup(): void {
  if (host) host.style.display = 'none';
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}
