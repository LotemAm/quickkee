# QuickKee UI Redesign — Tailwind, Blue Theme, Light/Dark

**Date:** 2026-06-23
**Status:** Approved design, ready for implementation planning

## Summary

Make QuickKee's three extension surfaces — **popup**, **sidepanel** (panel),
and **settings** (options) — visually appealing using Tailwind CSS v4. Adopt a
single shared design system built on semantic design tokens, an **Sky Azure
blue** accent (`#0ea5e9`), the **"Soft Cards"** visual style (rounded corners,
soft shadows, blue-tinted surfaces, gradient primary button), and full
**light/dark** support driven by an OS-aware theme system.

This is primarily a **presentational** change. Core behavior (service-worker
messaging, unlock/save/autofill logic) is untouched. The only logic change is
extending the theme setting to support a `system` mode.

## Goals

- Cohesive, polished look across popup, sidepanel, and settings.
- Sky Azure blue accent, consistent in light and dark themes.
- Light/dark themes with a new **System/Auto** default that follows the OS.
- Lucide icons for clear, consistent iconography.
- Full freedom to restructure page layouts where it improves the experience.

## Non-Goals

- No changes to vault parsing, crypto, autofill, badge, or messaging logic.
- No new features beyond the theme `system` mode and the visual redesign.
- No new build tooling beyond adding the `lucide-react` dependency.

## Design Decisions (resolved)

| Question | Decision |
|---|---|
| Scope | Full freedom — restyle and restructure layouts as needed |
| Theme handling | Add **System/Auto** mode as new default; keep Light/Dark overrides |
| Icons | Add `lucide-react` icon library |
| Visual style | **B · Soft Cards** (shadows, depth, gradient primary) |
| Blue toning | **Sky Azure**, primary `#0ea5e9` |

## Architecture — Shared Design System

Single source of truth: `src/assets/styles/tailwind.css` (Tailwind v4, already
imported by popup and panel).

### Design tokens

Define CSS custom properties for semantic roles so every page and both themes
stay consistent. Light values are the default on `:root`; `.dark` overrides
them. Indicative token set (final values tuned during implementation):

- **Accent scale (Sky Azure):** `--primary: #0ea5e9`, `--primary-hover`,
  `--primary-strong` (`#0284c7`), `--primary-on` (`#ffffff`),
  `--primary-tint` (light button bg / badge bg).
- **Surfaces:** `--bg`, `--surface`, `--surface-raised`.
- **Text:** `--text`, `--text-muted`.
- **Lines/effects:** `--border`, `--ring`, `--shadow`.
- **Status:** `--danger` (expired/error), `--danger-tint`.

Dark counterparts use the brighter accent (`#38bdf8`) for text/links on dark
surfaces, matching the approved mockup.

### Component classes

Define reusable classes in `@layer components` so existing markup that already
references them (currently undefined → unstyled) is styled automatically:

- `.btn`, `.btn-primary` (gradient), `.btn-xs`, `.input` — already used in code.
- New: `.icon-btn`, `.card`, `.badge`, `.badge-danger`, `.app-header`,
  `.segmented` (theme control), `.empty-state`.

All component classes consume tokens only (no hardcoded colors), so theming is
centralized.

### Base layer

Body reset, font stack, and custom scrollbar styling live in the shared
stylesheet base layer.

### Cleanup

- **Options must import the shared stylesheet** — it currently imports only an
  empty `index.css` and has no Tailwind at all. This is a pre-existing bug fixed
  as part of this work.
- Delete `src/pages/panel/Panel.css` (hardcodes `#242424` background, fights the
  theme) and `src/pages/options/Options.css`. Reset per-page `index.css` files
  to only what is genuinely page-specific (e.g., popup fixed width).

## Theme System

- `Settings.theme` type changes from `'dark' | 'light'` to
  `'system' | 'light' | 'dark'`. `DEFAULT_SETTINGS.theme` becomes `'system'`.
- `applyTheme(theme)` in `src/shared/theme.ts`:
  - `'system'` → resolve via `window.matchMedia('(prefers-color-scheme: dark)')`
    and toggle the `.dark` class on `<html>`.
  - `'light'`/`'dark'` → toggle directly.
  - When in `system` mode, subscribe to `matchMedia` `change` events so the UI
    updates live when the OS theme changes. Provide a way to unsubscribe/replace
    the listener so repeated `applyTheme` calls don't stack listeners.
- Settings UI: a **segmented control** (System / Light / Dark) with Lucide
  icons, replacing the current "Dark theme" checkbox.

## Icons

Add `lucide-react`. Usage map (representative):

- **Header:** shield/key logo, lock (lock now), settings (open options).
- **Search:** search icon inside the field.
- **Entry card:** copy (username/password), arrow-right / log-in (autofill),
  chevron-down/up (expand fields).
- **Unlock screen:** file (open .kdbx), key (key file), lock (unlock action).
- **Editor:** copy per field.
- **Settings:** monitor/sun/moon for the theme segmented control.

**Accessibility / test safety:** every icon-only or icon+text button keeps an
accessible name matching its current text (visible label or `aria-label`):
`Copy user`, `Copy pass`, `Autofill`, `Unlock`, `Apply changes`, and the
`Save *` / `Saved` states. Entry rows keep their title as accessible text.

## Per-Page Layouts (full-freedom restructure)

### Popup (~340px wide)

- Sticky **app header**: shield logo + "QuickKee" title, lock button, settings
  button (opens options).
- Icon **search field** (placeholder text stays `Search…`).
- **Entry cards** (Soft Cards style): title + username, an icon action row
  (Copy user, Copy pass, Autofill), and an expand/collapse for additional
  fields with per-field copy.
- Expired entries show a `.badge-danger` "EXPIRED" badge.
- **Empty state:** when no entry matches the site, show the styled "create new
  entry" form as a card.
- **Lock screen** (shared `UnlockScreen`) rendered as a centered card.

### Sidepanel (panel)

- **Master–detail** layout (replacing the raw 50/50 split):
  - Left pane: header with logo + a dirty-aware **Save** button
    (`Save *` when dirty, `Saved` otherwise — text preserved). Scrollable
    group/entry **tree** with hover states, indentation/indent guides, entry
    icons, and expired markers.
  - Right pane: **EntryEditor** as a card with labeled inputs and copy buttons,
    plus an "select an entry" empty state when nothing is selected.
- **Constraint:** EntryEditor keeps its inputs in the order
  Title → Username → Password → URL with **no input rendered before Title**
  (the panel e2e test targets `input.nth(2)` as the password field).

### Settings (options)

- Card-based sections with a header (logo + "Settings"):
  - **Appearance** — theme segmented control (System / Light / Dark).
  - **Security** — auto-close interval and clipboard auto-clear, kept as
    `<select>` elements with **auto-close first** (options e2e targets the
    first combobox).
  - **Password generator** — length and character-class toggles.

## Data Flow / Error Handling

- No changes to data flow: all `sendToSW` calls, unlock, save, autofill, badge,
  and status polling behavior remain exactly as today.
- Visual states added: error alerts (token `--danger`), muted empty states,
  expired badges, disabled button styling, and a transient "Saved" confirmation.

## Testing Plan

Existing `vitest` unit tests and Playwright `e2e` suite must continue to pass.

**Preserved by design** (no test change needed):

- Accessible names: `Unlock`, `Copy user`, `Autofill`, `Apply changes`,
  `Save *` / `Saved`; placeholders `Master password`, `Search…`; entry titles
  (e.g., `Localhost Login`).
- Options auto-close remains the **first** `<select>` (`getByRole('combobox').first()`).
- EntryEditor input order (`input.nth(2)` = password).

**Intentional test update:**

- `tests/e2e/specs/options.spec.ts` currently checks a `Dark theme` checkbox and
  asserts `settings.theme === 'dark'`. Update it to drive the new **segmented
  control** (select "Dark") and assert persistence, accounting for the new
  `system` default. This is an expected consequence of the redesigned theme
  control.

**Verification after implementation:**

- `yarn typecheck`
- `yarn test` (vitest)
- `yarn test:e2e` (build + Playwright)

## Affected Files (indicative)

- `src/assets/styles/tailwind.css` — tokens, base, component layer (primary work).
- `src/shared/theme.ts` — system-aware theme resolution + live listener.
- `src/shared/settings.ts` — `theme` enum + default.
- `src/shared/UnlockScreen.tsx` — card styling + icons.
- `src/pages/popup/{Popup,EntryCard,CreateForm}.tsx`, `index.css`, `index.tsx`.
- `src/pages/panel/{Panel,EntryEditor}.tsx`, `index.tsx`; delete `Panel.css`.
- `src/pages/options/{Options}.tsx`, `index.tsx`; delete `Options.css`.
- `package.json` — add `lucide-react`.
- `tests/e2e/specs/options.spec.ts` — theme control update.

## Risks

- **Test coupling to UI:** mitigated by preserving accessible names, control
  order, and input order; only the options theme test changes intentionally.
- **Theme listener leaks:** ensure `applyTheme` replaces rather than stacks the
  `matchMedia` listener.
- **lucide-react bundle size:** negligible with per-icon imports; tree-shaken by
  Vite.
