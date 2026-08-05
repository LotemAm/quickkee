import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd } from '../helpers';

test('panel and popup entry lists show a credit-card icon only once an entry is marked', async ({ context, extensionId, http }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  const entryRow = panel.getByRole('button', { name: 'Localhost Login' });
  await expect(entryRow).toBeVisible();

  // Before marking: no credit-card icon on the panel row.
  await expect(entryRow.locator('svg.lucide-credit-card')).toHaveCount(0);

  await entryRow.click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();
  await panel.getByLabel('Mark as credit card data').check();
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  // After marking + save: the panel row now shows the credit-card icon.
  await expect(entryRow.locator('svg.lucide-credit-card')).toHaveCount(1);

  // Popup list reflects the same flag.
  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');
  const { id: tabId } = await swCmd(panel, { cmd: 'tabId', url: http.url });
  const cardPopup = await openPopupForTab(context, extensionId, http.url, tabId);
  const cardEntry = cardPopup.locator('.card', { hasText: 'Localhost Login' });
  await expect(cardEntry.locator('svg.lucide-credit-card')).toHaveCount(1);
});
