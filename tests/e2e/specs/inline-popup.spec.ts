import {
  test, expect, openExtensionPage, installDb, closedInlinePopupText,
  clickClosedInlineEntry, attemptSyntheticInlineSelection,
} from '../helpers';

test('inline popup: focus login field shows credential picker and fills on select', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.url);
  await site.waitForLoadState('load');

  await site.locator('#username').click();
  const host = site.locator('[data-quickkee-popup]');
  await expect(host).toBeVisible();
  expect(await host.evaluate(element => element.shadowRoot)).toBeNull();
  await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
  await site.locator('#password').evaluate(element => {
    element.dataset.fillCount = '0';
    element.addEventListener('input', () => { element.dataset.fillCount = String(Number(element.dataset.fillCount) + 1); });
  });

  await attemptSyntheticInlineSelection(site);
  await site.waitForTimeout(300);
  await expect(site.locator('#username')).toHaveValue('');
  await expect(site.locator('#password')).toHaveValue('');
  await expect(site.locator('#password')).toHaveAttribute('data-fill-count', '0');
  await expect(host).toBeVisible();
  await clickClosedInlineEntry(site, 'Localhost Login');

  await expect(site.locator('#username')).toHaveValue('e2e-user');
  await expect(site.locator('#password')).toHaveValue('e2e-pass');
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
  await attemptSyntheticInlineSelection(site);
  await site.waitForTimeout(300);
  await expect(site.locator('#password')).toHaveAttribute('data-fill-count', '1');
});

test('inline popup: genuine keyboard navigation, Escape, and selection work after reopening', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  const site = await context.newPage();
  await site.goto(http.singleUrl);
  await site.waitForLoadState('load');

  await site.locator('#email').click();
  await expect.poll(() => closedInlinePopupText(site)).toContain('Localhost Login');
  await site.keyboard.press('Escape');
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
  await expect(site.locator('#email')).toBeFocused();
  await expect(site.locator('#email')).toHaveValue('');
  await site.locator('h1').click();
  await site.locator('#email').click();
  await expect(site.locator('[data-quickkee-popup]')).toBeVisible();
  await site.keyboard.press('ArrowDown');
  await site.keyboard.press('ArrowUp');
  await site.keyboard.press('Enter');

  await expect(site.locator('#email')).toHaveValue('e2e-user');
  await expect(site.locator('[data-quickkee-popup]')).toBeHidden();
});
