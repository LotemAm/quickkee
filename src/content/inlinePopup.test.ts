type InlinePopupModule = typeof import('./inlinePopup');

async function freshModule(): Promise<InlinePopupModule> {
  vi.resetModules();
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  return import('./inlinePopup');
}

function getHost(): HTMLElement {
  return document.querySelector('[data-quickkee-popup]') as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '<input id="f">';
});

test('injection regression: entry data is rendered as text, not parsed as HTML', async () => {
  const { showPopup } = await freshModule();
  const field = document.getElementById('f') as HTMLElement;
  showPopup(field, [{ id: '1', title: '<img src=x onerror=x>', username: '"><script>' }], vi.fn());

  const host = getHost();
  expect(host).not.toBeNull();

  const shadow = host.shadowRoot!;
  expect(shadow.querySelector('.t')!.textContent).toBe('<img src=x onerror=x>');
  expect(shadow.querySelector('img')).toBeNull();
  expect(shadow.querySelector('script')).toBeNull();
});

test('selection: mousedown on a row calls onSelect with that entry and hides the popup', async () => {
  const { showPopup } = await freshModule();
  const field = document.getElementById('f') as HTMLElement;
  const onSelect = vi.fn();
  const entries = [
    { id: '1', title: 'First', username: 'user1' },
    { id: '2', title: 'Second', username: 'user2' },
  ];
  showPopup(field, entries, onSelect);

  const host = getHost();
  const rows = host.shadowRoot!.querySelectorAll('.e');
  rows[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

  expect(onSelect).toHaveBeenCalledWith(entries[1]);
  expect(host.style.display).toBe('none');
});

test('keyboard: ArrowDown moves active selection, Enter selects it', async () => {
  const { showPopup } = await freshModule();
  const field = document.getElementById('f') as HTMLElement;
  const onSelect = vi.fn();
  const entries = [
    { id: '1', title: 'First', username: 'user1' },
    { id: '2', title: 'Second', username: 'user2' },
  ];
  showPopup(field, entries, onSelect);

  const host = getHost();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

  const rows = host.shadowRoot!.querySelectorAll('.e');
  expect(rows[1].className).toContain('active');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(onSelect).toHaveBeenCalledWith(entries[1]);
});

test('escape hides the popup', async () => {
  const { showPopup } = await freshModule();
  const field = document.getElementById('f') as HTMLElement;
  showPopup(field, [{ id: '1', title: 'First', username: 'user1' }], vi.fn());

  const host = getHost();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  expect(host.style.display).toBe('none');
});
