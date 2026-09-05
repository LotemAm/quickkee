import { test, expect, openExtensionPage, openEntryEditorMore, installDb, openPopupForTab, getTabId } from '../helpers';

test('panel and popup entry lists show a credit-card icon only once an entry is marked', async ({ context, extensionId, http }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  const entryRow = panel.getByRole('button', { name: 'Localhost Login' });
  await expect(entryRow).toBeVisible();

  // Before marking: no credit-card icon on the panel row.
  await expect(entryRow.locator('svg.lucide-credit-card')).toHaveCount(0);

  await entryRow.click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();
  await openEntryEditorMore(panel);
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
  const tabId = await getTabId(panel, http.url);
  const cardPopup = await openPopupForTab(context, extensionId, http.url, tabId);
  const cardEntry = cardPopup.locator('.card', { hasText: 'Localhost Login' });
  await expect(cardEntry.locator('svg.lucide-credit-card')).toHaveCount(1);

  // Regression check for the flexbox-truncation footgun: the title row is now a flex
  // container (to sit the icon next to the title), and a flex item's automatic minimum
  // size defaults to its unshrunk content width unless `min-width: 0` is set. Confirmed by
  // direct measurement that in this codebase the title span's own `overflow: hidden` (from
  // `truncate`) happens to keep it visually shrinking either way in Chromium — the CSS
  // spec gives non-`visible`-overflow flex items an automatic minimum size of 0 even
  // without an explicit `min-w-0`. So the robust, browser-independent check is the
  // computed style itself, which is what `min-w-0` actually controls.
  const longTitle = 'A Rather Long Credit Card Entry Title That Should Truncate Instead Of Overflowing The Popup Row';
  await panel.locator('div.mb-3', { hasText: 'Title' }).locator('input').fill(longTitle);
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  const longPopup = await openPopupForTab(context, extensionId, http.url, tabId);
  const longEntry = longPopup.locator('.card', { hasText: 'A Rather Long Credit Card Entry' });
  await expect(longEntry).toBeVisible();
  const titleSpan = longEntry.locator('.font-medium.truncate > span.truncate');
  await expect(titleSpan).toHaveCount(1);
  await expect(titleSpan).toHaveCSS('min-width', '0px');

  // The title row still fits inside the popup's fixed-width card, and the title text is
  // long enough that it visually overflows its own box (the ellipsis is doing real work).
  const [rowWidth, rowScrollWidth] = await longEntry.evaluate(el => [el.clientWidth, el.scrollWidth]);
  expect(rowScrollWidth).toBeLessThanOrEqual(rowWidth + 1);
  const [spanClientWidth, spanScrollWidth] = await titleSpan.evaluate(el => [el.clientWidth, el.scrollWidth]);
  expect(spanScrollWidth).toBeGreaterThan(spanClientWidth);

  // Minor: the credit-card icon must not itself get compressed in the same flex row.
  const icon = longEntry.locator('.font-medium.truncate svg.lucide-credit-card');
  await expect(icon).toHaveCSS('flex-shrink', '0');
});
