type InlinePopupModule = typeof import('./inlinePopup');

let popup: InlinePopupModule | undefined;
let shadow: ShadowRoot;

async function freshModule(): Promise<InlinePopupModule> {
  vi.resetModules();
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  popup = await import('./inlinePopup');
  return popup;
}

function getHost(): HTMLElement {
  return document.querySelector('[data-quickkee-popup]') as HTMLElement;
}

function field(): HTMLElement {
  return document.getElementById('f')!;
}

const entries = [
  { id: '1', title: 'First', username: 'user1' },
  { id: '2', title: 'Second', username: 'user2' },
];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<input id="f">';
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    shadow = attachShadow.call(this, init);
    return shadow;
  });
});

afterEach(() => {
  popup?.hidePopup();
  popup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('entry data is rendered as text inside a private closed shadow root', async () => {
  const { showPopup } = await freshModule();
  showPopup(field(), [{ id: '1', title: '<img src=x onerror=x>', username: '"><script>' }], vi.fn());

  expect(getHost()).not.toBeNull();
  expect(shadow.querySelector('.t')!.textContent).toBe('<img src=x onerror=x>');
  expect(shadow.querySelector('.u')!.textContent).toBe('"><script>');
  expect(shadow.querySelector('img')).toBeNull();
  expect(shadow.querySelector('script')).toBeNull();
  expect(getHost().shadowRoot).toBeNull();
  expect(Element.prototype.attachShadow).toHaveBeenCalledWith({ mode: 'closed' });
});

test('synthetic mousedown on a row cannot select an entry', async () => {
  const { showPopup } = await freshModule();
  const onSelect = vi.fn();
  showPopup(field(), entries, onSelect);
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  shadow.querySelectorAll('.e')[1].dispatchEvent(event);

  expect(onSelect).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  expect(getHost().style.display).not.toBe('none');
});

test.each(['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])('synthetic %s cannot change or select the picker', async key => {
  const { showPopup } = await freshModule();
  const onSelect = vi.fn();
  showPopup(field(), entries, onSelect);
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  field().dispatchEvent(event);

  expect(onSelect).not.toHaveBeenCalled();
  expect(shadow.querySelector('.e.active .t')!.textContent).toBe('First');
  expect(getHost().style.display).not.toBe('none');
  expect(event.defaultPrevented).toBe(false);
});

test('hidden and stale rows cannot call either the previous or current callback', async () => {
  const { showPopup, hidePopup } = await freshModule();
  const previous = vi.fn();
  const current = vi.fn();
  showPopup(field(), entries, previous);
  const staleRow = shadow.querySelector('.e')!;
  hidePopup();
  staleRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(previous).not.toHaveBeenCalled();
  expect(shadow.childElementCount).toBe(0);

  showPopup(field(), [entries[1]], current);
  staleRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(previous).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  expect(shadow.querySelector('.t')!.textContent).toBe('Second');
});

test('repeated show/hide binds one listener and releases it on each dismissal', async () => {
  const { showPopup, hidePopup } = await freshModule();
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');

  for (let cycle = 0; cycle < 3; cycle++) {
    showPopup(field(), entries, vi.fn());
    showPopup(field(), entries, vi.fn());
    const bound = add.mock.calls.filter(([name]) => name === 'keydown');
    expect(bound).toHaveLength(cycle + 1);
    hidePopup();
    hidePopup();
    expect(remove.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(cycle + 1);
    expect(remove).toHaveBeenLastCalledWith('keydown', bound[cycle][1], true);
    expect(getHost().style.display).toBe('none');
    expect(shadow.childElementCount).toBe(0);
  }
  expect(Element.prototype.attachShadow).toHaveBeenCalledTimes(1);
});

test('TOTP progress updates privately and stops on dismissal', async () => {
  const { showPopup, hidePopup } = await freshModule();
  vi.setSystemTime(10_000);
  showPopup(field(), [{ ...entries[0], hasTotp: true, totpPeriod: 30 }], vi.fn());
  const bar = shadow.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute('aria-label')).toBe('TOTP time remaining');
  expect(bar.getAttribute('aria-valuenow')).toBe('20');
  const width = (bar.firstElementChild as HTMLElement).style.width;
  vi.advanceTimersByTime(1_000);
  expect(bar.getAttribute('aria-valuenow')).toBe('19');
  expect((bar.firstElementChild as HTMLElement).style.width).not.toBe(width);
  expect(vi.getTimerCount()).toBe(1);

  hidePopup();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1_000);
  expect(bar.getAttribute('aria-valuenow')).toBe('19');
  expect(shadow.childElementCount).toBe(0);
});

test('replacing TOTP entries stops the previous progress timer', async () => {
  const { showPopup, hidePopup } = await freshModule();
  const totpEntries = [{ ...entries[0], hasTotp: true, totpPeriod: 30 }];
  showPopup(field(), totpEntries, vi.fn());
  showPopup(field(), totpEntries, vi.fn());
  expect(vi.getTimerCount()).toBe(1);
  showPopup(field(), entries, vi.fn());
  expect(vi.getTimerCount()).toBe(0);
  expect(shadow.querySelector('[role="progressbar"]')).toBeNull();
  hidePopup();
  expect(vi.getTimerCount()).toBe(0);
});
