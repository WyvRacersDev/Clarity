# Clarity — Design System (v2)

The visual + interaction language of the Clarity web app. Source of truth is
`src/styles.css` (tokens + primitives); this file records the decisions behind it.

## Identity

Built from the **Zedd _Clarity_ album cover** — a luminous iris of light glowing
through cracked cool-dark glass. The palette is drawn straight from it:
**violet → blue → cyan → teal → green**.

- **Cyan (`--accent`, `#17C4CE` dark / `#0FA8B2` light) is the single lead** —
  primary actions, active nav, focus rings, brand, the one glowing moment.
- The other hues (`--accent-violet / -blue / -teal / -green / -lime`, each with a
  `-soft` companion) appear **only where data or categories must be told apart**
  (chart series, canvas element-types, category tints) — never as decoration.
- **Two themes, both first-class.** Dark is the designed default (the album's
  natural home — cool-slate surfaces, luminous accents); light is a crisp cool
  off-white companion (deliberately not warm cream, so the cyan stays clean).
  Every color is a semantic token that flips via `:root` / `:root[data-theme]`.

## Palettes (two colour worlds)

Colour is a **second axis, orthogonal to light/dark**. `data-palette` on
`<html>` selects the world; the topbar toggle still flips `data-theme` within it.
Both persist to `localStorage` and boot with no flash (`index.html` + `ThemeService`).
The picker lives in **Settings → Appearance → Palette**.

- **Regular** (`data-palette="regular"`, **the default**) — an earthy, green-forward
  world from a five-colour set: Frozen Water `#C9EDDC`, Olive Leaf `#606C38`,
  Coffee Bean `#220C10`, Black Forest `#283618`, Lime Cream `#CEF7A0`.
  - _Dark_ = "forest floor at night": surfaces built on Black Forest over a
    coffee-deep well; **Lime Cream (`#CEF7A0`) is the single glow** (focus rings,
    active nav, brand). _Light_ = "sunlit meadow" on pale green-white paper; the
    accent deepens to Olive so it works as a fill.
  - **Buttons are never Lime Cream.** Primary-button fill is decoupled from the
    accent via `--btn-primary-bg` / `--btn-primary-fg` — a solid, readable
    olive-leaf (`#567A28`, ≥4.5:1 with the cream label) in dark; the deep-olive
    accent in light. Lime Cream stays for glows/nav/focus only.
- **Clarity** (`data-palette="clarity"`) — the original album-iris cyan world
  described under Identity, preserved pixel-for-pixel in both themes.

The album spectrum tokens (`--accent-blue/-teal/-green/-lime/-violet`) exist in
**both** palettes so charts, canvas element-types, and category chips stay
distinguishable; in Regular they are earth analogues (mint/leaf/olive).

## Type

- **Hanken Grotesk** — all UI text (`--font-sans`). A warm neo-grotesque, chosen
  over the defaulted Inter.
- **Spline Sans Mono** — numbers, dates, counts, and small tracked metadata
  labels (`--font-mono`). Data reads as data.
- Utilities: `.display` (heavy, tight hero headlines), `.num`/`.data` (tabular
  mono figures), `.mono-label` (uppercase tracked metadata — never a kicker).
- Loaded in `src/index.html`.

## Grammar (the anti-AI rules)

Depth comes from **light + 1px hairline borders + soft shadows**, not from glow or
glass everywhere. Deliberately avoided:

- No rows of identical icon + big-number stat cards. Numbers live in a running
  summary line and a **ruled index strip** (see `dashboard` `.db-index`).
- No sparklines, progress rings, or soft-shadow rounded rectangles as filler.
- No eyebrow / kicker labels above headings — headings carry their own weight.
- No gradients on UI (only background-layer radial "iris" glow textures).
- No decorative glass/blur — `.glass` is reserved for the command palette,
  overlays, floating canvas toolbar, and toasts.
- One authored motion moment per screen; smooth ease-out (`--ease-spring` is a
  gentle ease-out-expo, no dated bounce). `prefers-reduced-motion` respected
  globally.

## Structure

- **Tokens** — `src/styles.css` `:root` (dark default) + `:root[data-theme="light"]`.
  Surfaces/glass are frozen; accents + type are the identity.
- **Primitives** (global classes): `.btn*`, `.card`, `.panel`, `.glass`, `.input`
  / `.textarea` / `.select` / `.field`, `.chip`, `.badge*`, `.tabs`/`.tab`,
  `.menu`, `.scrim`/`.modal`, `.toast`, `.skeleton`/`.spinner`/`.empty-state`,
  `.avatar`, `.switch`, `.tooltip`, `.divider`, `.kbd`.
- **Shell** (`components/layout`): sidebar spine with a background "iris" glow,
  luminous active nav, slim sticky topbar, ⌘K command palette, theme toggle.
- Reference screen for the grammar: **`components/dashboard`** (editorial masthead
  → ruled index strip → agenda + projects rail).

## Engineering constraints

Angular 21 standalone + **zoneless** + **SSR**. `@if/@for` with `track`. All
`window`/`document`/`localStorage`/`navigator`/`Audio` access guarded by
`isPlatformBrowser(PLATFORM_ID)`. Style only with the tokens/primitives above —
no hardcoded hex/px colors. No new npm deps for styling; inline SVG icons only
(stroke 1.75, `currentColor`). The redesign is visual-layer only: it never
changes Socket.IO events, service signatures, models, routes, or auth.
