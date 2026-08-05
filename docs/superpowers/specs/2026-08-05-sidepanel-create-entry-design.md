# Sidepanel: Create Entry in Current Group

## Problem

Entry creation only exists in the popup (`CreateForm.tsx`). The sidepanel (`Panel.tsx`) can browse, edit, and delete entries but has no way to create one — users must open the popup to add an entry, then switch back to the sidepanel.

## Goal

Let users create a new entry directly from the sidepanel, scoped to whichever group is currently selected in the group tree.

## Design

### Trigger

Add a "+" icon button in the entries-pane toolbar, next to the existing search input (`Panel.tsx:224-230`). Disabled (with a tooltip) when no group is selected (`selGroup == null`), since every entry must belong to a group.

### Create mode in the drawer

The sidepanel already has a bottom slide-in drawer that renders `EntryEditor` for the selected entry (`Panel.tsx:259-272`). Reuse this drawer for creation instead of building a new component:

- `EntryEditor`'s `entryId` prop becomes `string | null`. `null` means "new entry" mode.
- In create mode, `EntryEditor` skips the `getEntry` fetch and starts blank: empty Title/Username/Password/URL, `isCard=false`, no custom fields, no expiry — the same full field set available when editing, just empty.
- The Delete button is hidden in create mode (nothing to delete).
- The primary button reads "Create" instead of "Apply changes".

### Save behavior

Nothing is written to the vault until the user clicks Create. Cancel (or clicking away) simply closes the drawer and discards the draft — no orphan entries.

On Create, `EntryEditor` sends `{ type: 'createEntry', groupId, fields }` (same message contract the popup already uses, `src/shared/messages.ts:15`), where `fields` includes Title/UserName/Password/URL, `CARD_FLAG_KEY`, cardholder name, custom fields, and expiry — mirroring what `save()` already builds for `updateEntry` (`EntryEditor.tsx:113-133`).

### Panel state

- New `creatingEntry: boolean` state in `Panel.tsx`, alongside existing `selEntry`.
- Click "+" → `creatingEntry = true`, `selEntry = null`.
- Drawer render branches: `creatingEntry` → `<EntryEditor entryId={null} groupId={selGroup} ... />`; else if `selEntry` → existing edit-mode render.
- On successful create (SW returns `{ entryId }`): refresh the tree (existing `onChanged` callback), set `creatingEntry = false`, `selEntry = entryId` — the drawer now shows the same entry in normal edit mode. This mirrors the existing `addGroup` pattern, which auto-selects the newly created group (`Panel.tsx:139-144`).

### Error handling

- "+" button disabled when no group is selected.
- If `createEntry` fails (SW returns `!ok`), show an inline error in the drawer (generalize the existing `deleteError`-style state) and keep the draft fields intact so the user doesn't lose their input.

## Out of scope

- Bulk/multi-entry creation.
- Creating a group and an entry in one action.
- Changes to the popup's `CreateForm` flow (unaffected).

## Testing

- Unit: `EntryEditor` in create mode renders blank fields; Create sends `createEntry` (not `updateEntry`); Cancel sends nothing.
- E2E (extends `tests/e2e/specs/panel-save.spec.ts` pattern): open sidepanel, select a group, click "+", fill Title/Password, click Create, assert the entry appears in the list under that group and persists after reload.
