import {
  findLoginFields, fillFields, isLoginField, findCardFields, isCardField, hasCardFields, fillCardFields,
  findOtpFields, fillOtpFields, isOtpField,
} from './detect';
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

test('findCardFields locates fields by autocomplete token, ignores unrelated inputs', () => {
  document.body.innerHTML = `<form>
    <input id="n" autocomplete="cc-number">
    <input id="nm" autocomplete="cc-name">
    <input id="cvv" autocomplete="cc-csc">
    <input id="other" name="promo">
  </form>`;
  const f = findCardFields(document);
  expect(f.number?.id).toBe('n');
  expect(f.name?.id).toBe('nm');
  expect(f.cvv?.id).toBe('cvv');
  expect(f.exp).toBeNull();
  expect(f.expMonth).toBeNull();
  expect(f.expYear).toBeNull();
});

test('findCardFields locates split expiry-month/year fields', () => {
  document.body.innerHTML = `<input id="m" autocomplete="cc-exp-month"><input id="y" autocomplete="cc-exp-year">`;
  const f = findCardFields(document);
  expect(f.expMonth?.id).toBe('m');
  expect(f.expYear?.id).toBe('y');
  expect(f.exp).toBeNull();
});

test('findCardFields locates <select>-based expiry-month/year fields (e.g. fill.dev)', () => {
  document.body.innerHTML = `
    <select id="m" autocomplete="cc-exp-month"><option value="1">01</option></select>
    <select id="y" autocomplete="cc-exp-year"><option value="2027">2027</option></select>`;
  const f = findCardFields(document);
  expect(f.expMonth?.id).toBe('m');
  expect(f.expYear?.id).toBe('y');
  expect(f.expMonth).toBeInstanceOf(HTMLSelectElement);
  expect(f.expYear).toBeInstanceOf(HTMLSelectElement);
});

test('hasCardFields false when no card autocomplete fields present', () => {
  document.body.innerHTML = `<input type="text" id="x">`;
  expect(hasCardFields(findCardFields(document))).toBe(false);
});

test('isCardField true only for detected card fields', () => {
  document.body.innerHTML = `<input id="n" autocomplete="cc-number"><input id="other">`;
  const fields = findCardFields(document);
  const n = document.getElementById('n') as HTMLInputElement;
  const other = document.getElementById('other') as HTMLInputElement;
  expect(isCardField(n, fields)).toBe(true);
  expect(isCardField(other, fields)).toBe(false);
});

test('fillCardFields sets number, name, cvv and combined MM/YY expiry', () => {
  document.body.innerHTML = `<input id="n" autocomplete="cc-number"><input id="nm" autocomplete="cc-name">
    <input id="cvv" autocomplete="cc-csc"><input id="exp" autocomplete="cc-exp">`;
  const f = findCardFields(document);
  const expires = new Date(2029, 4, 1).getTime(); // May 2029
  fillCardFields(f, { number: '4111111111111111', name: 'Jane Doe', cvv: '123', expires });
  expect(f.number?.value).toBe('4111111111111111');
  expect(f.name?.value).toBe('Jane Doe');
  expect(f.cvv?.value).toBe('123');
  expect(f.exp?.value).toBe('05/29');
});

test('fillCardFields splits expiry into 2-digit year field when maxlength=2', () => {
  document.body.innerHTML = `<input id="m" autocomplete="cc-exp-month"><input id="y" autocomplete="cc-exp-year" maxlength="2">`;
  const f = findCardFields(document);
  const expires = new Date(2029, 4, 1).getTime();
  fillCardFields(f, { number: '', name: '', cvv: '', expires });
  expect(f.expMonth?.value).toBe('05');
  expect(f.expYear?.value).toBe('29');
});

test('fillCardFields splits expiry into 4-digit year field when no 2-digit maxlength', () => {
  document.body.innerHTML = `<input id="m" autocomplete="cc-exp-month"><input id="y" autocomplete="cc-exp-year">`;
  const f = findCardFields(document);
  const expires = new Date(2029, 4, 1).getTime();
  fillCardFields(f, { number: '', name: '', cvv: '', expires });
  expect(f.expYear?.value).toBe('2029');
});

test('fillCardFields no-ops on absent fields and null expires', () => {
  document.body.innerHTML = `<input id="n" autocomplete="cc-number">`;
  const f = findCardFields(document);
  expect(() => fillCardFields(f, { number: '4111', name: 'X', cvv: '1', expires: null })).not.toThrow();
  expect(f.number?.value).toBe('4111');
});

test('fillCardFields selects matching <option> in unpadded-value expiry <select>s (fill.dev shape)', () => {
  document.body.innerHTML = `
    <select id="m" autocomplete="cc-exp-month">
      <option value="1">01</option><option value="5">05</option><option value="12">12</option>
    </select>
    <select id="y" autocomplete="cc-exp-year">
      <option value="2026">2026</option><option value="2027">2027</option>
    </select>`;
  const f = findCardFields(document);
  const expires = new Date(2027, 4, 1).getTime(); // May 2027
  fillCardFields(f, { number: '', name: '', cvv: '', expires });
  expect((f.expMonth as HTMLSelectElement).value).toBe('5');
  expect((f.expYear as HTMLSelectElement).value).toBe('2027');
});

test('fillCardFields leaves expiry <select> at its original value when no option matches', () => {
  document.body.innerHTML = `
    <select id="y" autocomplete="cc-exp-year">
      <option value="2026">2026</option><option value="2027">2027</option>
    </select>`;
  const f = findCardFields(document);
  const before = (f.expYear as HTMLSelectElement).value;
  const expires = new Date(2030, 0, 1).getTime(); // out of the select's range
  fillCardFields(f, { number: '', name: '', cvv: '', expires });
  expect((f.expYear as HTMLSelectElement).value).toBe(before);
});

test('findOtpFields prefers the standard one-time-code autocomplete token', () => {
  document.body.innerHTML = `<input id="otp" autocomplete="one-time-code"><input id="other" name="product_code">`;
  const fields = findOtpFields(document);
  expect(fields.inputs.map(input => input.id)).toEqual(['otp']);
  expect(isOtpField(document.getElementById('otp')!, fields)).toBe(true);
});

test('findOtpFields accepts strong conservative TOTP signals', () => {
  document.body.innerHTML = `<label for="token">Authenticator verification code</label><input id="token" inputmode="numeric" maxlength="6">`;
  expect(findOtpFields(document).inputs.map(input => input.id)).toEqual(['token']);
});

test.each(['postal_code', 'coupon_code', 'product_code', 'language_code', 'referral_code'])(
  'findOtpFields excludes unrelated %s fields', name => {
    document.body.innerHTML = `<input id="candidate" name="${name}" maxlength="6">`;
    expect(findOtpFields(document).inputs).toEqual([]);
  },
);

test('findOtpFields and fillOtpFields support a labelled segmented code group', () => {
  document.body.innerHTML = `<fieldset><legend>Enter authenticator code</legend>${
    Array.from({ length: 6 }, (_, i) => `<input id="d${i}" maxlength="1" inputmode="numeric">`).join('')
  }</fieldset>`;
  const fields = findOtpFields(document, document.getElementById('d2') as HTMLInputElement);
  expect(fields.inputs).toHaveLength(6);
  expect(fillOtpFields(fields, '123456')).toBe(true);
  expect(fields.inputs.map(input => input.value).join('')).toBe('123456');
});

test('fillOtpFields sets a single field and dispatches input/change events', () => {
  document.body.innerHTML = `<input id="otp" autocomplete="one-time-code">`;
  const fields = findOtpFields(document);
  const input = fields.inputs[0];
  const onInput = vi.fn(); const onChange = vi.fn();
  input.addEventListener('input', onInput); input.addEventListener('change', onChange);
  expect(fillOtpFields(fields, '654321')).toBe(true);
  expect(input.value).toBe('654321');
  expect(onInput).toHaveBeenCalledOnce(); expect(onChange).toHaveBeenCalledOnce();
});
