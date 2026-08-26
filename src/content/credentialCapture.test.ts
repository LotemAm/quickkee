import { extractCredentialCandidate, SubmitGestureTracker } from './credentialCapture';

function form(markup: string): HTMLFormElement {
  document.body.innerHTML = `<form id="target">${markup}</form>`;
  return document.getElementById('target') as HTMLFormElement;
}

function candidate(markup: string, values: Record<string, string>) {
  const target = form(markup);
  for (const [id, value] of Object.entries(values)) {
    (document.getElementById(id) as HTMLInputElement).value = value;
  }
  return extractCredentialCandidate(target);
}

test('extracts a current-password login with the standards-based username field', () => {
  expect(candidate(
    '<input id="u" autocomplete="username"><input id="p" type="password" autocomplete="current-password">',
    { u: 'OctoCat', p: 'login-secret' },
  )).toEqual({ username: 'OctoCat', password: 'login-secret', kind: 'login' });
});

test('prefers an email username signal', () => {
  expect(candidate(
    '<input id="u" type="email" autocomplete="email"><input id="p" type="password">',
    { u: 'user@example.test', p: 'login-secret' },
  )).toMatchObject({ username: 'user@example.test' });
});

test('accepts matching new-password and confirmation fields', () => {
  expect(candidate(
    '<input id="u" autocomplete="username"><input id="n" type="password" autocomplete="new-password"><input id="c" type="password" autocomplete="new-password">',
    { u: 'octocat', n: 'new-secret', c: 'new-secret' },
  )).toEqual({ username: 'octocat', password: 'new-secret', kind: 'password-change' });
});

test('selects new-password from a current/new/confirmation password-change form', () => {
  expect(candidate(
    '<input id="u" autocomplete="username"><input id="old" type="password" autocomplete="current-password"><input id="n" type="password" autocomplete="new-password"><input id="c" type="password" autocomplete="new-password">',
    { u: 'octocat', old: 'old-secret', n: 'new-secret', c: 'new-secret' },
  )).toEqual({ username: 'octocat', password: 'new-secret', kind: 'password-change' });
});

test('rejects unresolved differing password values', () => {
  expect(candidate(
    '<input id="a" type="password"><input id="b" type="password">',
    { a: 'first-secret', b: 'second-secret' },
  )).toBeNull();
});

test('rejects an empty password', () => {
  expect(candidate('<input id="p" type="password" autocomplete="current-password">', { p: '' })).toBeNull();
});

test('rejects forms containing an OTP field', () => {
  expect(candidate(
    '<input id="p" type="password" autocomplete="current-password"><input id="otp" autocomplete="one-time-code">',
    { p: 'login-secret', otp: '123456' },
  )).toBeNull();
});

test('rejects CVV and detected card forms', () => {
  expect(candidate(
    '<input id="n" autocomplete="cc-number"><input id="p" type="password" autocomplete="cc-csc">',
    { n: '4111111111111111', p: '123' },
  )).toBeNull();
});

test('does not pair inputs outside the submitted form', () => {
  document.body.innerHTML = `
    <input id="outside" autocomplete="username" value="outside-user">
    <form id="target"><input id="p" type="password" autocomplete="current-password" value="login-secret"></form>`;
  expect(extractCredentialCandidate(document.getElementById('target') as HTMLFormElement))
    .toEqual({ username: '', password: 'login-secret', kind: 'login' });
});

test('ignores disabled and read-only password inputs', () => {
  expect(candidate(
    '<input id="disabled" type="password" disabled><input id="readonly" type="password" readonly>',
    { disabled: 'disabled-secret', readonly: 'readonly-secret' },
  )).toBeNull();
});

test('submission gating rejects synthetic, stale, and unrelated gestures', () => {
  const target = form('<input id="u"><button id="submit" type="submit">Sign in</button>');
  const other = document.createElement('form');
  document.body.appendChild(other);
  const tracker = new SubmitGestureTracker();

  tracker.record({ isTrusted: false, target: document.getElementById('submit') } as unknown as Event, 1_000);
  expect(tracker.consume(target, 1_100)).toBe(false);

  tracker.record({ isTrusted: true, target: document.getElementById('submit'), type: 'pointerdown' } as unknown as Event, 2_000);
  expect(tracker.consume(other, 2_100)).toBe(false);
  expect(tracker.consume(target, 5_001)).toBe(false);

  tracker.record({ isTrusted: true, target: document.getElementById('u'), type: 'keydown', key: 'Enter' } as unknown as KeyboardEvent, 6_000);
  expect(tracker.consume(target, 6_100)).toBe(true);
  expect(tracker.consume(target, 6_101)).toBe(false);
});

test('submission gating accepts keyboard activation of submit buttons but not textarea newlines', () => {
  const target = form('<textarea id="notes"></textarea><button id="submit" type="submit">Sign in</button>');
  const tracker = new SubmitGestureTracker();
  tracker.record({ isTrusted: true, target: document.getElementById('notes'), type: 'keydown', key: 'Enter' } as unknown as KeyboardEvent, 1_000);
  expect(tracker.consume(target, 1_100)).toBe(false);
  tracker.record({ isTrusted: true, target: document.getElementById('submit'), type: 'keydown', key: ' ' } as unknown as KeyboardEvent, 2_000);
  expect(tracker.consume(target, 2_100)).toBe(true);
});
