# Credit Card Marking — Design

## Goal

Let a user mark an existing vault entry as "credit card data" from the sidebar (panel) entry editor. This lays the data foundation for a future autofill-into-card-forms feature — that autofill logic itself is out of scope here.

## Scope

- Marking UI lives **only** in the panel's `EntryEditor.tsx` (sidebar), under an advanced/more-options section. Not added to the popup's `CreateForm.tsx` — new entries are always created as plain logins; marking as a card happens afterward via sidebar edit.
- No content-script/autofill detection work. That's a separate future feature.
- No card-number/CVV format validation (Luhn, length, etc.) — free-text like all other entry fields today.

## Data model

QuickKee entries are stored as flat KeePass (KDBX) field maps via `kdbxweb` (`src/background/vault.ts`) — there's no native "entry type" concept in KDBX. A reserved custom field is used as the marker, following the same pattern as the existing `STD` reserved-key set (`vault.ts:6`):

- New reserved key (e.g. `QK-IsCard`) stores `"1"` when marked, absent otherwise. Filtered out of the generic "Additional fields" list the same way `Title`/`UserName`/`Password`/`URL` already are.
- Exposed as `isCard: boolean` on both `EntryView` and `EntrySummary` (`src/shared/entry.ts`), populated by the same vault code that builds those objects from raw KDBX fields.
- No migration needed: entries without the flag default to `isCard: false`.

### Field reuse — no new schema beyond the flag

| Card concept | Backing field | Notes |
|---|---|---|
| Card Number | `username` | relabeled in UI when marked |
| CVV | `password` | relabeled in UI; already renders masked |
| Expiry (MM/YY) | native KDBX entry `expires` timestamp | reused/relabeled; existing popup expiration UI unaffected |
| Cardholder Name | plain Additional Field | user adds manually, no special handling |
| `url` | unused when marked | left alone in storage, hidden in UI |

## UI changes

### Panel `EntryEditor.tsx` (sidebar)

Advanced section gets a new checkbox: **"Mark as credit card data"**. Toggling is non-destructive and reversible — it only changes labels/visibility, never clears or moves field values.

When **on**:
- Username label → "Card Number"
- Password label → "CVV"; password-generator quick-settings button hidden (CVV isn't a generated password)
- Expiration section label → "Card Expiry"
- URL field hidden

When **off**: reverts to normal Username/Password/URL labels; flag cleared on save.

### Panel entry list (`Panel.tsx:237`)

Row icon swaps per entry: `CreditCard` (lucide-react) when `e.isCard`, else the existing `FileText`.

### Popup entry list (`EntryCard.tsx:18`)

Small `CreditCard` icon (lucide-react) placed left of the title, shown **only** when `entry.isCard` is true — no icon for regular entries, to visually differentiate cards at a glance.

## Testing

- `vault.ts` unit test: setting the flag round-trips through serialize/reload, and is excluded from the generic `fields[]` custom-field list.
- `EntryEditor.tsx`: toggle test — checking "mark as card" swaps labels, hides URL and the password-gen button; unchecking reverts.
- Existing entry-expiration tests unaffected (native `expires` mechanism untouched, only relabeled in this UI state).
- Panel and popup list rendering: icon appears only for `isCard` entries.

## Out of scope (future work)

- Card-form detection/autofill content-script logic.
- Card number/CVV format validation.
- Migrating/clearing username+password values automatically when marking/unmarking.
