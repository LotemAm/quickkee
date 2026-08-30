// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DeviceQuickUnlockError,
  base64UrlToBytes,
  bytesToBase64Url,
  createDeviceCredential,
  getDevicePrfOutput,
} from './deviceQuickUnlock';

function credential(rawId: Uint8Array, extensions: AuthenticationExtensionsClientOutputs): PublicKeyCredential {
  return {
    id: bytesToBase64Url(rawId),
    rawId: rawId.buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {} as AuthenticatorResponse,
    getClientExtensionResults: () => extensions,
    toJSON: () => ({}),
  } as PublicKeyCredential;
}

describe('base64url', () => {
  test('round trips arbitrary bytes without padding', () => {
    const input = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encoded = bytesToBase64Url(input);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(encoded)).toEqual(input);
  });

  test('rejects malformed input', () => {
    expect(() => base64UrlToBytes('not+base64')).toThrow(DeviceQuickUnlockError);
  });
});

describe('WebAuthn PRF adapter', () => {
  const create = vi.fn();
  const get = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { credentials: { create, get } });
    vi.stubGlobal('PublicKeyCredential', class {
      static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(async () => true);
    });
  });

  test('creates an extension-origin platform credential without an RP ID', async () => {
    const rawId = new Uint8Array([9, 8, 7]);
    const prfOutput = new Uint8Array(32).fill(4);
    create.mockResolvedValue(credential(rawId, {
      prf: { enabled: true, results: { first: prfOutput.buffer } },
    } as AuthenticationExtensionsClientOutputs));

    const result = await createDeviceCredential();

    const options = create.mock.calls[0][0].publicKey as PublicKeyCredentialCreationOptions;
    expect(options.rp).not.toHaveProperty('id');
    expect(options.authenticatorSelection).toMatchObject({
      authenticatorAttachment: 'platform',
      userVerification: 'required',
    });
    expect(options.attestation).toBe('none');
    expect(options.challenge).toBeInstanceOf(Uint8Array);
    expect(result).toEqual({
      credentialId: bytesToBase64Url(rawId),
      prfInput: expect.any(String),
      prfOutput,
    });
  });

  test('falls back to an assertion when create reports PRF support without output', async () => {
    const rawId = new Uint8Array([3, 2, 1]);
    const prfOutput = new Uint8Array(32).fill(6);
    create.mockResolvedValue(credential(rawId, { prf: { enabled: true } } as AuthenticationExtensionsClientOutputs));
    get.mockResolvedValue(credential(rawId, {
      prf: { results: { first: prfOutput.buffer } },
    } as AuthenticationExtensionsClientOutputs));

    const result = await createDeviceCredential();

    expect(result.prfOutput).toEqual(prfOutput);
    const options = get.mock.calls[0][0].publicKey as PublicKeyCredentialRequestOptions;
    expect(options).not.toHaveProperty('rpId');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials).toEqual([{ type: 'public-key', id: rawId }]);
  });

  test('gets a fresh assertion output for the enrolled credential', async () => {
    const rawId = new Uint8Array([1, 4, 1, 4]);
    const input = new Uint8Array(32).fill(2);
    const output = new Uint8Array(32).fill(8);
    get.mockResolvedValue(credential(rawId, {
      prf: { results: { first: output.buffer } },
    } as AuthenticationExtensionsClientOutputs));

    await expect(getDevicePrfOutput(bytesToBase64Url(rawId), bytesToBase64Url(input))).resolves.toEqual(output);

    const options = get.mock.calls[0][0].publicKey as PublicKeyCredentialRequestOptions;
    const prf = (options.extensions as AuthenticationExtensionsClientInputs & {
      prf: { evalByCredential: Record<string, { first: Uint8Array }> };
    }).prf;
    expect(prf.evalByCredential[bytesToBase64Url(rawId)].first).toEqual(input);
  });

  test('rejects missing or malformed PRF output', async () => {
    const rawId = new Uint8Array([5]);
    get.mockResolvedValue(credential(rawId, { prf: { results: {} } } as AuthenticationExtensionsClientOutputs));
    await expect(getDevicePrfOutput(bytesToBase64Url(rawId), bytesToBase64Url(new Uint8Array(32))))
      .rejects.toMatchObject({ code: 'prfUnsupported' });
  });
});
