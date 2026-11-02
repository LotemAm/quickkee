export async function openWelcomeOnInstall({ reason }: chrome.runtime.InstalledDetails): Promise<void> {
  if (reason !== 'install') return;
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/welcome/index.html') });
}
