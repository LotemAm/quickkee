import { findLoginFields, fillFields } from './detect';
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
  let fired = false; f.username.addEventListener('input', () => { fired = true; });
  fillFields(f, 'octocat', 's3cr3t');
  expect(f.username.value).toBe('octocat'); expect(f.password.value).toBe('s3cr3t');
  expect(fired).toBe(true);
});
