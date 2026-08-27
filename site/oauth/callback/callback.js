/* global chrome, document, history, location, URLSearchParams */

const extensionId = 'jngjnmfmodbiogpcadigjcflkbkhfnfb';
const messageType = 'quickkee-google-oauth-callback';
const params = new URLSearchParams(location.hash.slice(1));
const status = document.querySelector('#status');

const expiresIn = Number(params.get('expires_in'));
const message = {
  type: messageType,
  state: params.get('state'),
  accessToken: params.get('access_token'),
  expiresIn,
  error: params.get('error'),
};

// OAuth tokens arrive in the fragment. Remove it before doing any other work so
// it is not retained in history or exposed by a copied URL.
history.replaceState(null, '', location.pathname);

function fail() {
  status.textContent = 'QuickKee could not complete sign-in. Return to the extension and try again.';
  document.body.classList.add('error');
}

if (!message.state || (!message.accessToken && !message.error) || !globalThis.chrome?.runtime?.sendMessage) {
  fail();
} else {
  chrome.runtime.sendMessage(extensionId, message, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      fail();
      return;
    }
    status.textContent = 'Google Drive is connected. You may close this tab.';
    document.body.classList.add('success');
  });
}
