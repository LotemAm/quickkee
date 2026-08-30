import { parseTotpInput, type TotpConfig } from '../../background/totp';
import { decodeQrDataUrl } from '../../shared/decodeQrImage';

export const UNSUPPORTED_PAGE_MESSAGE = 'Scan page QR is available only on HTTP(S) pages.';
export const NO_QR_MESSAGE = 'No readable QR code found. Make sure the code is visible, then try again.';

interface ActiveTab {
  id?: number;
  windowId?: number;
  url?: string;
}

interface ScanDependencies {
  queryActiveTab: () => Promise<ActiveTab | undefined>;
  captureVisibleTab: (windowId: number, options: { format: 'png' }) => Promise<string>;
  decodeQrDataUrl: (dataUrl: string) => Promise<string>;
}

const defaultDependencies: ScanDependencies = {
  queryActiveTab: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0],
  captureVisibleTab: (windowId, options) => chrome.tabs.captureVisibleTab(windowId, options),
  decodeQrDataUrl,
};

export interface ScannedPageTotp {
  tabId: number;
  pageUrl: string;
  config: TotpConfig;
}

export function isScannablePageUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function classifyTotpPayload(payload: string): TotpConfig {
  const value = payload.trim();
  if (value.toLowerCase().startsWith('otpauth-migration:')) {
    throw new Error('Use Import from Google Authenticator in the side panel for migration QR codes.');
  }

  let uri: URL;
  try { uri = new URL(value); }
  catch { throw new Error('This QR code is not an authenticator setup code.'); }
  if (uri.protocol.toLowerCase() !== 'otpauth:') {
    throw new Error('This QR code is not an authenticator setup code.');
  }
  if (uri.hostname.toLowerCase() === 'hotp') {
    throw new Error('Counter-based HOTP codes are not supported.');
  }
  if (uri.hostname.toLowerCase() !== 'totp') {
    throw new Error('This QR code is not an authenticator setup code.');
  }
  return parseTotpInput(value);
}

export async function scanVisibleTabForTotp(dependencies: ScanDependencies = defaultDependencies): Promise<ScannedPageTotp> {
  const tab = await dependencies.queryActiveTab();
  if (tab?.id == null || tab.windowId == null || !isScannablePageUrl(tab.url)) {
    throw new Error(UNSUPPORTED_PAGE_MESSAGE);
  }

  let screenshot: string | null = null;
  let payload: string | null = null;
  try {
    try {
      screenshot = await dependencies.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch {
      throw new Error('Could not capture the visible page. Try again.');
    }
    try {
      payload = await dependencies.decodeQrDataUrl(screenshot);
    } catch {
      throw new Error(NO_QR_MESSAGE);
    }
    return { tabId: tab.id, pageUrl: tab.url!, config: classifyTotpPayload(payload) };
  } finally {
    payload = null;
    screenshot = null;
  }
}
