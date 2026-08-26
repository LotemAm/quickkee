import { test, expect, openExtensionPage, openEntryEditorMore, installDb, openPopupForTab, swCmd } from '../helpers';

test('panel: Card Number field is masked by default and reveals via the eye toggle, independently of CVV', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();

  await openEntryEditorMore(panel);
  await panel.getByLabel('Mark as credit card data').check();
  await expect(panel.getByText('Card Number')).toBeVisible();

  const cardRow = panel.locator('div.mb-3', { hasText: 'Card Number' });
  const cvvRow = panel.locator('div.mb-3', { hasText: 'CVV' });
  const cardInput = cardRow.locator('input');
  const cvvInput = cvvRow.locator('input');

  await cardInput.fill('4111111111111111');
  await cvvInput.fill('123');

  // Default state: both masked (native password inputs).
  await expect(cardInput).toHaveAttribute('type', 'password');
  await expect(cvvInput).toHaveAttribute('type', 'password');

  // The Card Number field's reveal toggle uses a label derived from "Card Number", not
  // the hardcoded "Show password"/"Hide password" text.
  const cardReveal = cardRow.getByLabel('Show Card Number');
  await expect(cardReveal).toBeVisible();

  await cardReveal.click();
  await expect(cardInput).toHaveAttribute('type', 'text');
  // Revealing Card Number must not reveal CVV — separate state.
  await expect(cvvInput).toHaveAttribute('type', 'password');

  await cardRow.getByLabel('Hide Card Number').click();
  await expect(cardInput).toHaveAttribute('type', 'password');

  // Card Number field must not expose the Generate-password or Password-rules buttons.
  await expect(cardRow.getByLabel('Generate password')).toHaveCount(0);
  await expect(cardRow.getByLabel('Password rules')).toHaveCount(0);
});

test('panel and popup entry-list rows mask a card number to its last 4 digits', async ({ context, extensionId, http }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  const entryRow = panel.getByRole('button', { name: 'Localhost Login' });
  await entryRow.click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();

  await openEntryEditorMore(panel);
  await panel.getByLabel('Mark as credit card data').check();
  await panel.locator('div.mb-3', { hasText: 'Card Number' }).locator('input').fill('4111111111111111');
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  // Panel list row: masked, not the full card number.
  await expect(entryRow.getByText('•••• 1111')).toBeVisible();
  await expect(entryRow.getByText('4111111111111111')).toHaveCount(0);

  // Popup list row: same masking.
  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');
  const { id: tabId } = await swCmd(panel, { cmd: 'tabId', url: http.url });
  const cardPopup = await openPopupForTab(context, extensionId, http.url, tabId);
  const cardEntry = cardPopup.locator('.card', { hasText: 'Localhost Login' });
  await expect(cardEntry.getByText('•••• 1111')).toBeVisible();
  await expect(cardEntry.getByText('4111111111111111')).toHaveCount(0);

  // Copy-user button still copies the full raw value, not the masked display.
  await cardEntry.getByRole('button', { name: 'Copy user' }).click();
  const clip = await cardPopup.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('4111111111111111');
});
