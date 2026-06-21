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
  }
  return { username, password };
}
export function fillFields(f: LoginFields, username: string, password: string): void {
  const set = (el: HTMLInputElement | null, val: string) => {
    if (!el) return; el.focus(); el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(f.username, username); set(f.password, password);
}
