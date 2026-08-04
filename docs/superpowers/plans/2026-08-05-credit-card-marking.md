# Credit Card Marking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark a vault entry as "credit card data" from the panel's sidebar entry editor, storing card number/CVV/expiry/cardholder-name in reused/existing fields, with list-view icons to tell card entries apart at a glance.

**Architecture:** QuickKee entries are flat KeePass (KDBX) field maps (`src/background/vault.ts`, via `kdbxweb`) — there is no native "entry type." A new reserved custom field (`QK-IsCard`) acts as a boolean marker, following the same pattern as the existing `STD` reserved-key set. Card Number/CVV/Expiry reuse the existing Username/Password/native-expiry fields (relabeled in the UI only); Cardholder Name is stored as a plain Additional Field (`Cardholder Name`) but gets a dedicated always-visible input instead of the generic Additional Fields editor.

**Tech Stack:** React 19 + TypeScript, `kdbxweb` for KDBX read/write, Vitest for background-logic unit tests, Playwright for UI/persistence e2e tests (this repo's established split — no component-level unit tests for `pages/*` exist today, so we follow that convention rather than introducing one).

## Global Constraints

- No new dependencies. `lucide-react` (`^1.21.0`, already a dependency) supplies the `CreditCard` icon; its generated SVG class for that icon is `lucide-credit-card` (verified in `node_modules/lucide-react/dist/esm/createLucideIcon.mjs` — class = `lucide-${kebabCase(iconName)}`), used as a stable e2e selector.
- No card-number/CVV/expiry format validation — free text, matching every other field in this codebase today.
- Marking UI lives only in `src/pages/panel/EntryEditor.tsx`. `src/pages/popup/CreateForm.tsx` is not touched — new entries are always created as plain logins.
- Toggling the card flag must never delete or move existing field values (reversible, non-destructive).

---

### Task 1: Data model — `isCard` flag on entries + vault persistence

**Files:**
- Modify: `src/shared/entry.ts`
- Modify: `src/background/vault.ts:4,6,68-76,78-94,119-130`
- Test: `src/background/vault.test.ts` (append)

**Interfaces:**
- Produces: `CARD_FLAG_KEY: string` (`'QK-IsCard'`) and `CARDHOLDER_NAME_KEY: string` (`'Cardholder Name'`), both exported from `src/shared/entry.ts`. `EntryView.isCard: boolean` and `EntrySummary.isCard: boolean`, populated by `Vault.toView`/`Vault.toSummary`/`Vault.getTree`.
- Consumes: nothing new (extends existing `Vault`/`EntryView`/`EntrySummary` from this codebase).

- [ ] **Step 1: Write the failing vault tests**

Append to `src/background/vault.test.ts` (add `CARD_FLAG_KEY` to the existing import line: `import { Vault, isInvalidKey } from './vault';` stays; add a new import `import { CARD_FLAG_KEY } from '../shared/entry';` near the top):

```ts
test('setting the card flag round-trips through serialize and is excluded from fields[]', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1' });

  const view = v.getEntry(id)!;
  expect(view.isCard).toBe(true);
  expect(view.fields.find(f => f.key === CARD_FLAG_KEY)).toBeUndefined();

  const bytes = await v.serialize();
  const v2 = new Vault(); await v2.open(bytes, 'correct horse', null);
  expect(v2.getEntry(id)?.isCard).toBe(true);
});

test('entries without the card flag default to isCard false', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const view = v.entriesForUrl('https://github.com/login')[0];
  expect(view.isCard).toBe(false);
});

test('clearing the card flag reverts isCard to false', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1' });
  expect(v.getEntry(id)?.isCard).toBe(true);
  v.updateEntry(id, { [CARD_FLAG_KEY]: '' });
  expect(v.getEntry(id)?.isCard).toBe(false);
});

test('entrySummariesForUrl and getTree both expose isCard', async () => {
  const v = new Vault(); await v.open(fixture(), 'correct horse', null);
  const id = v.entriesForUrl('https://github.com')[0].id;
  v.updateEntry(id, { [CARD_FLAG_KEY]: '1' });

  const summaries = v.entrySummariesForUrl('https://github.com/login');
  expect(summaries[0].isCard).toBe(true);

  const tree = v.getTree();
  const sites = tree.children.find(c => c.name === 'Sites');
  expect(sites?.entries.find(e => e.id === id)?.isCard).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/background/vault.test.ts`
Expected: FAIL — `isCard` is `undefined` (property doesn't exist yet on `EntryView`/`EntrySummary`), so `expect(...).toBe(true)` assertions fail.

- [ ] **Step 3: Add `isCard` to the shared entry types**

Edit `src/shared/entry.ts` to:

```ts
export const CARD_FLAG_KEY = 'QK-IsCard';
export const CARDHOLDER_NAME_KEY = 'Cardholder Name';

export interface EntryField { key: string; value: string; protected: boolean }
export interface EntryView {
  id: string; title: string; username: string; url: string;
  password: string; fields: EntryField[]; expired: boolean;
  created: number | null; expires: number | null; isCard: boolean
}
export interface EntrySummary { id: string; title: string; username: string; url: string; expired: boolean; isCard: boolean }
export interface TreeNode {
  groupId: string; name: string;
  entries: EntrySummary[];
  children: TreeNode[]
}
```

- [ ] **Step 4: Wire the flag through `Vault`**

In `src/background/vault.ts`, add the import (alongside the existing type-only import on line 4):

```ts
import { CARD_FLAG_KEY } from '../shared/entry';
```

Change line 6 to include the new reserved key so it's filtered out of the generic custom-fields list, same as `Title`/`UserName`/etc.:

```ts
const STD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', CARD_FLAG_KEY]);
```

In `toSummary` (currently `vault.ts:68-76`), add `isCard`:

```ts
private toSummary(e: kdbxweb.KdbxEntry): EntrySummary {
  return {
    id: e.uuid.id,
    title: str(e.fields.get('Title')),
    username: str(e.fields.get('UserName')),
    url: str(e.fields.get('URL')),
    expired: this.isExpired(e),
    isCard: str(e.fields.get(CARD_FLAG_KEY)) === '1',
  };
}
```

In `toView` (currently `vault.ts:78-94`), add `isCard`:

```ts
private toView(e: kdbxweb.KdbxEntry): EntryView {
  const fields: EntryField[] = [];
  e.fields.forEach((v, k) => {
    if (!STD.has(k)) fields.push({ key: k, value: str(v), protected: v instanceof kdbxweb.ProtectedValue });
  });
  return {
    id: e.uuid.id,
    title: str(e.fields.get('Title')),
    username: str(e.fields.get('UserName')),
    url: str(e.fields.get('URL')),
    password: str(e.fields.get('Password')),
    fields,
    expired: this.isExpired(e),
    created: e.times.creationTime ? e.times.creationTime.getTime() : null,
    expires: e.times.expires === true && e.times.expiryTime ? e.times.expiryTime.getTime() : null,
    isCard: str(e.fields.get(CARD_FLAG_KEY)) === '1',
  };
}
```

In `getTree` (currently `vault.ts:119-130`), the inline entry-summary literal is built by hand rather than via `toSummary` — add `isCard` there too, or it will silently be `undefined` in the panel's tree even though `toSummary`/`toView` are correct:

```ts
getTree(): TreeNode {
  const build = (g: kdbxweb.KdbxGroup): TreeNode => ({
    groupId: g.uuid.id, name: str(g.name),
    entries: g.entries.map(e => { const v = this.toView(e);
      return { id: v.id, title: v.title, username: v.username, url: v.url, expired: v.expired, isCard: v.isCard }; }),
    children: g.groups.filter(c => !this.isRecycleBin(c)).map(build),
  });
  return build(this.root);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/background/vault.test.ts`
Expected: PASS — all existing tests plus the 4 new ones.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms every `EntryView`/`EntrySummary` literal elsewhere in the codebase — there are none besides `vault.ts` — still satisfies the now-required `isCard` field).

- [ ] **Step 7: Commit**

```bash
git add src/shared/entry.ts src/background/vault.ts src/background/vault.test.ts
git commit -m "feat(vault): add isCard flag to entry data model"
```

---

### Task 2: EntryEditor — mark-as-card UI, field relabeling, cardholder name

**Files:**
- Modify: `src/pages/panel/EntryEditor.tsx`
- Test: `tests/e2e/specs/credit-card-marking.spec.ts` (new)

**Interfaces:**
- Consumes: `CARD_FLAG_KEY`, `CARDHOLDER_NAME_KEY` from `src/shared/entry.ts` (Task 1). `EntryView.isCard: boolean` (Task 1).
- Produces: nothing consumed by later tasks (Task 3 only depends on Task 1's `isCard` flag, not on this task).

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/specs/credit-card-marking.spec.ts`:

```ts
import { test, expect, openExtensionPage, installDb, reReadKdbx } from '../helpers';
import * as kdbxweb from 'kdbxweb';

function findEntry(db: kdbxweb.Kdbx, title: string): kdbxweb.KdbxEntry | undefined {
  const stack = [...db.groups];
  while (stack.length) {
    const g = stack.pop()!;
    for (const e of g.entries) if (e.fields.get('Title')?.toString() === title) return e;
    stack.push(...g.groups);
  }
}

test('panel: mark an entry as credit card data, save, and verify persisted fields', async ({ context, extensionId }) => {
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

  // Not marked yet: normal labels, URL visible, rules button visible.
  await expect(panel.getByText('Username')).toBeVisible();
  await expect(panel.getByText('URL')).toBeVisible();
  await expect(panel.getByLabel('Password rules')).toBeVisible();

  await panel.getByLabel('Mark as credit card data').check();

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

  // Unmark: labels revert; the underlying Cardholder Name field is left untouched.
  await panel.getByLabel('Mark as credit card data').uncheck();
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
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.getByPlaceholder('Search…')).toBeVisible();

  const panel = await openExtensionPage(context, extensionId, 'src/pages/panel/index.html');
  await panel.getByRole('button', { name: 'Sites' }).click();
  await panel.getByRole('button', { name: 'Localhost Login' }).click();
  await panel.getByRole('button', { name: 'Apply changes' }).waitFor();

  await panel.getByLabel('Mark as credit card data').check();
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
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `npm run test:e2e -- credit-card-marking`
Expected: FAIL — `panel.getByLabel('Mark as credit card data')` finds no element (checkbox doesn't exist yet).

- [ ] **Step 3: Implement the marking UI in EntryEditor.tsx**

Change the import line that currently reads `import type { EntryView } from '../../shared/entry';` to:

```tsx
import { CARD_FLAG_KEY, CARDHOLDER_NAME_KEY, type EntryView } from '../../shared/entry';
```

Add two new state variables next to the existing `useState` declarations (after `const [expires, setExpires] = useState<number | null>(null);`):

```tsx
const [isCard, setIsCard] = useState(false);
const [cardholderName, setCardholderName] = useState('');
```

In the load effect, reset both alongside the existing resets, and populate them from the loaded entry:

```tsx
useEffect(() => {
  setShowPass(false);
  setDeleteError('');
  setOpts(pwgen);
  setShowRules(false);
  setIsCard(false);
  setCardholderName('');
  sendToSW({ type: 'getEntry', entryId }).then(r => {
    if (r.ok && r.entry) {
      setE(r.entry); setExpires(r.entry.expires);
      setIsCard(r.entry.isCard);
      setCardholderName(r.entry.fields.find(f => f.key === CARDHOLDER_NAME_KEY)?.value ?? '');
      setCustom(r.entry.fields.filter(f => f.key !== CARDHOLDER_NAME_KEY).map(f => ({ key: f.key, value: f.value })));
      setOrigKeys(r.entry.fields.map(f => f.key));
    }
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [entryId]);
```

(`custom`, the editable Additional Fields list, excludes `Cardholder Name` at load time — it's edited exclusively through the dedicated input below, never through the generic Additional Fields rows, so the two UIs can't clobber each other. `origKeys` keeps the full list including `Cardholder Name`, so `save()`'s removal diff still works correctly.)

In the `field()` helper, gate the password-rules button and panel on `!isCard` (find the two blocks that render `SlidersHorizontal` and `PasswordRulesPanel`):

```tsx
{secret && !isCard && (
  <button className="icon-btn" aria-label="Password rules" title="Password rules (this session)"
    onClick={() => setShowRules(s => !s)}>
    <SlidersHorizontal size={14} />
  </button>
)}
```

```tsx
{secret && !isCard && showRules && (
  <div className="mt-2"><PasswordRulesPanel opts={opts} onChange={setOpts} /></div>
)}
```

Rewrite `save()`:

```tsx
async function save() {
  const fields: Record<string, string> = {
    Title: e!.title, UserName: e!.username, URL: e!.url, Password: e!.password,
    [CARD_FLAG_KEY]: isCard ? '1' : '',
  };
  const keptKeys = new Set<string>();
  for (const f of custom) {
    const k = f.key.trim();
    if (k && !['Title', 'UserName', 'URL', 'Password', 'Notes', CARDHOLDER_NAME_KEY].includes(k)) { fields[k] = f.value; keptKeys.add(k); }
  }
  const name = cardholderName.trim();
  if (name) { fields[CARDHOLDER_NAME_KEY] = name; keptKeys.add(CARDHOLDER_NAME_KEY); }
  const removeKeys = origKeys.filter(k => !keptKeys.has(k));
  await sendToSW({ type: 'updateEntry', entryId, fields, expires, removeKeys });
  onChanged();
}
```

In the JSX, replace this block:

```tsx
{field('Title', 'title')}
{field('Username', 'username')}
{field('Password', 'password')}
{field('URL', 'url')}
```

with:

```tsx
{field('Title', 'title')}
<div className="mb-3">
  <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
    <input type="checkbox" checked={isCard} onChange={ev => setIsCard(ev.target.checked)} />
    Mark as credit card data
  </label>
</div>
{field(isCard ? 'Card Number' : 'Username', 'username')}
{field(isCard ? 'CVV' : 'Password', 'password')}
{isCard && (
  <div className="mb-3">
    <label className="section-title block">Cardholder Name</label>
    <input className="input w-full" aria-label="Cardholder Name" value={cardholderName}
      onChange={ev => setCardholderName(ev.target.value)} />
  </div>
)}
{!isCard && field('URL', 'url')}
```

Relabel the expiry section — change:

```tsx
<div className="section-title block">Expiry date</div>
```

to:

```tsx
<div className="section-title block">{isCard ? 'Card Expiry' : 'Expiry date'}</div>
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `npm run test:e2e -- credit-card-marking`
Expected: PASS for both tests in the file.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/panel/EntryEditor.tsx tests/e2e/specs/credit-card-marking.spec.ts
git commit -m "feat(panel): mark entries as credit card data in EntryEditor"
```

---

### Task 3: Card icon in panel and popup entry lists

**Files:**
- Modify: `src/pages/panel/Panel.tsx:2-3,237`
- Modify: `src/pages/popup/EntryCard.tsx:1-18`
- Test: `tests/e2e/specs/credit-card-list-icons.spec.ts` (new)

**Interfaces:**
- Consumes: `EntrySummary.isCard` / `EntryView.isCard` (Task 1). No dependency on Task 2.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/specs/credit-card-list-icons.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `npm run test:e2e -- credit-card-list-icons`
Expected: FAIL — no `svg.lucide-credit-card` appears anywhere (icon not wired up yet). Note this test depends on Task 2's marking UI already being implemented (checkbox, `Apply changes`) — run Task 2 before this one.

- [ ] **Step 3: Add the icon to the panel entry list**

In `src/pages/panel/Panel.tsx`, add `CreditCard` to the `lucide-react` import (lines 2-3):

```tsx
import { Save, FolderClosed, FolderOpen, FileText, CreditCard, X, Lock,
  ChevronRight, ChevronDown, Plus, Pencil, Trash2, Check, Search } from 'lucide-react';
```

Replace the icon at line 237:

```tsx
<FileText size={14} style={{ color: 'var(--text-muted)' }} />
```

with:

```tsx
{e.isCard
  ? <CreditCard size={14} style={{ color: 'var(--text-muted)' }} />
  : <FileText size={14} style={{ color: 'var(--text-muted)' }} />}
```

- [ ] **Step 4: Add the icon to the popup entry list**

In `src/pages/popup/EntryCard.tsx`, add `CreditCard` to the `lucide-react` import (line 2):

```tsx
import { Copy, LogIn, ChevronDown, ChevronUp, PanelRight, CreditCard } from 'lucide-react';
```

Replace the title block (line 18):

```tsx
<div className="font-medium truncate" style={{ color: 'var(--text)' }}>{entry.title}</div>
```

with:

```tsx
<div className="font-medium truncate flex items-center gap-1" style={{ color: 'var(--text)' }}>
  {entry.isCard && <CreditCard size={12} />}
  <span className="truncate">{entry.title}</span>
</div>
```

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `npm run test:e2e -- credit-card-list-icons`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, and full test suites**

Run: `npm run typecheck && npm run lint && npm test && npm run test:e2e`
Expected: all green — this is the final task, so this also confirms nothing in Tasks 1-2 regressed.

- [ ] **Step 7: Commit**

```bash
git add src/pages/panel/Panel.tsx src/pages/popup/EntryCard.tsx tests/e2e/specs/credit-card-list-icons.spec.ts
git commit -m "feat(ui): show a credit-card icon for card entries in panel and popup lists"
```
