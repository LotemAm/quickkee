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

export async function startHttpFixture() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(LOGIN_PAGE);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://localhost:${port}/`,
    altUrl: `http://127.0.0.1:${port}/`,
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
