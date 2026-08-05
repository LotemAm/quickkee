import http from 'node:http';
import https from 'node:https';
import selfsigned from 'selfsigned';
import type { AddressInfo } from 'node:net';

const LOGIN_PAGE = `<!doctype html><html><body>
<h1>Login</h1>
<form>
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

// Standard-autocomplete-tagged card form fixture (plan: card-form autofill). Only the
// autocomplete tokens matter to detect.ts's findCardFields — ids/names are incidental.
const CARD_PAGE = `<!doctype html><html><body>
<h1>Payment</h1>
<form>
  <input id="cc-number" name="cardnumber" autocomplete="cc-number" />
  <input id="cc-name" name="cardname" autocomplete="cc-name" />
  <input id="cc-exp" name="cardexpiry" autocomplete="cc-exp" placeholder="MM/YY" />
  <input id="cc-csc" name="cardcvc" autocomplete="cc-csc" />
  <button type="submit">Pay</button>
</form>
</body></html>`;

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

export async function startHttpFixture() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url === '/single') res.end(SINGLE_STEP_PAGE);
    else if (req.url === '/step1') res.end(STEP1_PAGE);
    else if (req.url?.startsWith('/step2')) res.end(STEP2_PAGE);
    else if (req.url === '/card') res.end(CARD_PAGE);
    else res.end(LOGIN_PAGE);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://localhost:${port}/`,
    altUrl: `http://127.0.0.1:${port}/`,
    singleUrl: `http://localhost:${port}/single`,
    step1Url: `http://localhost:${port}/step1`,
    cardUrl: `http://localhost:${port}/card`,
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
