import { findLoginFields, fillFields, isLoginField, findCardFields, fillCardFields, isCardField, hasCardFields } from '../../content/detect';
import { showPopup, hidePopup } from '../../content/inlinePopup';
import { sendToSW } from '../../shared/messages';
import { maskCardNumber } from '../../shared/cardMask';
import { CARDHOLDER_NAME_KEY } from '../../shared/entry';

let filling = false;

function fillAndHide(fields: ReturnType<typeof findLoginFields>, username: string, password: string): void {
  filling = true;
  fillFields(fields, username, password);
  filling = false;
  hidePopup();
}

function fillCardAndHide(fields: ReturnType<typeof findCardFields>, values: { number: string; name: string; cvv: string; expires: number | null }): void {
  filling = true;
  fillCardFields(fields, values);
  filling = false;
  hidePopup();
}

chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string; number?: string; cardholderName?: string; cvv?: string; expires?: number | null }) => {
  if (msg.type === 'fill') fillAndHide(findLoginFields(document), msg.username ?? '', msg.password ?? '');
  if (msg.type === 'fillCard')
    fillCardAndHide(findCardFields(document), { number: msg.number ?? '', name: msg.cardholderName ?? '', cvv: msg.cvv ?? '', expires: msg.expires ?? null });
});

let hideTimer: ReturnType<typeof setTimeout> | null = null;

document.addEventListener('focusin', ev => {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (filling) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;

  // Card fields take precedence over login-field detection so a field matching both
  // (e.g. a `type="password"` CVV input) is treated as a card field, not a login one.
  const cardFields = findCardFields(document);
  if (hasCardFields(cardFields) && isCardField(el, cardFields)) {
    void sendToSW({ type: 'getEntrySummariesForUrl', url: location.href }).then(res => {
      if (!res.ok) return;
      const cardEntries = res.summaries.filter(s => s.isCard).map(s => ({ ...s, username: maskCardNumber(s.username) }));
      if (cardEntries.length === 0) return;
      showPopup(el, cardEntries, entry => {
        void sendToSW({ type: 'getEntry', entryId: entry.id }).then(full => {
          if (!full.ok || !full.entry) return;
          const cardholderName = full.entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '';
          fillCardAndHide(cardFields, { number: full.entry.username, name: cardholderName, cvv: full.entry.password, expires: full.entry.expires });
        });
      });
    });
    return;
  }

  const fields = findLoginFields(document);
  if (!isLoginField(el, fields)) return;
  void sendToSW({ type: 'getEntrySummariesForUrl', url: location.href }).then(res => {
    if (!res.ok) return;
    const loginEntries = res.summaries.filter(s => !s.isCard);
    if (loginEntries.length === 0) return;
    showPopup(el, loginEntries, entry => {
      void sendToSW({ type: 'getEntry', entryId: entry.id }).then(full => {
        if (full.ok && full.entry) fillAndHide(fields, full.entry.username, full.entry.password);
      });
    });
  });
});

document.addEventListener('focusout', () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hidePopup(), 150);
});
