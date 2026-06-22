import { test, expect, openExtensionPage, installDb, openPopupForTab, swCmd, reReadKdbx, allEntryTitles } from '../helpers';

test('unsaved site: create + save persists and revisit shows the badge', async ({ context, extensionId, http }) => {
  const seed = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(seed);
  await seed.reload();
  await seed.getByPlaceholder('Master password').fill('correct horse');
  await seed.getByRole('button', { name: 'Unlock' }).click();
  await expect(seed.getByPlaceholder('Search…')).toBeVisible();

  // 127.0.0.1 is a non-matching hostname -> no entries -> CreateForm shows.
  const site = await context.newPage();
  await site.goto(http.altUrl);
  const { id: tabId } = await swCmd(seed, { cmd: 'tabId', url: http.altUrl });

  const popup = await openPopupForTab(context, extensionId, http.altUrl, tabId);
  await expect(popup.getByText(`New entry for ${http.altUrl}`)).toBeVisible();
  await popup.getByPlaceholder('Title').fill('My 127 Site');
  await popup.getByPlaceholder('Username').fill('newuser');
  await popup.getByRole('button', { name: 'Create & Save' }).click();

  // Persisted to the .kdbx: re-read and assert the entry exists.
  await expect.poll(async () => allEntryTitles(await reReadKdbx(seed))).toContain('My 127 Site');

  // Revisit: matcher now counts 1 and the badge shows 1 for that tab.
  await expect.poll(async () => (await swCmd(seed, { cmd: 'match', url: http.altUrl, tabId })).count).toBe(1);
});
