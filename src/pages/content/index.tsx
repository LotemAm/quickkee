import { findLoginFields, fillFields } from '../../content/detect';
chrome.runtime.onMessage.addListener((msg: { type: string; username?: string; password?: string }) => {
  if (msg.type === 'fill') fillFields(findLoginFields(document), msg.username ?? '', msg.password ?? '');
});
