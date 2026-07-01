import { findLoginFields, fillFields, isLoginField } from './detect';
test('finds email-only field when no password present (single-step flow)', () => {
  document.body.innerHTML = `<form><input type="email" id="u" autocomplete="email"></form>`;
  const f = findLoginFields(document);
  expect(f.username?.id).toBe('u');
  expect(f.password).toBeNull();
});
test('finds password input and preceding text/email field', () => {
  document.body.innerHTML = `<form>
    <input type="email" id="u"><input type="password" id="p"></form>`;
  const f = findLoginFields(document);
  expect(f.password?.id).toBe('p'); expect(f.username?.id).toBe('u');
});
test('fillFields sets values and fires input events', () => {
  document.body.innerHTML = `<input type="text" id="u"><input type="password" id="p">`;
  const f = { username: document.getElementById('u') as HTMLInputElement,
              password: document.getElementById('p') as HTMLInputElement };
  let inputFired = false; f.username.addEventListener('input', () => { inputFired = true; });
  let changeFired = false; f.password.addEventListener('change', () => { changeFired = true; });
  let bubbleInput = false; document.body.addEventListener('input', () => { bubbleInput = true; });
  fillFields(f, 'octocat', 's3cr3t');
  expect(f.username.value).toBe('octocat'); expect(f.password.value).toBe('s3cr3t');
  expect(inputFired).toBe(true);
  expect(changeFired).toBe(true);
  expect(bubbleInput).toBe(true);
});
test('isLoginField true for username or password field, false otherwise', () => {
  document.body.innerHTML = `<input type="email" id="u"><input type="password" id="p"><input type="text" id="other">`;
  const fields = findLoginFields(document);
  const u = document.getElementById('u') as HTMLInputElement;
  const p = document.getElementById('p') as HTMLInputElement;
  const other = document.getElementById('other') as HTMLInputElement;
  expect(isLoginField(u, fields)).toBe(true);
  expect(isLoginField(p, fields)).toBe(true);
  expect(isLoginField(other, fields)).toBe(false);
});
