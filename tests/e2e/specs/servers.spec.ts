import https from 'node:https';
import { TLSSocket, checkServerIdentity, type PeerCertificate } from 'node:tls';
import { test, expect } from '../helpers';

function requestHttpsFixture(url: string, rejectUnauthorized = true): Promise<{
  status: number | undefined;
  body: string;
  certificate: PeerCertificate;
}> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized, agent: false }, response => {
      response.on('error', reject);
      const socket = response.socket;
      if (!(socket instanceof TLSSocket)) {
        response.destroy(new Error('HTTPS fixture did not establish a TLS socket'));
        return;
      }
      const certificate = socket.getPeerCertificate();
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, certificate }));
    });
    const timeout = setTimeout(() => request.destroy(new Error('HTTPS fixture request timed out')), 5000);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject);
  });
}

test('http fixture serves a login form on localhost and 127.0.0.1', async ({ context, http }) => {
  const page = await context.newPage();
  await page.goto(http.url);
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await page.goto(http.altUrl);
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('https fixture completes TLS with valid localhost and 127.0.0.1 SANs', async ({ https }) => {
  // Permit this fixture's self-signed certificate only for inspecting its TLS response.
  for (const hostname of ['localhost', '127.0.0.1']) {
    const url = new URL(https.url);
    url.hostname = hostname;
    const { status, body, certificate } = await requestHttpsFixture(url.href, false);
    expect(status).toBe(200);
    expect(body).toContain('<h1>insecure</h1>');
    expect(certificate.subject.CN).toBe('localhost');
    expect(certificate.subjectaltname).toBe('DNS:localhost, IP Address:127.0.0.1');
    expect(checkServerIdentity(hostname, certificate)).toBeUndefined();
    expect(Date.parse(certificate.valid_from)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(certificate.valid_to)).toBeGreaterThan(Date.now());
  }
});

test('https fixture is rejected under default certificate trust', async ({ https }) => {
  await expect(requestHttpsFixture(https.url)).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
});
