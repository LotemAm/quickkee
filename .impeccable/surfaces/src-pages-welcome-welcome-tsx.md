---
version: 1
slug: "src-pages-welcome-welcome-tsx"
primary_target: "src/pages/welcome/Welcome.tsx"
related_targets: ["src/pages/welcome/index.css","src/pages/welcome/index.html"]
---

# First-install welcome examples

- Mode: Operate. A browser tab shown after installation, designed for KeePass beginners.
- Scope: implement the selected Focused welcome in a full browser tab on first installation. Reuse the shared database creation and unlock flows.
- Inherit QuickKee's blue palette, system typography, existing logo, and local/cloud database capabilities.
- Use a light surface for an ordinary daytime desktop browser session. Each example is responsive.
- Primary task: create a database; secondary task: open an existing one. KeePass explanation stays brief.
- Grounded structural list: (1) minimal centered buttons; (2) parallel task cards; (3) explanation and setup form; (4) vertical file explanation and actions; (5) explanatory sidebar and task area; (6) split introduction and database demonstration; (7) centered action rows and short explainer.
- Presented structures: 6 (Split welcome), 7 (Focused welcome), 5 (Guided welcome).
- Seed reference: seed:d73312a1ff041a21.
- Selection: Focused welcome (example 2), explicitly approved by the user.
- Evidence: inspected the installed-build popup and current source tokens; database capabilities checked against current source and README. KeePass wording verified against https://keepass.info/.

## Direction contract

THESIS: Make the first database decision immediately legible in one centered column. Avoid a marketing landing page or a multi-step explanatory tour.

OWN-WORLD: Preserve QuickKee's pale-blue ground, slate system sans typography, blue primary action, white secondary action, existing logo, and Lucide icons. Honor the existing light/dark theme setting. Use scoped welcome styles, with no global theme replacement.

STORY: A beginner understands that KeePass stores passwords in an encrypted database and that QuickKee uses that database in the browser. They create a database or open an existing local/cloud database through the existing shared components, then enter QuickKee.

FIRST VIEWPORT: At 1440×900, a slim branded header frames a 544px central column. A small lock mark sits above a 40px welcome heading, followed by a one-line introduction. Two 102px full-width action rows lead with Create database, then Open existing database. A short KeePass explanation and official link sit below a fine divider. On narrow screens the column uses available width without horizontal scrolling. The signature interaction replaces the choices with the selected shared form in the same column, with a clear route back.

FORM: Centered action rows and short explainer; grounded structural candidate 7; seed:d73312a1ff041a21. Code-led implementation matching .impeccable/mocks/decision/focused.html.

FINISH: complete. A full surface review found one contrast issue; the subsequent scoped contrast fix was scored resolved with disposition ship. This is not a second whole-surface review. DESIGN.md and .impeccable/design.json record the incumbent system and scoped welcome extension. The existing, unchanged public/icon-128.png is the welcome content raster; its repository origin and SHA-256 are recorded in DESIGN.md. Production create/lock/reopen of an encrypted KDBX was verified; 69 test files / 1031 tests, 4 E2E tests, lint, and both type checks passed.
