import { quickUnlockInfo, quickUnlockWarn } from './quickUnlockDebug';

const CEREMONY_TIMEOUT_MS = 60_000;
const RANDOM_BYTES = 32;
const PRF_UNSUPPORTED_CACHE_KEY = 'quickkee.quickUnlock.prfUnsupported.v1';

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
    results?: { first?: BufferSource };
  };
}

interface PublicKeyCredentialCapabilities {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
}

function browserFingerprint(): string {
  return navigator.userAgent || 'unknown-browser';
}

function hasCachedPrfFailure(): boolean {
  try { return localStorage.getItem(PRF_UNSUPPORTED_CACHE_KEY) === browserFingerprint(); }
  catch { return false; }
}

function cachePrfFailure(): void {
  try { localStorage.setItem(PRF_UNSUPPORTED_CACHE_KEY, browserFingerprint()); }
  catch { /* Capability caching must not affect manual unlock. */ }
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
  const publicKeyCredentialAvailable = typeof PublicKeyCredential !== 'undefined';
  const createAvailable = !!navigator.credentials?.create;
  const getAvailable = !!navigator.credentials?.get;
  if (!publicKeyCredentialAvailable || !createAvailable || !getAvailable) {
    quickUnlockInfo('webauthn.capability-check', {
      publicKeyCredentialAvailable,
      createAvailable,
      getAvailable,
      platformAuthenticatorAvailable: false,
    });
    return false;
  }
  if (hasCachedPrfFailure()) {
    quickUnlockInfo('webauthn.capability-check', {
      publicKeyCredentialAvailable,
      createAvailable,
      getAvailable,
      platformAuthenticatorAvailable: null,
      prfClientAvailable: null,
      cachedPrfFailure: true,
    });
    return false;
  }
  try {
    const credentialApi = PublicKeyCredential as typeof PublicKeyCredential & PublicKeyCredentialCapabilities;
    const getClientCapabilities = credentialApi.getClientCapabilities?.bind(credentialApi);
    const [platformAuthenticatorAvailable, capabilities] = await Promise.all([
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      getClientCapabilities?.(),
    ]);
    const prfClientAvailable = capabilities ? capabilities['extension:prf'] === true : null;
    quickUnlockInfo('webauthn.capability-check', {
      publicKeyCredentialAvailable,
      createAvailable,
      getAvailable,
      platformAuthenticatorAvailable,
      prfClientAvailable,
      userAgent: navigator.userAgent,
    });
    return platformAuthenticatorAvailable && prfClientAvailable !== false;
  } catch (error) {
    quickUnlockWarn('webauthn.capability-check-failed', error);
    return false;
  }
}

function extensionResults(credential: PublicKeyCredential): PrfClientOutputs {
  return credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfClientOutputs;
}

function prfMetadata(credential: PublicKeyCredential): {
  prfExtensionPresent: boolean;
  prfEnabled: boolean | null;
  prfResultPresent: boolean;
  prfResultType: string;
  prfResultBytes: number | null;
} {
  const prf = extensionResults(credential).prf;
  const first = prf?.results?.first;
  return {
    prfExtensionPresent: prf !== undefined,
    prfEnabled: typeof prf?.enabled === 'boolean' ? prf.enabled : null,
    prfResultPresent: first !== undefined,
    prfResultType: first instanceof ArrayBuffer
      ? 'ArrayBuffer'
      : ArrayBuffer.isView(first) ? first.constructor.name : first === undefined ? 'missing' : typeof first,
    prfResultBytes: first instanceof ArrayBuffer || ArrayBuffer.isView(first) ? first.byteLength : null,
  };
}

function requirePrfOutput(credential: PublicKeyCredential, ceremony: 'registration' | 'assertion'): Uint8Array {
  const first = extensionResults(credential).prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength !== RANDOM_BYTES) {
    quickUnlockWarn(`webauthn.${ceremony}-prf-invalid`, undefined, prfMetadata(credential));
    throw new DeviceQuickUnlockError('prfUnsupported');
  }
  return new Uint8Array(first.slice(0));
}

async function runCeremony<T>(operation: 'create' | 'get', options: CredentialCreationOptions | CredentialRequestOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, CEREMONY_TIMEOUT_MS);
  quickUnlockInfo(`webauthn.${operation}-started`);
  try {
    const result = operation === 'create'
      ? await navigator.credentials.create({ ...(options as CredentialCreationOptions), signal: controller.signal })
      : await navigator.credentials.get({ ...(options as CredentialRequestOptions), signal: controller.signal });
    if (!result) throw new DeviceQuickUnlockError(operation === 'get' ? 'unknownCredential' : 'failed');
    quickUnlockInfo(`webauthn.${operation}-completed`);
    return result as T;
  } catch (error) {
    let mapped: DeviceQuickUnlockError;
    if (error instanceof DeviceQuickUnlockError) mapped = error;
    else if (timedOut) mapped = new DeviceQuickUnlockError('timedOut');
    else {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'AbortError' || name === 'NotAllowedError') mapped = new DeviceQuickUnlockError('cancelled');
      else if (name === 'NotSupportedError' || name === 'SecurityError')
        mapped = new DeviceQuickUnlockError('authenticatorUnavailable');
      else if (operation === 'get' && name === 'InvalidStateError') mapped = new DeviceQuickUnlockError('unknownCredential');
      else mapped = new DeviceQuickUnlockError('failed');
    }
    quickUnlockWarn(`webauthn.${operation}-failed`, error, { mappedCode: mapped.code });
    throw mapped;
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
  quickUnlockInfo('webauthn.assertion-received', prfMetadata(assertion));
  return requirePrfOutput(assertion, 'assertion');
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
  quickUnlockInfo('webauthn.credential-created', {
    authenticatorAttachment: credential.authenticatorAttachment ?? 'unknown',
    ...prfMetadata(credential),
  });
  if (outputs?.enabled !== true) {
    cachePrfFailure();
    quickUnlockWarn('webauthn.registration-prf-unsupported', undefined, prfMetadata(credential));
    throw new DeviceQuickUnlockError('prfUnsupported');
  }
  if (!outputs.results?.first) quickUnlockInfo('webauthn.registration-prf-fallback-started');
  const output = outputs.results?.first
    ? requirePrfOutput(credential, 'registration')
    : await requestPrf(credentialId, rawId, prfInput);
  quickUnlockInfo('webauthn.enrollment-proof-ready', { prfResultBytes: output.byteLength });
  return { credentialId, prfInput: bytesToBase64Url(prfInput), prfOutput: output };
}

export async function getDevicePrfOutput(credentialId: string, prfInput: string): Promise<Uint8Array> {
  if (!(await isDeviceQuickUnlockAvailable())) throw new DeviceQuickUnlockError('authenticatorUnavailable');
  const rawId = base64UrlToBytes(credentialId);
  const input = base64UrlToBytes(prfInput);
  if (rawId.byteLength === 0 || input.byteLength !== RANDOM_BYTES) throw new DeviceQuickUnlockError('invalidData');
  return requestPrf(credentialId, rawId, input);
}
