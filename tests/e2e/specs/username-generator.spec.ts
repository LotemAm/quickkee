import { test, expect, openExtensionPage, installDb, openPopupForTab, getTabId, reReadKdbx } from '../helpers';
import type { CreateDraft } from '../../../src/shared/createDraft';

test('username defaults, form-only formatting, narrow popup, and draft recovery reach the saved vault', async ({ context, extensionId, http }, testInfo) => {
  const settings = await openExtensionPage(context, extensionId, 'src/pages/options/index.html');
  await settings.getByLabel('Name style').selectOption('alias');
  await settings.getByLabel('Word separator').selectOption('_');
  await settings.getByLabel('Name casing').selectOption('capitalized');
  await settings.getByLabel('Digit suffix').selectOption('2');
  const defaults = { style: 'alias', separator: '_', casing: 'capitalized', digits: 2 };
  await expect.poll(() => settings.evaluate(async () => (await chrome.storage.local.get('nameGeneratorOptions')).nameGeneratorOptions)).toEqual(defaults);
  await settings.reload();
  await expect(settings.getByLabel('Word separator')).toHaveValue('_');
  await expect(settings.getByLabel('Name style')).toHaveValue('alias');

  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();
  const site = await context.newPage();
  await site.goto(http.url);
  const tabId = await getTabId(seed, http.url);
  let popup = await openPopupForTab(context, extensionId, http.url, tabId);
  await popup.setViewportSize({ width: 340, height: 760 });
  await popup.getByRole('button', { name: 'Add entry' }).click();
  await expect(popup.getByRole('button', { name: 'Username options' })).toHaveAttribute('aria-expanded', 'false');
  await popup.getByPlaceholder('Title').fill('Generated Username');
  await popup.getByRole('button', { name: 'Generate username' }).click();
  await expect(popup.getByLabel('Username', { exact: true })).toHaveValue(/^[A-Z][a-z]+_[A-Z][a-z]+\d{2}$/);
  const first = await popup.getByLabel('Username', { exact: true }).inputValue();
  await popup.getByRole('button', { name: 'Username options' }).click();
  await popup.getByLabel('Word separator').selectOption('');
  await expect(popup.getByLabel('Username', { exact: true })).toHaveValue(first);
  await popup.getByRole('button', { name: 'Generate username' }).click();
  const username = await popup.getByLabel('Username', { exact: true }).inputValue();
  expect(username).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
  expect(await popup.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(340);
  for (const label of ['Username', 'Name style', 'Word separator', 'Name casing', 'Digit suffix']) {
    const bounds = await popup.getByLabel(label, { exact: true }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(340);
  }
  await popup.screenshot({ path: testInfo.outputPath('username-options-340px.png'), fullPage: true });
  expect(await popup.evaluate(async () => (await chrome.storage.local.get('nameGeneratorOptions')).nameGeneratorOptions)).toEqual(defaults);
  await expect.poll(() => popup.evaluate(async url => {
    const stored = await chrome.storage.session.get<{ createDraft?: Record<string, CreateDraft> }>('createDraft');
    return stored.createDraft?.[url]?.username;
  }, http.url)).toBe(username);
  await popup.close();

  popup = await openPopupForTab(context, extensionId, http.url, tabId);
  // A recovery draft opens the creation form automatically on the next popup visit.
  await expect(popup.getByLabel('Username', { exact: true })).toHaveValue(username);
  await popup.getByRole('button', { name: 'Username options' }).click();
  await expect(popup.getByLabel('Word separator')).toHaveValue('_');
  await popup.getByRole('button', { name: 'Create & Save' }).click();
  await expect(popup.getByText('Generated Username', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const db = await reReadKdbx(seed);
    const groups = [...db.groups];
    while (groups.length) {
      const group = groups.pop()!;
      for (const entry of group.entries) {
        if (entry.fields.get('Title')?.toString() === 'Generated Username') return entry.fields.get('UserName')?.toString();
      }
      groups.push(...group.groups);
    }
    return null;
  }).toBe(username);
});
