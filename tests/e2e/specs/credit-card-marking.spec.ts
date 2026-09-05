import { test, expect, openExtensionPage, openEntryEditorMore, installDb, reReadKdbx } from '../helpers';
import kdbxweb from 'kdbxweb';

function findEntry(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const stack = [...db.groups];
  while (stack.length) {
    const g = stack.pop()!;
    for (const e of g.entries) if (e.fields.get('Title')?.toString() === title) return e;
    stack.push(...g.groups);
  }
}

test('panel: switch entry type, save, and verify persisted fields', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();

  // Not marked yet: normal labels, URL visible, rules button visible.
  await expect(panel.getByText('Username')).toBeVisible();
  await expect(panel.getByText('URL')).toBeVisible();
  await expect(panel.getByLabel('Password rules')).toBeVisible();

  const entryType = panel.getByRole('group', { name: 'Entry type' });
  await expect(entryType.getByRole('button', { name: 'Login', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await entryType.getByRole('button', { name: 'Credit card', exact: true }).click();
  await expect(entryType.getByRole('button', { name: 'Credit card', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(entryType.getByRole('button', { name: 'Login', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await openEntryEditorMore(panel);
  await expect(panel.getByLabel('Mark as credit card data')).toHaveCount(0);

  // Relabeled; URL and the password-rules button are hidden; Cardholder Name appears.
  await expect(panel.getByText('Card Number')).toBeVisible();
  await expect(panel.getByText('CVV')).toBeVisible();
  await expect(panel.getByText('Card Expiry')).toBeVisible();
  await expect(panel.getByText('URL')).not.toBeVisible();
  await expect(panel.getByLabel('Password rules')).not.toBeVisible();

  await panel.locator('div.mb-3', { hasText: 'Card Number' }).locator('input').fill('4111111111111111');
  await panel.locator('div.mb-3', { hasText: 'CVV' }).locator('input').fill('123');
  await panel.getByLabel('Cardholder Name').fill('Jane Doe');

  await panel.getByRole('button', { name: 'Apply changes' }).click();
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toContainText('Save *');
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  await expect.poll(async () => {
    const db = await reReadKdbx(panel);
    const un = findEntry(db, 'Localhost Login')!.fields.get('UserName');
    return un instanceof kdbxweb.ProtectedValue ? un.getText() : un?.toString();
  }).toBe('4111111111111111');

  const db = await reReadKdbx(panel);
  const e = findEntry(db, 'Localhost Login')!;
  const pw = e.fields.get('Password');
  expect(pw instanceof kdbxweb.ProtectedValue ? pw.getText() : pw?.toString()).toBe('123');
  expect(e.fields.get('QK-IsCard')?.toString()).toBe('1');
  expect(e.fields.get('Cardholder Name')?.toString()).toBe('Jane Doe');

  // Reopening the entry restores its saved view.
  await panel.getByRole('button', { name: 'Close details' }).click();
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  await expect(entryType.getByRole('button', { name: 'Credit card', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Unmark: labels revert; the underlying Cardholder Name field is left untouched.
  await entryType.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(entryType.getByRole('button', { name: 'Login', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText('Username')).toBeVisible();
  await expect(panel.getByText('URL')).toBeVisible();
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  const db2 = await reReadKdbx(panel);
  const e2 = findEntry(db2, 'Localhost Login')!;
  expect(e2.fields.get('QK-IsCard')?.toString()).toBe('');
  expect(e2.fields.get('Cardholder Name')?.toString()).toBe('Jane Doe');
});

test('clearing Cardholder Name and saving removes the Additional Field', async ({ context, extensionId }) => {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();

  await panel.getByRole('button', { name: 'Credit card', exact: true }).click();
  await panel.getByLabel('Cardholder Name').fill('Jane Doe');
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  const saveBtn = panel.getByRole('button', { name: /Save/ });
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  let db = await reReadKdbx(panel);
  expect(findEntry(db, 'Localhost Login')!.fields.get('Cardholder Name')?.toString()).toBe('Jane Doe');

  await panel.getByLabel('Cardholder Name').fill('');
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  await saveBtn.click();
  await expect(saveBtn).not.toContainText('Save *');

  db = await reReadKdbx(panel);
  expect(findEntry(db, 'Localhost Login')!.fields.get('Cardholder Name')).toBeUndefined();
});
