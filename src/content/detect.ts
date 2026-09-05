export interface LoginFields { username: HTMLInputElement | null; password: HTMLInputElement | null }

function loginTokens(input: HTMLInputElement): string[] {
  return input.autocomplete.toLowerCase().split(/\s+/);
}

function eligibleLoginInput(input: HTMLInputElement): boolean {
  if (!input.isConnected || input.matches(':disabled') || input.readOnly ||
      !['text', 'email', 'tel', 'password'].includes(input.type)) return false;
  if (loginTokens(input).some(token => token === 'one-time-code' || token.startsWith('cc-'))) return false;
  for (let element: Element | null = input; element; element = element.parentElement) {
    const style = input.ownerDocument.defaultView?.getComputedStyle(element);
    if (element.hasAttribute('hidden') || style?.display === 'none' ||
        style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function usernameHint(input: HTMLInputElement): boolean {
  return input.type !== 'password' && (loginTokens(input).some(token => token === 'username' || token === 'email') ||
    input.type === 'email' || /user|email/i.test(`${input.name} ${input.id}`));
}

function loginFieldsInContext(inputs: HTMLInputElement[], preferred?: HTMLInputElement | null): LoginFields {
  const empty: LoginFields = { username: null, password: null };
  const passwords = inputs.filter(input => input.type === 'password');
  const current = passwords.filter(input => loginTokens(input).includes('current-password'));
  const existing = passwords.filter(input => !loginTokens(input).includes('new-password'));
  const candidates = current.length ? current : existing.length ? existing : passwords;
  const password = preferred && candidates.includes(preferred) ? preferred : candidates.length === 1 ? candidates[0] : null;
  if (passwords.length && !password) return empty;

  const usernames = inputs.filter(input => input.type !== 'password');
  const explicit = usernames.filter(input => loginTokens(input).includes('username'));
  const hinted = usernames.filter(usernameHint);
  const choices = explicit.length ? explicit : hinted;
  let username: HTMLInputElement | null = null;
  if (preferred && choices.includes(preferred)) username = preferred;
  else if (choices.length === 1) username = choices[0];
  else if (choices.length > 1) return empty;
  else if (password) {
    // Document order is only a last resort, and only within this HTML form owner.
    const preceding = inputs.slice(0, inputs.indexOf(password)).filter(input => input.type !== 'password');
    username = preceding.at(-1) ?? null;
  }
  return { username, password };
}

export function findLoginFields(doc: Document, preferred?: HTMLInputElement | null): LoginFields {
  const empty: LoginFields = { username: null, password: null };
  if (preferred && (preferred.ownerDocument !== doc || !eligibleLoginInput(preferred))) return empty;
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input')).filter(eligibleLoginInput);
  if (preferred) return loginFieldsInContext(inputs.filter(input => input.form === preferred.form), preferred);

  const contexts = new Map<HTMLFormElement | null, HTMLInputElement[]>();
  for (const input of inputs) {
    const group = contexts.get(input.form) ?? [];
    group.push(input); contexts.set(input.form, group);
  }
  // A newsletter-only context should not compete with a unique password step.
  const groups = [...contexts.values()];
  const passwordGroups = groups.filter(group => group.some(input => input.type === 'password'));
  const candidates = passwordGroups.length ? passwordGroups : groups.filter(group => group.some(usernameHint));
  return candidates.length === 1 ? loginFieldsInContext(candidates[0]) : empty;
}

export function isLoginField(el: HTMLElement, fields: LoginFields): boolean {
  return el === fields.username || el === fields.password;
}

type Fillable = HTMLInputElement | HTMLSelectElement;

function nativeValueSetter(el: Fillable) {
  // React overwrites value via a descriptor on HTMLInputElement.prototype/HTMLSelectElement.prototype.
  // To trigger React's onChange, we must call the original setter so React's fiber
  // detects the value change and fires synthetic events.
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set?.bind(el);
}

function setValue(el: Fillable | null, val: string): void {
  if (!el) return;
  el.focus();
  const setter = nativeValueSetter(el);
  if (setter) setter(val); else el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export interface OtpFields { inputs: HTMLInputElement[] }

const OTP_SIGNAL = /(?:^|[\s_-])(?:otp|totp|2fa|mfa)(?:$|[\s_-])|one[\s_-]?time|verification[\s_-]?(?:code|token)|authenticator(?:[\s_-]?(?:code|token))?/i;
const OTP_EXCLUDE = /postal|postcode|zip|coupon|promo|referral|product|language|country|security[\s_-]?code/i;

function eligibleOtpInput(input: HTMLInputElement): boolean {
  const type = (input.type || 'text').toLowerCase();
  return !input.disabled && !input.readOnly && ['text', 'tel', 'number', 'password'].includes(type);
}

function hasOtpAutocomplete(input: HTMLInputElement): boolean {
  return input.autocomplete.toLowerCase().split(/\s+/).includes('one-time-code');
}

function otpText(input: HTMLInputElement): string {
  const labels = Array.from(input.labels ?? []).map(label => label.textContent ?? '').join(' ');
  return [input.id, input.name, input.placeholder, input.getAttribute('aria-label') ?? '', labels].join(' ');
}

function hasStrongOtpSignal(input: HTMLInputElement): boolean {
  const text = otpText(input);
  if (OTP_EXCLUDE.test(text) || !OTP_SIGNAL.test(text)) return false;
  return input.maxLength <= 0 || (input.maxLength >= 4 && input.maxLength <= 8);
}

function segmentedGroups(inputs: HTMLInputElement[]): HTMLInputElement[][] {
  const groups = new Map<Element, HTMLInputElement[]>();
  for (const input of inputs) {
    if (input.maxLength !== 1) continue;
    const container = input.closest('fieldset, [role="group"], form') ?? input.parentElement;
    if (!container) continue;
    const group = groups.get(container) ?? [];
    group.push(input); groups.set(container, group);
  }
  return [...groups.entries()].flatMap(([container, group]) => {
    if (group.length < 4 || group.length > 8) return [];
    const context = `${container.textContent ?? ''} ${group.map(otpText).join(' ')}`;
    if (!group.some(hasOtpAutocomplete) && (OTP_EXCLUDE.test(context) || !OTP_SIGNAL.test(context))) return [];
    return [group];
  });
}

export function findOtpFields(doc: Document, preferred?: HTMLInputElement | null): OtpFields {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input')).filter(eligibleOtpInput);
  const groups = segmentedGroups(inputs);
  if (preferred) {
    const segmented = groups.find(group => group.includes(preferred));
    if (segmented) return { inputs: segmented };
    if (hasOtpAutocomplete(preferred) || hasStrongOtpSignal(preferred)) return { inputs: [preferred] };
    return { inputs: [] };
  }
  if (groups.length === 1) return { inputs: groups[0] };
  const standard = inputs.filter(hasOtpAutocomplete);
  if (standard.length === 1) return { inputs: standard };
  const inferred = inputs.filter(hasStrongOtpSignal);
  return { inputs: inferred.length === 1 ? inferred : [] };
}

export function isOtpField(el: HTMLElement, fields: OtpFields): boolean {
  return fields.inputs.includes(el as HTMLInputElement);
}

export function fillOtpFields(fields: OtpFields, code: string): boolean {
  if (fields.inputs.length === 0) return false;
  if (fields.inputs.length === 1) { setValue(fields.inputs[0], code); return true; }
  if (fields.inputs.length !== code.length) return false;
  fields.inputs.forEach((input, index) => setValue(input, code[index]));
  return true;
}

// Real card forms commonly use <select> for expiry month/year (e.g. fill.dev's
// credit-card-simple form) with option *values* in whatever format the site chose
// (e.g. unpadded "1".."12" months, 4-digit years) — there's no reliable way to predict
// the format, so we try each plausible candidate and keep whichever one actually matches
// an existing <option value>, restoring the original selection if none do.
function setSelectValue(el: HTMLSelectElement | null, candidates: string[]): void {
  if (!el) return;
  const before = el.value;
  el.focus();
  const setter = nativeValueSetter(el);
  let matched = false;
  for (const c of candidates) {
    if (setter) setter(c); else el.value = c;
    if (el.value === c) { matched = true; break; }
  }
  if (!matched) { if (setter) setter(before); else el.value = before; }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fillFields(f: LoginFields, username: string, password: string): void {
  setValue(f.username, username); setValue(f.password, password);
}

// Card forms are detected purely via the standard `autocomplete` token set (cc-number,
// cc-name, cc-exp, cc-exp-month/-year, cc-csc) — no name/id heuristics, to keep false
// positives (and accidental overlap with login-form detection) low.
export interface CardFields {
  number: HTMLInputElement | null;
  name: HTMLInputElement | null;
  exp: HTMLInputElement | null;
  // Expiry month/year are commonly rendered as <select> (e.g. fill.dev), not <input>.
  expMonth: Fillable | null;
  expYear: Fillable | null;
  cvv: HTMLInputElement | null;
}

export function findCardFields(doc: Document): CardFields {
  return {
    number: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-number"]'),
    name: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-name"]'),
    exp: doc.querySelector<HTMLInputElement>('input[autocomplete="cc-exp"]'),
    expMonth: doc.querySelector<Fillable>('input[autocomplete="cc-exp-month"], select[autocomplete="cc-exp-month"]'),
    expYear: doc.querySelector<Fillable>('input[autocomplete="cc-exp-year"], select[autocomplete="cc-exp-year"]'),
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
  setValue(f.number, values.number);
  setValue(f.name, values.name);
  setValue(f.cvv, values.cvv);
  if (values.expires == null) return;
  const d = new Date(values.expires);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const monthUnpadded = String(d.getMonth() + 1);
  const year4 = String(d.getFullYear());
  const year2 = year4.slice(-2);

  if (f.exp) setValue(f.exp, `${month}/${year2}`);

  if (f.expMonth instanceof HTMLSelectElement) setSelectValue(f.expMonth, [month, monthUnpadded]);
  else if (f.expMonth) setValue(f.expMonth, month);

  if (f.expYear instanceof HTMLSelectElement) setSelectValue(f.expYear, [year4, year2]);
  // Split year <input>: honor its maxlength (2 vs 4 digits) when the site declared one.
  else if (f.expYear) setValue(f.expYear, f.expYear.maxLength === 2 ? year2 : year4);
}
