import http from 'node:http';
import https from 'node:https';
import selfsigned from 'selfsigned';
import type { AddressInfo } from 'node:net';
import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library';

export const SCANNED_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const SCANNED_TOTP_URI = `otpauth://totp/QuickKee%20E2E:qr-user%40localhost?secret=${SCANNED_TOTP_SECRET}&issuer=QuickKee%20E2E`;

function qrSvg(value: string): string {
  const matrix = new QRCodeWriter().encode(
    value,
    BarcodeFormat.QR_CODE,
    0,
    0,
    new Map([[EncodeHintType.MARGIN, 4]]),
  );
  const path: string[] = [];
  for (let y = 0; y < matrix.getHeight(); y++) {
    let x = 0;
    while (x < matrix.getWidth()) {
      if (!matrix.get(x, y)) { x++; continue; }
      const start = x;
      while (x < matrix.getWidth() && matrix.get(x, y)) x++;
      path.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return `<svg id="totp-qr" role="img" aria-label="Authenticator setup QR code"
    viewBox="0 0 ${matrix.getWidth()} ${matrix.getHeight()}" xmlns="http://www.w3.org/2000/svg"
    shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join('')}" fill="#111827"/></svg>`;
}

const TOTP_QR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Account security</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#f3f6fb;color:#172033;font:15px system-ui,sans-serif}
  header{height:64px;background:#172033;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 34px}
  nav{display:flex;gap:22px;color:#cbd5e1}.avatar{width:34px;height:34px;border-radius:50%;background:#60a5fa;display:grid;place-items:center;font-weight:700}
  main{max-width:1080px;margin:26px auto;padding:0 24px}.eyebrow{color:#64748b;font-size:13px}.title-row{display:flex;align-items:center;justify-content:space-between}
  button{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:9px 13px;color:#172033}.primary{background:#2563eb;color:#fff;border-color:#2563eb}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0}.stat,.card{background:#fff;border:1px solid #dbe3ef;border-radius:13px;box-shadow:0 2px 8px #1e293b0c}
  .stat{padding:15px}.stat strong{display:block;font-size:20px;margin-top:5px}.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px}
  .card{padding:20px}.method{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #e8edf5}.method:last-child{border:0}
  .method p,.muted{margin:4px 0 0;color:#64748b;font-size:13px}.qr-card{text-align:center}.qr-card svg{display:block;width:280px;height:280px;margin:12px auto;background:#fff}
  .notice{background:#eff6ff;border-radius:8px;padding:10px;color:#1e40af;font-size:13px;text-align:left}.activity{margin-top:18px}.activity-row{display:grid;grid-template-columns:1fr 1fr 90px;padding:11px 0;border-top:1px solid #e8edf5;color:#475569}
</style></head><body>
<header><strong>Northstar Workspace</strong><nav><span>Dashboard</span><span>Projects</span><span>Billing</span><span>Security</span></nav><div class="avatar">QA</div></header>
<main><div class="title-row"><div><div class="eyebrow">Settings / Account</div><h1>Security overview</h1></div><button>Download recovery codes</button></div>
<section class="stats" aria-label="Security summary"><div class="stat">Security score<strong>86%</strong></div><div class="stat">Active sessions<strong>3</strong></div><div class="stat">Trusted devices<strong>2</strong></div></section>
<div class="grid"><section class="card"><h2>Sign-in methods</h2><div class="method"><div><strong>Password</strong><p>Last changed 18 days ago</p></div><button>Change</button></div>
<div class="method"><div><strong>Passkeys</strong><p>Use biometrics or a hardware key</p></div><button>Set up</button></div>
<div class="method"><div><strong>Recovery email</strong><p>qa-team@example.test</p></div><button>Update</button></div>
<div class="activity"><h2>Recent sign-ins</h2><div class="activity-row"><span>Chrome on Windows</span><span>Tel Aviv, Israel</span><span>Now</span></div><div class="activity-row"><span>Mobile app</span><span>Jerusalem, Israel</span><span>Yesterday</span></div></div></section>
<aside class="card qr-card"><span class="eyebrow">Authenticator app</span><h2>Scan to finish setup</h2><p class="muted">Use your password manager or authenticator app.</p>${qrSvg(SCANNED_TOTP_URI)}
<div class="notice">Keep this page open until setup is confirmed.</div><p><button class="primary">Verify and continue</button></p></aside></div></main></body></html>`;

const LOGIN_PAGE = `<!doctype html><html><body>
<h1>Login</h1>
<form method="post" action="/credential-landing">
  <input id="username" name="username" type="text" autocomplete="username" />
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const SINGLE_STEP_PAGE = `<!doctype html><html><body>
<h1>Login</h1>
<form>
  <input id="email" name="resolvingInput" type="email" autocomplete="email" placeholder="username@example.com" />
  <button type="submit">Next</button>
</form>
</body></html>`;

const OTP_PAGE = `<!doctype html><html><body>
<h1>Login with authenticator</h1>
<form method="post" action="/credential-landing">
  <input id="username" name="username" autocomplete="username" />
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <label for="otp">Authenticator code</label>
  <input id="otp" name="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

// Standard-autocomplete-tagged card form fixture (plan: card-form autofill). Only the
// autocomplete tokens matter to detect.ts's findCardFields — ids/names are incidental.
const CARD_PAGE = `<!doctype html><html><body>
<h1>Payment</h1>
<form method="post" action="/credential-landing">
  <input id="cc-number" name="cardnumber" autocomplete="cc-number" />
  <input id="cc-name" name="cardname" autocomplete="cc-name" />
  <input id="cc-exp" name="cardexpiry" autocomplete="cc-exp" placeholder="MM/YY" />
  <input id="cc-csc" name="cardcvc" autocomplete="cc-csc" />
  <button type="submit">Pay</button>
</form>
</body></html>`;

// <select>-based expiry fixture, mirroring real sites like fill.dev/form/credit-card-simple
// whose cc-exp-month/cc-exp-year are <select> elements with unpadded/full-year option
// values rather than <input>s — a shape the plain-input-only detector originally missed.
const CARD_SELECT_PAGE = `<!doctype html><html><body>
<h1>Payment</h1>
<form>
  <input id="cc-number" name="cardnumber" autocomplete="cc-number" />
  <input id="cc-name" name="cardname" autocomplete="cc-name" />
  <select id="cc-exp-month" name="cardmonth" autocomplete="cc-exp-month">
    <option value="">MM</option>
    <option value="1">01</option><option value="2">02</option><option value="5">05</option><option value="12">12</option>
  </select>
  <select id="cc-exp-year" name="cardyear" autocomplete="cc-exp-year">
    <option value="">YYYY</option>
    <option value="2026">2026</option><option value="2027">2027</option><option value="2028">2028</option>
  </select>
  <input id="cc-csc" name="cardcvc" autocomplete="cc-csc" />
  <button type="submit">Pay</button>
</form>
</body></html>`;

// Card form embedded in an <iframe>, mirroring real-world payment dialogs (e.g. Google
// Wallet's "Add a payment method" modal embeds payments.google.com in an iframe). The
// content script only sees fields inside a sub-frame if the manifest's content_scripts
// entry has all_frames: true — this fixture exists to catch a regression there.
const CARD_IFRAME_PAGE = `<!doctype html><html><body>
<h1>Add a payment method</h1>
<iframe src="/card" title="payment form"></iframe>
</body></html>`;

// Every document exposes all three secret destinations so cross-origin leakage is observable.
function autofillFramePage(children = ''): string {
  return `<!doctype html><html><body><h1>Autofill boundary</h1>
<form>
  <input id="username" autocomplete="username" />
  <input id="password" type="password" autocomplete="current-password" />
  <input id="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6" />
</form>
<form>
  <input id="cc-number" autocomplete="cc-number" />
  <input id="cc-name" autocomplete="cc-name" />
  <input id="cc-exp" autocomplete="cc-exp" placeholder="MM/YY" />
  <input id="cc-csc" autocomplete="cc-csc" />
</form>${children}</body></html>`;
}

// Two-step (username -> password) fixture for plan 018's spike (shape "a":
// a plain, full-page GET form navigation from step one to step two).
// The identifier field is type="text" (not "email"): QuickKee's real
// username value ('e2e-user') is not a syntactically valid email, and a
// type="email" field's native HTML5 validation silently blocks form submit
// for non-email values. autocomplete="username" is what makes detect.ts's
// no-password branch recognize this as the login field (matching real
// single-step username pages like AWS's, which use plain text inputs).
const STEP1_PAGE = `<!doctype html><html><body>
<h1>Sign in</h1>
<form method="get" action="/step2">
  <input id="identifier" name="identifier" type="text" autocomplete="username" placeholder="username" />
  <button type="submit">Next</button>
</form>
</body></html>`;

const STEP2_PAGE = `<!doctype html><html><body>
<h1>Enter your password</h1>
<form>
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const CREDENTIAL_LOGIN_PAGE = `<!doctype html><html><body>
<h1>Account login</h1>
<form method="post" action="/credential-landing">
  <input id="username" name="username" autocomplete="username" />
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const CREDENTIAL_SIGNUP_PAGE = `<!doctype html><html><body>
<h1>Create account</h1>
<form method="post" action="/credential-landing">
  <input id="email" name="email" type="email" autocomplete="username" />
  <input id="password" name="password" type="password" autocomplete="new-password" />
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" />
  <button type="submit">Create account</button>
</form>
</body></html>`;

const CREDENTIAL_USERNAME_STEP_PAGE = `<!doctype html><html><body>
<h1>Enter username</h1>
<form method="get" action="/credential-password-step">
  <input id="username" name="username" autocomplete="username" />
  <button type="submit">Next</button>
</form>
</body></html>`;

const CREDENTIAL_PASSWORD_STEP_PAGE = `<!doctype html><html><body>
<h1>Enter password</h1>
<form method="post" action="/credential-landing">
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const PASSWORD_CHANGE_PAGE = `<!doctype html><html><body>
<h1>Change password</h1>
<form method="post" action="/credential-landing">
  <input id="username" name="username" autocomplete="username" />
  <input id="current" name="current" type="password" autocomplete="current-password" />
  <input id="next" name="next" type="password" autocomplete="new-password" />
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" />
  <button type="submit">Change password</button>
</form>
</body></html>`;

const REJECTED_LOGIN_PAGE = `<!doctype html><html><body>
<h1>Account login</h1>
<form id="login">
  <input id="username" name="username" autocomplete="username" />
  <input id="password" name="password" type="password" autocomplete="current-password" />
  <button type="submit">Sign in</button>
</form>
<p id="result"></p>
<script>
  document.getElementById('login').addEventListener('submit', event => {
    event.preventDefault(); document.getElementById('result').textContent = 'Credentials rejected by fixture';
  });
</script>
</body></html>`;

const CREDENTIAL_LANDING_PAGE = '<!doctype html><html><body><h1>Account page</h1></body></html>';

export async function startHttpFixture() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url === '/autofill-frames') {
      const port = (server.address() as AddressInfo).port;
      res.end(autofillFramePage(`<iframe id="matching" title="matching form" src="http://localhost:${port}/autofill-frame"></iframe>
<iframe id="unrelated" title="unrelated form" src="http://127.0.0.1:${port}/autofill-frame"></iframe>`));
    }
    else if (req.url === '/autofill-frame') res.end(autofillFramePage());
    else if (req.url === '/single') res.end(SINGLE_STEP_PAGE);
    else if (req.url === '/otp') res.end(OTP_PAGE);
    else if (req.url === '/totp-qr') res.end(TOTP_QR_PAGE);
    else if (req.url === '/step1') res.end(STEP1_PAGE);
    else if (req.url?.startsWith('/step2')) res.end(STEP2_PAGE);
    else if (req.url === '/card') res.end(CARD_PAGE);
    else if (req.url === '/card-select') res.end(CARD_SELECT_PAGE);
    else if (req.url === '/card-iframe') res.end(CARD_IFRAME_PAGE);
    else if (req.url === '/credential-login') res.end(CREDENTIAL_LOGIN_PAGE);
    else if (req.url === '/credential-signup') res.end(CREDENTIAL_SIGNUP_PAGE);
    else if (req.url === '/credential-multistep') res.end(CREDENTIAL_USERNAME_STEP_PAGE);
    else if (req.url?.startsWith('/credential-password-step')) res.end(CREDENTIAL_PASSWORD_STEP_PAGE);
    else if (req.url === '/credential-password-change') res.end(PASSWORD_CHANGE_PAGE);
    else if (req.url === '/credential-rejected') res.end(REJECTED_LOGIN_PAGE);
    else if (req.url === '/credential-landing') res.end(CREDENTIAL_LANDING_PAGE);
    else res.end(LOGIN_PAGE);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://localhost:${port}/`,
    altUrl: `http://127.0.0.1:${port}/`,
    singleUrl: `http://localhost:${port}/single`,
    otpUrl: `http://localhost:${port}/otp`,
    totpQrUrl: `http://localhost:${port}/totp-qr`,
    step1Url: `http://localhost:${port}/step1`,
    cardUrl: `http://localhost:${port}/card`,
    cardSelectUrl: `http://localhost:${port}/card-select`,
    cardIframeUrl: `http://localhost:${port}/card-iframe`,
    autofillFramesUrl: `http://localhost:${port}/autofill-frames`,
    credentialLoginUrl: `http://localhost:${port}/credential-login`,
    newCredentialLoginUrl: `http://127.0.0.1:${port}/credential-login`,
    credentialSignupUrl: `http://127.0.0.1:${port}/credential-signup`,
    credentialMultistepUrl: `http://127.0.0.1:${port}/credential-multistep`,
    passwordChangeUrl: `http://localhost:${port}/credential-password-change`,
    rejectedCredentialUrl: `http://localhost:${port}/credential-rejected`,
    close: () => { server.closeAllConnections(); return new Promise<void>(r => server.close(() => r())); },
  };
}

export async function startHttpsFixture() {
  const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1 });
  const server = https.createServer({ key: pems.private, cert: pems.cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body><h1>insecure</h1></body></html>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `https://localhost:${port}/`,
    close: () => { server.closeAllConnections(); return new Promise<void>(r => server.close(() => r())); },
  };
}
