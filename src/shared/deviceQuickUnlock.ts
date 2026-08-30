const CEREMONY_TIMEOUT_MS = 60_000;
const RANDOM_BYTES = 32;

export type DeviceQuickUnlockErrorCode =
  | 'cancelled'
  | 'timedOut'
  | 'authenticatorUnavailable'
  | 'prfUnsupported'
  | 'unknownCredential'
  | 'invalidData'
  | 'failed';

export class DeviceQuickUnlockError extends Error {
  constructor(readonly code: DeviceQuickUnlockErrorCode, message = code) {
    super(message);
    this.name = 'DeviceQuickUnlockError';
  }
}

export interface NewDeviceCredential {
  credentialId: string;
  prfInput: string;
  prfOutput: Uint8Array;
}

interface PrfClientInputs {
  prf: {
    eval?: { first: BufferSource };
    evalByCredential?: Record<string, { first: BufferSource }>;
  };
}

interface PrfClientOutputs {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer };
  };
}

function randomBytes(length = RANDOM_BYTES): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new DeviceQuickUnlockError('invalidData');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // Reject encodings that atob accepted non-canonically.
    if (bytesToBase64Url(bytes) !== value) throw new DeviceQuickUnlockError('invalidData');
    return bytes;
  } catch (error) {
    if (error instanceof DeviceQuickUnlockError) throw error;
    throw new DeviceQuickUnlockError('invalidData');
  }
}

export async function isDeviceQuickUnlockAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials?.create || !navigator.credentials?.get)
    return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

function extensionResults(credential: PublicKeyCredential): PrfClientOutputs {
  return credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfClientOutputs;
}

function requirePrfOutput(credential: PublicKeyCredential): Uint8Array {
  const first = extensionResults(credential).prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength !== RANDOM_BYTES)
    throw new DeviceQuickUnlockError('prfUnsupported');
  return new Uint8Array(first.slice(0));
}

async function runCeremony<T>(operation: 'create' | 'get', options: CredentialCreationOptions | CredentialRequestOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, CEREMONY_TIMEOUT_MS);
  try {
    const result = operation === 'create'
      ? await navigator.credentials.create({ ...(options as CredentialCreationOptions), signal: controller.signal })
      : await navigator.credentials.get({ ...(options as CredentialRequestOptions), signal: controller.signal });
    if (!result) throw new DeviceQuickUnlockError(operation === 'get' ? 'unknownCredential' : 'failed');
    return result as T;
  } catch (error) {
    if (error instanceof DeviceQuickUnlockError) throw error;
    if (timedOut) throw new DeviceQuickUnlockError('timedOut');
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'AbortError' || name === 'NotAllowedError') throw new DeviceQuickUnlockError('cancelled');
    if (name === 'NotSupportedError' || name === 'SecurityError')
      throw new DeviceQuickUnlockError('authenticatorUnavailable');
    if (operation === 'get' && name === 'InvalidStateError') throw new DeviceQuickUnlockError('unknownCredential');
    throw new DeviceQuickUnlockError('failed');
  } finally { clearTimeout(timeout); }
}

async function requestPrf(credentialId: string, rawId: Uint8Array, prfInput: Uint8Array): Promise<Uint8Array> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: randomBytes(),
    allowCredentials: [{ type: 'public-key', id: rawId }],
    userVerification: 'required',
    timeout: CEREMONY_TIMEOUT_MS,
    extensions: {
      prf: { evalByCredential: { [credentialId]: { first: prfInput } } },
    } as AuthenticationExtensionsClientInputs & PrfClientInputs,
  };
  const assertion = await runCeremony<PublicKeyCredential>('get', { publicKey });
  return requirePrfOutput(assertion);
}

/**
 * Creates an extension-origin credential and proves that its authenticator emits
 * a usable PRF result. RP ID fields are deliberately absent so Chromium isolates
 * the credential to the chrome-extension:// origin.
 */
export async function createDeviceCredential(): Promise<NewDeviceCredential> {
  if (!(await isDeviceQuickUnlockAvailable())) throw new DeviceQuickUnlockError('authenticatorUnavailable');
  const prfInput = randomBytes();
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: randomBytes(),
    rp: { name: 'QuickKee' },
    user: {
      id: randomBytes(),
      name: 'QuickKee device quick unlock',
      displayName: 'QuickKee device quick unlock',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'discouraged',
      userVerification: 'required',
    },
    attestation: 'none',
    timeout: CEREMONY_TIMEOUT_MS,
    extensions: { prf: { eval: { first: prfInput } } } as AuthenticationExtensionsClientInputs & PrfClientInputs,
  };

  const credential = await runCeremony<PublicKeyCredential>('create', { publicKey });
  const rawId = new Uint8Array(credential.rawId.slice(0));
  const credentialId = bytesToBase64Url(rawId);
  const outputs = extensionResults(credential).prf;
  if (outputs?.enabled !== true) throw new DeviceQuickUnlockError('prfUnsupported');
  const output = outputs.results?.first
    ? requirePrfOutput(credential)
    : await requestPrf(credentialId, rawId, prfInput);
  return { credentialId, prfInput: bytesToBase64Url(prfInput), prfOutput: output };
}

export async function getDevicePrfOutput(credentialId: string, prfInput: string): Promise<Uint8Array> {
  if (!(await isDeviceQuickUnlockAvailable())) throw new DeviceQuickUnlockError('authenticatorUnavailable');
  const rawId = base64UrlToBytes(credentialId);
  const input = base64UrlToBytes(prfInput);
  if (rawId.byteLength === 0 || input.byteLength !== RANDOM_BYTES) throw new DeviceQuickUnlockError('invalidData');
  return requestPrf(credentialId, rawId, input);
}
