export interface LoginFields { username: HTMLInputElement | null; password: HTMLInputElement | null }
export function findLoginFields(doc: Document): LoginFields {
  const password = doc.querySelector<HTMLInputElement>('input[type="password"]');
  let username: HTMLInputElement | null = null;
  if (password) {
    const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input'));
    const pwIdx = inputs.indexOf(password);
    for (let i = pwIdx - 1; i >= 0; i--) {
      const t = (inputs[i].type || 'text').toLowerCase();
      if (t === 'text' || t === 'email' || t === 'tel') { username = inputs[i]; break; }
    }
    if (!username) username = doc.querySelector('input[autocomplete="username"], input[name*="user" i], input[name*="email" i]');
  } else {
    // Single-step flow (e.g. AWS, Google): only email/username visible, password appears after submit
    username = doc.querySelector(
      'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], ' +
      'input[name*="user" i], input[name*="email" i]'
    );
  }
  return { username, password };
}

export function isLoginField(el: HTMLElement, fields: LoginFields): boolean {
  return el === fields.username || el === fields.password;
}

function nativeInputSetter(el: HTMLInputElement) {
  // React overwrites input.value via a descriptor on HTMLInputElement.prototype.
  // To trigger React's onChange, we must call the original setter so React's fiber
  // detects the value change and fires synthetic events.
  return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(el);
}

export function fillFields(f: LoginFields, username: string, password: string): void {
  const set = (el: HTMLInputElement | null, val: string) => {
    if (!el) return;
    el.focus();
    const setter = nativeInputSetter(el);
    if (setter) setter(val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(f.username, username); set(f.password, password);
}
