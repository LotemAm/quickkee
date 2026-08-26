export type CredentialKind = 'login' | 'password-change';

export interface CredentialCandidate {
  username: string;
  password: string;
  kind: CredentialKind;
}

const OTP_SIGNAL = /(?:^|[\s_-])(?:otp|totp|2fa|mfa)(?:$|[\s_-])|one[\s_-]?time|verification[\s_-]?(?:code|token)|authenticator/i;
const GESTURE_TTL_MS = 2_000;

function tokens(input: HTMLInputElement): string[] {
  return input.autocomplete.toLowerCase().split(/\s+/).filter(Boolean);
}

function inputText(input: HTMLInputElement): string {
  const labels = Array.from(input.labels ?? []).map(label => label.textContent ?? '').join(' ');
  return [input.id, input.name, input.placeholder, input.getAttribute('aria-label') ?? '', labels].join(' ');
}

function eligible(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly;
}

function uniqueValue(inputs: HTMLInputElement[]): string | null {
  const values = new Set(inputs.map(input => input.value).filter(value => value.length > 0));
  return values.size === 1 ? [...values][0] : null;
}

function findUsername(inputs: HTMLInputElement[], password: HTMLInputElement): string {
  const available = inputs.filter(input => eligible(input) && input.type !== 'password' && input.type !== 'hidden');
  const standard = available.find(input => tokens(input).includes('username'))
    ?? available.find(input => tokens(input).includes('email'));
  if (standard) return standard.value.trim();

  const beforePassword = available.filter(input => {
    const type = (input.type || 'text').toLowerCase();
    return ['text', 'email', 'tel'].includes(type) &&
      !!(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
  }).at(-1);
  if (beforePassword) return beforePassword.value.trim();

  const inferred = available.find(input => {
    const type = (input.type || 'text').toLowerCase();
    return type === 'email' || /user|email|login/i.test(`${input.id} ${input.name}`);
  });
  return inferred?.value.trim() ?? '';
}

export function extractCredentialCandidate(form: HTMLFormElement): CredentialCandidate | null {
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
  if (inputs.some(input => {
    const autocomplete = tokens(input);
    return autocomplete.some(token => token.startsWith('cc-')) || autocomplete.includes('one-time-code')
      || (input.type !== 'password' && OTP_SIGNAL.test(inputText(input)));
  })) return null;

  const passwords = inputs.filter(input => eligible(input) && input.type === 'password' && input.value.length > 0);
  if (passwords.length === 0) return null;

  const newPasswords = passwords.filter(input => tokens(input).includes('new-password'));
  if (newPasswords.length > 0) {
    const password = uniqueValue(newPasswords);
    if (password === null) return null;
    return { username: findUsername(inputs, newPasswords[0]), password, kind: 'password-change' };
  }

  const currentPasswords = passwords.filter(input => tokens(input).includes('current-password'));
  if (currentPasswords.length > 0) {
    const password = uniqueValue(currentPasswords);
    if (password === null) return null;
    return { username: findUsername(inputs, currentPasswords[0]), password, kind: 'login' };
  }

  if (passwords.length !== 1) return null;
  return { username: findUsername(inputs, passwords[0]), password: passwords[0].value, kind: 'login' };
}

export class SubmitGestureTracker {
  private recent: { form: HTMLFormElement; at: number } | null = null;

  record(event: Event, now = Date.now()): void {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    let form: HTMLFormElement | null = null;
    const control = event.target.closest<HTMLButtonElement | HTMLInputElement>('button, input');
    const isSubmit = control instanceof HTMLButtonElement
      ? control.type === 'submit'
      : control instanceof HTMLInputElement && ['submit', 'image'].includes(control.type);
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (isSubmit && (key === 'Enter' || key === ' ')) form = control?.form ?? null;
      else if (key === 'Enter' && event.target instanceof HTMLInputElement) form = event.target.form;
      else return;
    } else {
      if (!isSubmit) return;
      form = control?.form ?? null;
    }
    if (form) this.recent = { form, at: now };
  }

  consume(form: HTMLFormElement, now = Date.now()): boolean {
    if (!this.recent) return false;
    if (now - this.recent.at > GESTURE_TTL_MS) { this.recent = null; return false; }
    if (this.recent.form !== form) return false;
    this.recent = null;
    return true;
  }
}
