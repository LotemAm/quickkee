---
name: QuickKee
description: Existing blue utility interface for a KeePass-compatible browser extension
colors:
  primary: "#0ea5e9"
  primary-hover: "#0284c7"
  primary-on: "#ffffff"
  primary-tint: "#cdeefc"
  primary-text: "#0284c7"
  bg: "#f4f8fb"
  surface: "#ffffff"
  surface-raised: "#ffffff"
  text: "#1e293b"
  text-muted: "#64748b"
  border: "#e4edf3"
  btn-bg: "#eef6fb"
  btn-text: "#0369a1"
  danger: "#dc2626"
  danger-tint: "#fee2e2"
  danger-text: "#b91c1c"
  success-tint: "#dcfce7"
  success-border: "#bbf7d0"
  success-text: "#15803d"
  dark-primary-hover: "#38bdf8"
  dark-primary-tint: "#075985"
  dark-primary-text: "#38bdf8"
  dark-bg: "#0a1018"
  dark-surface: "#11202e"
  dark-surface-raised: "#16202f"
  dark-text: "#d8eaf7"
  dark-text-muted: "#7a96ad"
  dark-border: "#1f3346"
  dark-btn-bg: "#1d2b3d"
  dark-btn-text: "#9ed8f5"
  dark-danger: "#f87171"
  dark-danger-tint: "#7f1d1d"
  dark-danger-text: "#fecaca"
  dark-success-tint: "#123b2a"
  dark-success-border: "#166534"
  dark-success-text: "#86efac"
  welcome-primary: "#0369a1"
  welcome-link: "#0369a1"
  welcome-muted: "#52667a"
  welcome-border: "#cddce7"
  welcome-primary-hover: "#075985"
  welcome-on-muted: "#e0f2fe"
  dark-welcome-link: "#7dd3fc"
  dark-welcome-muted: "#a9c1d4"
  dark-welcome-border: "#4c6b83"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "13px"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: ".05em"
  button-primary:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "13px"
    fontWeight: 600
  badge:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "9px"
    fontWeight: 600
    letterSpacing: ".03em"
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "40px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-.035em"
  display-narrow:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-.03em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-.015em"
  welcome-lead:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "17px"
    lineHeight: 1.6
  welcome-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    lineHeight: 1.75
rounded:
  small: "6px"
  control: "8px"
  card: "10px"
  welcome-continue: "12px"
  welcome-card: "14px"
  pill: "999px"
spacing:
  control-gap: "6px"
  control-y: "7px"
  input-x: "10px"
  card: "12px"
  welcome-gap: "14px"
  welcome-form: "24px"
  welcome-form-narrow: "18px"
components:
  button-primary:
    textColor: "{colors.primary-on}"
    typography: "{typography.button-primary}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-default:
    backgroundColor: "{colors.btn-bg}"
    textColor: "{colors.btn-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  badge:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "2px 7px"
  app-header:
    backgroundColor: "{colors.surface}"
    padding: "10px 12px"
  source-picker:
    backgroundColor: "{colors.btn-bg}"
    rounded: "{rounded.card}"
    padding: "4px"
  welcome-action-primary:
    backgroundColor: "{colors.welcome-primary}"
    textColor: "{colors.primary-on}"
    typography: "{typography.title}"
    rounded: "{rounded.welcome-card}"
    padding: "23px 25px"
  welcome-action-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    rounded: "{rounded.welcome-card}"
    padding: "23px 25px"
  welcome-form-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.welcome-card}"
    padding: "{spacing.welcome-form}"
---

# Design System: QuickKee

## Overview

**Creative North Star: "QuickKee's existing blue utility interface"**

QuickKee uses blue actions, pale-blue or dark slate surfaces, system sans typography, and Lucide line icons. Its established popup, panel, and settings controls are compact, with rounded corners, thin borders, and modest shadows.

The approved first-install welcome extends that identity into a full browser tab. Its larger type and action rows are scoped to that surface. This document records the current implementation; runtime source remains authoritative in src/assets/styles/tailwind.css and src/pages/welcome/index.css.

**Key Characteristics:**
- Blue actions and theme-aware neutral surfaces.
- Compact shared controls; roomier welcome presentation.
- Existing QuickKee logo and Lucide line icons.

- Extraction evidence: `src/assets/styles/tailwind.css`, `src/pages/welcome/Welcome.tsx`, `src/pages/welcome/index.css`, and shared database controls.
- Render evidence: `.impeccable/review/{desktop,mobile,dark-desktop,create-mobile,open-mobile}.png`.
- The selected welcome composition and completion evidence belong to `.impeccable/surfaces/src-pages-welcome-welcome-tsx.md`.

## Colors

The established palette combines bright blue controls with cool neutral surfaces. Frontmatter names mirror source roles; `dark-*` entries record differing dark-theme values, not additional simultaneous accents.

### Primary

- **Action blue:** `primary`, `primary-hover`, and `primary-on` describe legacy shared controls. The shared primary button uses `--primary-grad` from the shared stylesheet.
- **Tint and text blue:** `primary-tint` and `primary-text` support selected controls, badges, and links.
- **Welcome deep blue:** `welcome-primary` and `welcome-primary-hover` belong only to welcome actions. `welcome-link`, `welcome-muted`, and `welcome-border` have separate dark-theme values. `welcome-on-muted` is supporting copy on the filled action.
- The welcome wrapper also overrides inherited primary text, muted text, and primary button background for its shared forms. Legacy values above remain unchanged.

### Secondary

- **Status colors:** danger and success tokens communicate errors, destructive actions, and connected-account status. They are semantic feedback, not a second brand palette.

### Neutral

- **Page and surface:** `bg`, `surface`, and `surface-raised` separate the canvas, cards, and overlays.
- **Text and boundaries:** `text`, `text-muted`, and `border` establish hierarchy; `btn-bg` and `btn-text` identify quieter controls.
- The sidecar records motion, shadows, the welcome breakpoint, and a self-contained action preview; it introduces no runtime palette tokens.

**The Existing Theme Rule.** Inherit the existing light/dark theme variables; welcome contrast overrides stay inside the welcome surface.

## Typography

**Display Font / Body Font:** the system sans stack in the frontmatter. There is no separate display face.

- **Body:** compact fields and controls use the body role; this is not a new global body-size declaration.
- **Label:** small uppercase section headings use the label role. Badges use their own smaller role.
- **Welcome display:** the display role is the welcome heading; the narrow variant applies at the welcome breakpoint.
- **Welcome title:** action-row titles use the title role; they reduce to (17px) on narrow screens.
- **Welcome lead and body:** supporting introduction and explainer text use their respective roles. The narrow lead reduces to (16px).

**The System Type Rule.** Use the incumbent system sans stack for display, body, and controls.

## Layout

- Established extension surfaces use dense horizontal headers, compact controls, and padded cards. No new global grid or breakpoint scale is introduced here.
- Welcome only: a single column (`min(544px, calc(100% - 40px))`) sits below a branded header. Two action rows have a minimum height (102px) and the recorded welcome gap.
- Welcome forms replace the choices in the same column; Back returns to the prior choice. Existing create/unlock controls retain their behavior.
- At widths up to (600px), the welcome header becomes shorter (80px), its supporting note hides, action padding reduces (21px 19px), and form padding uses the narrow token. Text wraps; there is no fixed-height viewport clipping.
- The welcome footer follows content and rests near the viewport bottom when space permits.

## Elevation & Depth

Shared cards use subtle theme-aware shadows; shared primary buttons use a small blue shadow. Selected source tabs sit on a surface with the shared shadow. Welcome action rows and the welcome form container are flat, using fill and borders instead; their child controls retain their shared shadows. Exact shadows live in the sidecar; shared field focus rings remain defined in the shared stylesheet.

## Shapes

- Shared controls use the control radius; smaller controls use the small radius.
- Shared cards use the card radius; badges are pills.
- Welcome action rows and form containers use the welcome-card radius. The final continuation link uses its smaller dedicated radius.
- Thin borders separate cards, fields, and dividers. These are existing roles, not a new shape scale.

## Components

### Buttons

- Shared primary: compact, semibold, gradient-filled, with a blue shadow; hover brightens. Shared default: pale fill and blue text; hover darkens slightly.
- Disabled controls reduce opacity (0.5) and use a blocked cursor.
- Welcome actions: a filled Create database row and an outlined Open existing database row, with Lucide icons, explanatory copy, and right arrows. Keyboard focus uses a visible welcome-colored outline (3px) offset by (5px).
- Welcome entry motion is brief (240ms); reduced-motion preferences disable it and action transitions.

### Cards / Containers

Shared cards use a surface fill, border, shadow, and card padding. Welcome forms override only their container radius, padding, and shadow. The primary welcome actions are buttons, not generic reusable content cards.

### Inputs / Fields

Shared fields use surface fill, a thin border, and the control radius. Focus changes the border to primary blue with the existing ring. Welcome uses the same fields and existing error presentation.

### Navigation

The compact app header uses a surface background and bottom border. The source picker uses three equal tabs for Local file, Dropbox, and Google Drive; the selected tab receives a surface fill, primary text, and shared shadow. The welcome header is its own spacious brand frame.

### Badges

Small semibold pills use primary tint/text; danger and connected-account variants use their existing status tokens.

### Asset provenance

Welcome content uses the unchanged repository logo `public/icon-128.png`, displayed at (34×34px). Origin: pre-existing QuickKee asset; no generated shipping raster was added. SHA-256: `6b59a6eb350ba96af0f71a41402d22cf21db323663656a0d93d22c107fedc4c9`. Other welcome symbols are Lucide SVGs.

## Do's and Don'ts

### Do:

- Do reuse shared database creation and unlock components.
- Do inherit theme variables and preserve the existing QuickKee logo.
- Do keep the larger welcome geometry and contrast overrides scoped to the welcome page.

### Don't:

- Don't replace the incumbent blue palette or system font based on this welcome extension.
- Don't apply the welcome column, large action rows, or flat form container to every extension surface.
- Don't treat documentation previews as new runtime palette tokens.
