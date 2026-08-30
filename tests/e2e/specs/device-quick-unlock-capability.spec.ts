import { test, expect, openExtensionPage, addPrfAuthenticator } from '../helpers';

for (const surface of ['popup', 'panel'] as const) {
  test(`${surface} extension page creates a platform credential and obtains fresh PRF output`, async ({ context, extensionId }) => {
    const page = await openExtensionPage(context, extensionId, `src/pages/${surface}/index.html`);
    await addPrfAuthenticator(page);
    await page.waitForFunction(() => Boolean((window as unknown as { __qkTest?: unknown }).__qkTest));

    const proof = await page.evaluate(async () => {
      const seam = (window as unknown as { __qkTest: {
        createDeviceCredential(): Promise<{ credentialId: string; prfInput: string; prfOutput: Uint8Array }>;
        getDevicePrfOutput(credentialId: string, prfInput: string): Promise<Uint8Array>;
      } }).__qkTest;
      const enrolled = await seam.createDeviceCredential();
      const asserted = await seam.getDevicePrfOutput(enrolled.credentialId, enrolled.prfInput);
      return {
        credentialId: enrolled.credentialId,
        enrolled: Array.from(enrolled.prfOutput),
        asserted: Array.from(asserted),
      };
    });

    expect(proof.credentialId).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(proof.enrolled).toHaveLength(32);
    expect(proof.asserted).toEqual(proof.enrolled);
  });
}
