import type { CredentialPromptMetadata } from '../shared/messages';
import { CredentialPrompt } from './credentialPrompt';
import { CREDENTIAL_CAPTURE_TTL_MS } from '../shared/credentialCapture';

const base: CredentialPromptMetadata = {
  captureId: 'capture-id', site: 'example.test', username: 'octocat', kind: 'login',
  suggestedAction: 'save', entries: [],
};

function captureClosedShadow() {
  let shadow: ShadowRoot | null = null;
  const original = Element.prototype.attachShadow;
  const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    shadow = original.call(this, init);
    return shadow;
  });
  return { spy, get: () => shadow };
}

function handlers() {
  return { commit: vi.fn(async () => true), dismiss: vi.fn(async () => {}) };
}

beforeEach(() => { document.body.replaceChildren(); });

test('renders safe create and update copy in a fixed closed-shadow dialog', () => {
  const captured = captureClosedShadow();
  const prompt = new CredentialPrompt({ trustedAction: () => true });
  prompt.show(base, handlers());

  const host = document.querySelector('[data-quickkee-credential-prompt]') as HTMLElement;
  expect(host.style.position).toBe('fixed');
  expect(host.shadowRoot).toBeNull();
  expect(captured.spy).toHaveBeenCalledWith({ mode: 'closed' });
  expect(captured.get()!.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBeTruthy();
  expect(captured.get()!.textContent).toContain('Save this login?');
  expect(captured.get()!.textContent).toContain('example.test');

  prompt.show({ ...base, suggestedAction: 'update', entries: [{ id: 'entry-1', title: 'Existing', username: 'octocat' }] }, handlers());
  expect(captured.get()!.textContent).toContain('Update this password?');
  expect(captured.get()!.textContent).toContain('Existing');
  prompt.hide();
  captured.spy.mockRestore();
});

test('default trusted-action gate ignores scripted primary and dismiss clicks', () => {
  const captured = captureClosedShadow();
  const h = handlers();
  const prompt = new CredentialPrompt();
  prompt.show(base, h);

  (captured.get()!.querySelector('[data-action="primary"]') as HTMLButtonElement).click();
  (captured.get()!.querySelector('[data-action="dismiss"]') as HTMLButtonElement).click();
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.dismiss).not.toHaveBeenCalled();
  prompt.hide();
  captured.spy.mockRestore();
});

test('ambiguous state requires and submits an explicit destination or save-as-new choice', async () => {
  const captured = captureClosedShadow();
  const h = handlers();
  const prompt = new CredentialPrompt({ trustedAction: () => true });
  prompt.show({ ...base, suggestedAction: 'choose', entries: [
    { id: 'entry-1', title: 'First', username: 'octocat' },
    { id: 'entry-2', title: 'Second', username: 'octocat' },
  ] }, h);

  const select = captured.get()!.querySelector('select') as HTMLSelectElement;
  const primary = captured.get()!.querySelector('[data-action="primary"]') as HTMLButtonElement;
  expect(primary.disabled).toBe(true);
  select.value = 'entry-2'; select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(primary.disabled).toBe(false);
  primary.click();
  await vi.waitFor(() => expect(h.commit).toHaveBeenCalledWith({ captureId: 'capture-id', entryId: 'entry-2' }));

  prompt.show({ ...base, suggestedAction: 'choose', entries: [{ id: 'entry-1', title: 'First', username: 'octocat' }] }, h);
  const secondSelect = captured.get()!.querySelector('select') as HTMLSelectElement;
  secondSelect.value = '__new__'; secondSelect.dispatchEvent(new Event('change', { bubbles: true }));
  (captured.get()!.querySelector('[data-action="primary"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(h.commit).toHaveBeenCalledWith({ captureId: 'capture-id', saveAsNew: true }));
  captured.spy.mockRestore();
});

test('shows loading and a non-secret retry error after a failed commit', async () => {
  const captured = captureClosedShadow();
  let resolve!: (ok: boolean) => void;
  const h = { commit: vi.fn(() => new Promise<boolean>(done => { resolve = done; })), dismiss: vi.fn() };
  const prompt = new CredentialPrompt({ trustedAction: () => true });
  prompt.show(base, h);
  const primary = captured.get()!.querySelector('[data-action="primary"]') as HTMLButtonElement;
  primary.click();
  expect(primary.disabled).toBe(true);
  expect(captured.get()!.textContent).toContain('Saving');
  resolve(false);
  await vi.waitFor(() => expect(captured.get()!.textContent).toContain('Couldn’t save. Try again.'));
  expect(primary.disabled).toBe(false);
  captured.spy.mockRestore();
});

test('Escape dismisses, removes listeners, and no supplied secret reaches host or shadow DOM', () => {
  const captured = captureClosedShadow();
  const h = handlers();
  const prompt = new CredentialPrompt({ trustedAction: () => true });
  const withUnexpectedSecret = { ...base, password: 'must-not-render' } as CredentialPromptMetadata;
  prompt.show(withUnexpectedSecret, h);
  expect(document.documentElement.outerHTML).not.toContain('must-not-render');
  expect(captured.get()!.textContent).not.toContain('must-not-render');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(h.dismiss).toHaveBeenCalledWith('capture-id');
  expect(document.querySelector('[data-quickkee-credential-prompt]')).toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(h.dismiss).toHaveBeenCalledOnce();
  captured.spy.mockRestore();
});

test('expiry dismisses and removes the visible prompt', () => {
  vi.useFakeTimers();
  try {
    const h = handlers();
    const prompt = new CredentialPrompt({ trustedAction: () => true });
    prompt.show(base, h);
    vi.advanceTimersByTime(CREDENTIAL_CAPTURE_TTL_MS);
    expect(h.dismiss).toHaveBeenCalledWith('capture-id');
    expect(document.querySelector('[data-quickkee-credential-prompt]')).toBeNull();
  } finally { vi.useRealTimers(); }
});
