import { findLoginFields, fillFields, isLoginField } from '../../content/detect';
import { showPopup, hidePopup } from '../../content/inlinePopup';
import { sendToSW } from '../../shared/messages';

let filling = false;

function fillAndHide(fields: ReturnType<typeof findLoginFields>, username: string, password: string): void {
  filling = true;
  fillFields(fields, username, password);
  filling = false;
  hidePopup();
}

chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string }) => {
  if (msg.type === 'fill') fillAndHide(findLoginFields(document), msg.username ?? '', msg.password ?? '');
});

let hideTimer: ReturnType<typeof setTimeout> | null = null;

document.addEventListener('focusin', ev => {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (filling) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;
  const fields = findLoginFields(document);
  if (!isLoginField(el, fields)) return;
  void sendToSW({ type: 'getEntriesForUrl', url: location.href }).then(res => {
    if (!('entries' in res) || res.entries.length === 0) return;
    showPopup(el, res.entries, entry => {
      void sendToSW({ type: 'getEntry', entryId: entry.id }).then(full => {
        if ('entry' in full && full.entry) fillAndHide(fields, full.entry.username, full.entry.password);
      });
    });
  });
});

document.addEventListener('focusout', () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hidePopup(), 150);
});
