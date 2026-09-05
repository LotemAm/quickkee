import {
  findLoginFields, fillFields, isLoginField, findCardFields, fillCardFields, isCardField, hasCardFields,
  findOtpFields, fillOtpFields, isOtpField,
} from '../../content/detect';
import { showPopup, hidePopup } from '../../content/inlinePopup';
import { sendToSW } from '../../shared/messages';
import { recordVaultActivity } from '../../shared/vaultActivity';
import { maskCardNumber } from '../../shared/cardMask';
import { CARDHOLDER_NAME_KEY } from '../../shared/entry';
import { extractCredentialCandidate, extractUsernameCandidate, SubmitGestureTracker } from '../../content/credentialCapture';
import { CredentialPrompt } from '../../content/credentialPrompt';

let filling = false;
const credentialPrompt = new CredentialPrompt();
const submitGestures = new SubmitGestureTracker();

function eligibleTopPage(): boolean {
  return window.top === window && (location.protocol === 'http:' || location.protocol === 'https:');
}

async function showPendingCredentialPrompt(): Promise<void> {
  if (!eligibleTopPage() || credentialPrompt.isVisible()) return;
  const response = await sendToSW({ type: 'getPendingCredentialPrompt' });
  if (!response.ok || !response.prompt) return;
  hidePopup();
  credentialPrompt.show(response.prompt, {
    commit: async request => (await sendToSW({ type: 'commitCredentialCapture', ...request })).ok,
    dismiss: async captureId => { await sendToSW({ type: 'dismissCredentialCapture', captureId }); },
  });
}

if (eligibleTopPage()) {
  document.addEventListener('pointerdown', event => submitGestures.record(event), true);
  document.addEventListener('keydown', event => submitGestures.record(event), true);
  document.addEventListener('submit', event => {
    if (filling || !(event.target instanceof HTMLFormElement) || !submitGestures.consume(event.target)) return;
    const candidate = extractCredentialCandidate(event.target);
    if (candidate) {
      void sendToSW({ type: 'stageCredentialCapture', ...candidate }).then(response => {
        if (response.ok && response.staged) setTimeout(() => void showPendingCredentialPrompt(), 300);
      });
      return;
    }
    const username = extractUsernameCandidate(event.target);
    if (username) void sendToSW({ type: 'stageCredentialUsername', username });
  }, true);
  for (const delay of [0, 500, 1_500]) setTimeout(() => void showPendingCredentialPrompt(), delay);
}

function fillAndHide(fields: ReturnType<typeof findLoginFields>, username: string, password: string, totp?: string): void {
  filling = true;
  fillFields(fields, username, password);
  if (totp) fillOtpFields(findOtpFields(document), totp);
  filling = false;
  hidePopup();
}

function fillTotpAndHide(code: string): void {
  const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  filling = true;
  fillOtpFields(findOtpFields(document, active), code);
  filling = false;
  hidePopup();
}

function fillCardAndHide(fields: ReturnType<typeof findCardFields>, values: { number: string; name: string; cvv: string; expires: number | null }): void {
  filling = true;
  fillCardFields(fields, values);
  filling = false;
  hidePopup();
}

interface LoginContext {
  anchor: HTMLInputElement;
  form: HTMLFormElement | null;
  parent: HTMLElement | null;
  fields: ReturnType<typeof findLoginFields>;
}

let loginContext: LoginContext | null = null;

function validLoginContext(context: LoginContext): boolean {
  if (loginContext !== context || context.anchor.form !== context.form ||
      context.anchor.parentElement !== context.parent) return false;
  const current = findLoginFields(document, context.anchor);
  return isLoginField(context.anchor, current) && current.username === context.fields.username &&
    current.password === context.fields.password;
}

function toolbarLoginFields(): ReturnType<typeof findLoginFields> {
  const empty = { username: null, password: null };
  // A remembered destination must still be the original pair; do not retarget a stale anchor.
  if (loginContext) return validLoginContext(loginContext) ? loginContext.fields : empty;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement) {
    const fields = findLoginFields(document, active);
    return isLoginField(active, fields) ? fields : empty;
  }
  return findLoginFields(document);
}

chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string; totp?: string; code?: string; number?: string; cardholderName?: string; cvv?: string; expires?: number | null }) => {
  if (msg.type === 'fill') fillAndHide(toolbarLoginFields(), msg.username ?? '', msg.password ?? '', msg.totp);
  if (msg.type === 'fillTotp') fillTotpAndHide(msg.code ?? '');
  if (msg.type === 'fillCard')
    fillCardAndHide(findCardFields(document), { number: msg.number ?? '', name: msg.cardholderName ?? '', cvv: msg.cvv ?? '', expires: msg.expires ?? null });
});

let hideTimer: ReturnType<typeof setTimeout> | null = null;

document.addEventListener('focusin', ev => {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (filling) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;
  loginContext = null;
  hidePopup();
  if (credentialPrompt.isVisible()) return;

  // Card fields take precedence over login-field detection so a field matching both
  // (e.g. a `type="password"` CVV input) is treated as a card field, not a login one.
  const cardFields = findCardFields(document);
  if (hasCardFields(cardFields) && isCardField(el, cardFields)) {
    void sendToSW({ type: 'getCardEntrySummariesForUrl', url: location.href }).then(res => {
      if (!res.ok || res.summaries.length === 0) return;
      const cardEntries = res.summaries.map(s => ({ ...s, username: maskCardNumber(s.username) }));
      showPopup(el, cardEntries, entry => {
        void recordVaultActivity();
        void sendToSW({ type: 'getEntry', entryId: entry.id }).then(full => {
          if (!full.ok || !full.entry) return;
          const cardholderName = full.entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '';
          fillCardAndHide(cardFields, { number: full.entry.username, name: cardholderName, cvv: full.entry.password, expires: full.entry.expires });
        });
      });
    });
    return;
  }

  const otpFields = findOtpFields(document, el);
  if (isOtpField(el, otpFields)) {
    void sendToSW({ type: 'getEntrySummariesForUrl', url: location.href }).then(res => {
      if (!res.ok) return;
      const totpEntries = res.summaries.filter(summary => !summary.isCard && summary.hasTotp);
      if (totpEntries.length === 0) return;
      showPopup(el, totpEntries, entry => {
        void recordVaultActivity();
        void sendToSW({ type: 'fillTotpRequest', entryId: entry.id });
      });
    });
    return;
  }

  const fields = findLoginFields(document, el);
  if (!isLoginField(el, fields)) return;
  const context: LoginContext = { anchor: el, form: el.form, parent: el.parentElement, fields };
  loginContext = context;
  void sendToSW({ type: 'getEntrySummariesForUrl', url: location.href }).then(res => {
    if (!res.ok || !validLoginContext(context)) return;
    const loginEntries = res.summaries.filter(s => !s.isCard);
    if (loginEntries.length === 0) return;
    showPopup(el, loginEntries, entry => {
      if (!validLoginContext(context)) return;
      void recordVaultActivity();
      void sendToSW({ type: 'getEntry', entryId: entry.id }).then(full => {
        if (full.ok && full.entry && validLoginContext(context)) fillAndHide(fields, full.entry.username, full.entry.password);
      });
    });
  });
});

document.addEventListener('focusout', () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hidePopup(), 150);
});
