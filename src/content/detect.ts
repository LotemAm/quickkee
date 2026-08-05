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

function setInputValue(el: HTMLInputElement | null, val: string): void {
  if (!el) return;
  el.focus();
  const setter = nativeInputSetter(el);
  if (setter) setter(val); else el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fillFields(f: LoginFields, username: string, password: string): void {
  setInputValue(f.username, username); setInputValue(f.password, password);
}

// Card forms are detected purely via the standard `autocomplete` token set (cc-number,
// cc-name, cc-exp, cc-exp-month/-year, cc-csc) — no name/id heuristics, to keep false
// positives (and accidental overlap with login-form detection) low.
export interface CardFields {
  number: HTMLInputElement | null;
  name: HTMLInputElement | null;
  exp: HTMLInputElement | null;
  expMonth: HTMLInputElement | null;
  expYear: HTMLInputElement | null;
  cvv: HTMLInputElement | null;
}

export function findCardFields(doc: Document): CardFields {
  return {
    number: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-number"]'),
    name: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-name"]'),
    exp: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-exp"]'),
    expMonth: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-exp-month"]'),
    expYear: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-exp-year"]'),
    cvv: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-csc"]'),
  };
}

export function isCardField(el: HTMLElement, fields: CardFields): boolean {
  return el === fields.number || el === fields.name || el === fields.exp ||
    el === fields.expMonth || el === fields.expYear || el === fields.cvv;
}

export function hasCardFields(fields: CardFields): boolean {
  return !!(fields.number || fields.name || fields.exp || fields.expMonth || fields.expYear || fields.cvv);
}

export interface CardValues { number: string; name: string; cvv: string; expires: number | null }

export function fillCardFields(f: CardFields, values: CardValues): void {
  setInputValue(f.number, values.number);
  setInputValue(f.name, values.name);
  setInputValue(f.cvv, values.cvv);
  if (values.expires == null) return;
  const d = new Date(values.expires);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year4 = String(d.getFullYear());
  const year2 = year4.slice(-2);
  if (f.exp) setInputValue(f.exp, `${month}/${year2}`);
  if (f.expMonth) setInputValue(f.expMonth, month);
  // Split year field: honor its maxlength (2 vs 4 digits) when the site declared one.
  if (f.expYear) setInputValue(f.expYear, f.expYear.maxLength === 2 ? year2 : year4);
}
