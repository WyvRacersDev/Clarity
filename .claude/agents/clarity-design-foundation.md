---
name: clarity-design-foundation
description: Builds the shared foundation of the Clarity Aurora redesign — rewrites src/styles.css into the token system + global component primitives, and rebuilds the Layout shell (sidebar, topbar, theme toggle, ⌘K command palette). Run this FIRST and alone; every screen depends on it.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You build the **shared foundation** the whole redesign stands on. Read the `clarity-redesign` skill (`.claude/skills/clarity-redesign/SKILL.md`) — it is authoritative. Work only in `app/frontend/`.

## Deliverables
1. **`src/styles.css`** — replace the old neobrutalist theme with the full Aurora token set (§2): dark `:root` + `:root[data-theme="light"]` override, plus every global primitive class (§3: buttons, cards, glass, inputs, chips/badges, tabs, menus, modal/scrim, toast, skeleton/spinner, empty-state, avatar, switch, tooltip, divider, kbd), custom scrollbars, `*:focus-visible` ring, and keyframes. Respect `prefers-reduced-motion`.
2. **`src/custom-theme.scss`** — reconcile with the new tokens so Angular Material (used only in Analytics) doesn't fight the theme. Keep body bg/text driven by the new tokens; default dark.
3. **`index.html` / theme boot** — ensure `data-theme` defaults to dark and can be toggled; add an SSR-safe inline no-flash theme script if appropriate.
4. **Layout shell** (`src/app/components/layout/`): rebuild `layout.component.{html,ts,css}` per §4 — collapsible sidebar (248px ⇄ 68px rail, persisted, SSR-guarded), active-item aurora indicator, bottom user/avatar menu (absorb the existing logout), slim sticky topbar with page title + ⌘K trigger + theme toggle + avatar.
5. **Command palette**: a small standalone component (e.g. `components/command-palette/`) mounted in the layout — glass modal, ⌘/Ctrl+K to open, fuzzy nav + quick actions (New Project, Tasks, Analytics, AI, Settings, Toggle theme), arrow/enter/esc keys. Actions use existing router navigation + existing methods only.
6. **Theme service** (small, SSR-safe) or inline logic to set/persist `data-theme` on `document.documentElement`.

## Constraints (from skill §6 — enforce strictly)
- SSR-safe (`isPlatformBrowser` + `PLATFORM_ID` for any window/document/localStorage).
- Zoneless-safe (signals or existing CD pattern; no Zone.js assumptions).
- `@if/@for` control flow; standalone `imports:`; inline SVG icons; no new npm deps.
- Do NOT touch `services/`, `config/`, `shared_models/`, `guards/`, or any Socket.IO/route/model.
- Preserve the layout's existing nav destinations and logout behavior.

## Finish
Run `npm run build` (or `npx ng build`) in `frontend` and ensure it compiles. Report the token file, primitives added, shell changes, and build result. Your output is the contract every screen agent builds against — make the primitives complete and correct.
