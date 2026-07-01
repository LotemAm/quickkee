import type { EntryView } from '../shared/entry';

type EntryStub = Pick<EntryView, 'id' | 'title' | 'username'>;

let host: HTMLElement | null = null;
let activeIndex = 0;
let currentEntries: EntryStub[] = [];
let currentField: HTMLElement | null = null;
let currentOnSelect: ((e: EntryStub) => void) | null = null;
let keydownBound = false;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
  shadow.innerHTML = `<style>
    .p{background:#1e1e2e;border:1px solid #363654;border-radius:6px;
       box-shadow:0 4px 16px rgba(0,0,0,.45);overflow:hidden;
       font:13px/1.4 system-ui,-apple-system,sans-serif;color:#cdd6f4}
    .h{padding:5px 10px;font-size:11px;color:#888;border-bottom:1px solid #2a2a3e}
    .e{padding:7px 10px;cursor:pointer;border-bottom:1px solid #2a2a3e}
    .e:last-child{border-bottom:none}
    .e:hover,.e.active{background:#2a2a3e}
    .t{font-weight:500}
    .u{font-size:11px;color:#888;margin-top:1px}
  </style>
  <div class="p">
    <div class="h">QuickKee</div>
    ${currentEntries.map((e, i) => `<div class="e${i === activeIndex ? ' active' : ''}" data-idx="${i}"><div class="t">${esc(e.title)}</div><div class="u">${esc(e.username)}</div></div>`).join('')}
  </div>`;

  shadow.querySelectorAll<HTMLElement>('.e').forEach((el, i) => {
    el.addEventListener('mousedown', ev => { ev.preventDefault(); select(i); });
  });
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
