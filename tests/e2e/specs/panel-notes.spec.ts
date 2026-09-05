import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import kdbxweb from 'kdbxweb';
import { test, expect, openExtensionPage, installDb, reReadKdbx } from '../helpers';
import { registerXmlParser } from '../../../src/background/xml';

const rawNotes = '  Original\tNote\r\nשלום & <literal>\rlast\n ';
const displayedNotes = '  Original\tNote\nשלום & <literal>\nlast\n ';

async function notesFixture(path: string, protectedNotes: boolean) {
  registerXmlParser();
  const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('correct horse')), 'Notes vault');
  db.setKdf(kdbxweb.Consts.KdfId.Aes);
  db.meta.memoryProtection.notes = protectedNotes;
  const entry = db.createEntry(db.getDefaultGroup());
  entry.fields.set('Title', 'Existing note');
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('unchanged password'));
  entry.fields.set('Notes', protectedNotes ? kdbxweb.ProtectedValue.fromString(rawNotes) : rawNotes);
  const other = db.createEntry(db.getDefaultGroup());
  other.fields.set('Title', 'Other entry');
  other.fields.set('Notes', 'Other entry notes');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await db.save()));
}

async function openNotesPanel(context: BrowserContext, extensionId: string, path: string) {
  const popup = await openExtensionPage(context, extensionId, 'src/pages/popup/index.html');
  await installDb(popup, path);
  await popup.reload();
  await popup.getByPlaceholder('Master password').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();
  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.getByRole('button', { name: 'Existing note', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();
  return panel;
}

async function saveVault(panel: Page) {
  const save = panel.getByRole('button', { name: /^Sav/ });
  await expect(save).toContainText('Save *');
  await save.click();
  await expect(save).toContainText('Saved');
  await expect(save).toBeDisabled();
}

async function storedNotes(panel: Page, title: string) {
  const db = await reReadKdbx(panel);
  const entry = [...db.getDefaultGroup().allEntries()].find(entry => entry.fields.get('Title') === title);
  expect(entry, `persisted entry ${title}`).toBeDefined();
  const field = entry!.fields.get('Notes');
  return { text: field instanceof kdbxweb.ProtectedValue ? field.getText() : field,
    protected: field instanceof kdbxweb.ProtectedValue };
}

for (const protectedNotes of [false, true]) {
  test(`panel: edit, copy, save and clear Notes (protected=${protectedNotes})`, async ({ context, extensionId }, testInfo) => {
    const path = testInfo.outputPath('notes.kdbx');
    await notesFixture(path, protectedNotes);
    const panel = await openNotesPanel(context, extensionId, path);
    const notes = panel.getByLabel('Notes', { exact: true });
    const more = panel.locator('summary', { hasText: /^More/ });
    await expect(notes).toBeHidden();
    await expect(more).not.toContainText('Original');
    await more.focus(); await panel.keyboard.press('Enter');
    await expect(notes).toBeVisible();
    await expect(notes).toHaveValue(displayedNotes);
    await panel.keyboard.press('Tab');
    await expect(panel.getByRole('button', { name: 'Copy Notes' })).toBeFocused();
    await panel.keyboard.press('Tab'); await expect(notes).toBeFocused();
    const box = await notes.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(420);

    const edited = '  Edited\n\tשלום 😀 <b>**plain text**</b> &\n ';
    await notes.fill(edited);
    await more.click(); await expect(notes).toBeHidden();
    await more.click(); await expect(notes).toHaveValue(edited);
    await panel.getByRole('button', { name: 'Copy Notes' }).click();
    await expect(panel.getByText('Notes copied', { exact: true })).toBeVisible();
    // Chromium exposes Windows clipboard text with CRLF; persisted KDBX values below stay exact.
    const clipboardText = process.platform === 'win32' ? edited.replace(/\n/g, '\r\n') : edited;
    await expect.poll(() => panel.evaluate(() => navigator.clipboard.readText())).toBe(clipboardText);
    await notes.focus();
    await notes.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 8));
    await panel.keyboard.press('Control+c');
    await expect.poll(() => panel.evaluate(() => navigator.clipboard.readText())).toBe('Edited');
    // Disclosure/copy/edit alone leave the vault clean and the encrypted file untouched.
    await expect(panel.getByRole('button', { name: /^Saved/ })).toBeDisabled();
    expect(await storedNotes(panel, 'Existing note')).toEqual({ text: rawNotes, protected: protectedNotes });
    await panel.getByRole('button', { name: 'Apply changes' }).click();
    await expect(panel.getByRole('button', { name: /^Save \*/ })).toBeEnabled();
    expect(await storedNotes(panel, 'Existing note')).toEqual({ text: rawNotes, protected: protectedNotes });
    await saveVault(panel);
    expect(await storedNotes(panel, 'Existing note')).toEqual({ text: edited, protected: protectedNotes });
    await notes.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath('notes-editor.png') });

    await panel.getByRole('button', { name: 'Other entry', exact: true }).click();
    await expect(notes).toBeHidden(); await more.click();
    await expect(notes).toHaveValue('Other entry notes');
    await panel.getByRole('button', { name: 'Existing note', exact: true }).click();
    await expect(notes).toBeHidden(); await more.click(); await expect(notes).toHaveValue(edited);
    await notes.fill('');
    await expect(panel.getByRole('button', { name: 'Copy Notes' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Apply changes' }).click(); await saveVault(panel);
    expect(await storedNotes(panel, 'Existing note')).toEqual({ text: '', protected: protectedNotes });
    await panel.reload();
    await panel.getByRole('button', { name: 'Existing note', exact: true }).click();
    await more.click(); await expect(notes).toHaveValue('');
  });
}

test('panel: viewing raw CRLF/CR Notes and applying another field preserves their exact stored value', async ({ context, extensionId }, testInfo) => {
  const path = testInfo.outputPath('untouched-notes.kdbx');
  await notesFixture(path, false);
  const panel = await openNotesPanel(context, extensionId, path);
  await panel.getByText('More', { exact: true }).click();
  await expect(panel.getByLabel('Notes', { exact: true })).toHaveValue(displayedNotes);
  const title = panel.locator('div.mb-3').filter({ has: panel.getByText('Title', { exact: true }) }).getByRole('textbox');
  await title.fill('Renamed note');
  await panel.getByRole('button', { name: 'Apply changes' }).click(); await saveVault(panel);
  expect(await storedNotes(panel, 'Renamed note')).toEqual({ text: rawNotes, protected: false });
  await panel.reload(); await panel.getByRole('button', { name: 'Renamed note', exact: true }).click();
  await panel.getByText('More', { exact: true }).click();
  await expect(panel.getByLabel('Notes', { exact: true })).toHaveValue(displayedNotes);
});

test('panel: create an entry with multiline Notes and save it to KDBX', async ({ context, extensionId }, testInfo) => {
  const path = testInfo.outputPath('create-notes.kdbx');
  await notesFixture(path, true);
  const panel = await openNotesPanel(context, extensionId, path);
  await panel.getByRole('button', { name: 'Add entry' }).click();
  await panel.getByRole('button', { name: 'Create', exact: true }).waitFor();
  const notes = panel.getByLabel('Notes', { exact: true });
  await expect(notes).toBeHidden(); await panel.getByText('More', { exact: true }).click();
  await expect(notes).toHaveValue('');
  const title = panel.locator('div.mb-3').filter({ has: panel.getByText('Title', { exact: true }) }).getByRole('textbox');
  await title.fill('Created with Notes');
  const draft = '  Created\n\tשלום & <plain> 😀\n ';
  await notes.fill(draft);
  await panel.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Apply changes' })).toBeVisible();
  await saveVault(panel);
  expect(await storedNotes(panel, 'Created with Notes')).toEqual({ text: draft, protected: true });
  await panel.reload(); await panel.getByRole('button', { name: 'Created with Notes', exact: true }).click();
  await panel.getByText('More', { exact: true }).click(); await expect(notes).toHaveValue(draft);
});
