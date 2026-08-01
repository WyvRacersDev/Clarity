---
name: clarity-redesign
description: The "Clarity" design system — the single source of truth for the ground-up UI/UX redesign of the Clarity Angular web app. Load this before building or reviewing any redesigned screen so tokens, primitives, motion, and per-screen intent stay cohesive.
---

# Clarity — Design System & Redesign Contract

A ground-up visual + interaction redesign of the Clarity web app. This document is the **contract**: every screen is rebuilt against these tokens, primitives, and principles so nine independently-built screens still feel like one product. If something is ambiguous, prefer the choice that is calmer, more spacious, and more consistent with the rest of this doc.

> **This is a visual/interaction-layer redesign only.** It rewrites component **templates (HTML)** and **CSS**, and lightly adjusts component **TS** where new markup needs new local UI state (toggles, panel open/closed). It must **NOT** change: Socket.IO event names/payloads, service method signatures, shared data models, routes, or auth flow. Every `(click)`, `[binding]`, `@if/@for`, and form control in new markup must map to an **existing** handler/field on the component. CSS class names may be renamed freely.

---

## 1. Design identity

**Clarity** — a calm, focused, premium productivity surface inspired by the Zedd "Clarity" album. The reference points are Linear's precision, Figma's craft, and Notion's warmth. Dark cool-slate backgrounds anchor every screen; solid accent colors drawn from the album's spectrum give it energy without noise.

- **Layered depth, not hard edges.** Soft multi-layer shadows, subtle 1px borders, gentle elevation. No hard `Npx Npx 0` offset shadows.
- **Solid accent palette, no gradients.** The primary accent is luminous cyan `--accent` (#17C4CE). A multi-hue album spectrum — `--accent-blue`, `--accent-teal`, `--accent-green`, `--accent-lime` — is distributed across dashboard cards, canvas element-types, chart series, project covers, and status chips. All are **solid** CSS variables; no `linear-gradient` or `conic-gradient` anywhere in the UI (the existing dot-grid `radial-gradient` textures are background-layer only and stay).
- **Cool-slate surfaces, unchanged.** The dark backgrounds (`--bg-app`, `--bg-sunken`) and slate surfaces (`--surface-1/2/3`, `--surface-hover`, `--glass-bg`) are a deliberate design choice and must never be altered.
- **Logo = album cover.** The brand mark at the top of the sidebar is the Zedd Clarity album cover image, not a text wordmark.
- **Generous, quiet space.** Let content breathe. Bigger padding, clear hierarchy, restrained borders.
- **Motion with intent.** Every interactive element responds: hover lifts, focus rings, 120–260ms eased transitions, spring-in modals, skeletons while loading, toasts for feedback.
- **Dual theme.** Dark is the default; a real light theme ships too. All colors come from semantic tokens so both themes work with zero per-component overrides.

### Accent spectrum usage guide
| Token | Hex (dark) | Typical use |
|---|---|---|
| `--accent` | #17C4CE | Primary actions, active nav, focus rings, CTA buttons, brand moments |
| `--accent-blue` | #2E6FB0 | Dashboard stat cards, info badges, chart series 1 |
| `--accent-teal` | #1FB6AE | Canvas text/note elements, chart series 2, integration chips |
| `--accent-green` | #34C471 | Success states, completion chips, canvas todo elements, chart series 3 |
| `--accent-lime` | #86C540 | Project covers accent, canvas image elements, chart series 4, tag chips |

Each accent ships with a `-soft` companion (e.g. `--accent-blue-soft`) for background tints on badges, chips, and card accents. Always use the CSS variable — never a hardcoded hex.

---

## 2. Design tokens (authoritative)

Define **all** of these as CSS custom properties in `src/styles.css` on `:root` (dark = default) with a `:root[data-theme="light"]` override block. Screens reference **only these variables** — never hardcode hex. **Background/surface tokens are frozen** — do not propose or apply changes to them.

### Color — dark (default, `:root`)
```
/* Surfaces (low → high elevation) — dark cool-slate, album cast — DO NOT CHANGE */
--bg-app:        #0A0F12;   /* app canvas / body */
--bg-sunken:     #06090B;   /* wells, canvas backdrop */
--surface-1:     #0F161A;   /* cards, sidebar */
--surface-2:     #141D22;   /* raised cards, menus */
--surface-3:     #1B262C;   /* popovers, inputs, hover */
--surface-hover: #212E35;
/* Borders / lines */
--border:        rgba(210,240,244,0.08);
--border-strong: rgba(210,240,244,0.15);
--border-focus:  #19C6D0;   /* cyan-tinted focus border */
/* Text (cool white) */
--text-primary:  #EAF6F7;
--text-secondary:#A4B6BB;
--text-muted:    #647B81;
--text-inverse:  #06090B;
/* Brand / accent — luminous cyan primary */
--accent:        #17C4CE;   /* PRIMARY — luminous cyan */
--accent-hover:  #34DBE4;
--accent-press:  #10AAB3;
--accent-soft:   rgba(23,196,206,0.14);
--accent-ring:   rgba(23,196,206,0.45);
/* Zedd Clarity album accent spectrum (all SOLID — no gradients) */
--accent-blue:      #2E6FB0;  --accent-blue-soft:  rgba(46,111,176,0.14);
--accent-teal:      #1FB6AE;  --accent-teal-soft:  rgba(31,182,174,0.14);
--accent-green:     #34C471;  --accent-green-soft: rgba(52,196,113,0.14);
--accent-lime:      #86C540;  --accent-lime-soft:  rgba(134,197,64,0.14);
/* --aurora aliases resolve to --accent (solid) for backward compat */
--aurora:      var(--accent);
--aurora-soft: var(--accent-soft);
/* Semantic */
--success: var(--accent-green);  --success-soft: rgba(52,196,113,0.14);
--warning: #F5B54B;              --warning-soft: rgba(245,181,75,0.14);
--danger:  #F16A6A;              --danger-soft:  rgba(241,106,106,0.14);
--info:    var(--accent-blue);   --info-soft:    rgba(46,127,204,0.14);
/* Glass (overlays, command palette, floating toolbars) — DO NOT CHANGE */
--glass-bg:     rgba(13,20,24,0.72);
--glass-border: rgba(255,255,255,0.10);
--glass-blur:   18px;
```

### Color — light (`:root[data-theme="light"]`)
```
/* Surfaces — DO NOT CHANGE */
--bg-app:#F1F6F7; --bg-sunken:#E5EEEF; --surface-1:#FFFFFF; --surface-2:#FFFFFF;
--surface-3:#EEF4F5; --surface-hover:#E4EFF0;
--border:rgba(10,30,34,0.09); --border-strong:rgba(10,30,34,0.16); --border-focus:#0FA8B2;
--text-primary:#0E1B1F; --text-secondary:#43555B; --text-muted:#7C8B90; --text-inverse:#FFFFFF;
/* Brand / accent — slightly deeper for light-mode contrast */
--accent:#0FA8B2; --accent-hover:#14BEC9; --accent-press:#0C929B;
--accent-soft:rgba(15,168,178,0.10); --accent-ring:rgba(15,168,178,0.35);
/* Album spectrum — deeper values for light-mode contrast */
--accent-blue:#2A67A8;  --accent-blue-soft:rgba(42,103,168,0.12);
--accent-teal:#148E95;  --accent-teal-soft:rgba(20,142,149,0.12);
--accent-green:#1FA46A; --accent-green-soft:rgba(31,164,106,0.12);
--accent-lime:#6FA82F;  --accent-lime-soft:rgba(111,168,47,0.12);
--aurora:var(--accent); --aurora-soft:var(--accent-soft);
--success:var(--accent-green); --warning:#C98A1E; --danger:#DC5757; --info:var(--accent-blue);
--success-soft:rgba(31,164,106,0.12); --warning-soft:rgba(201,138,30,0.12);
--danger-soft:rgba(220,87,87,0.12);  --info-soft:rgba(44,111,190,0.12);
/* Glass — DO NOT CHANGE */
--glass-bg:rgba(255,255,255,0.74); --glass-border:rgba(10,30,34,0.10); --glass-blur:18px;
```

### Space / radius / type / motion / z
```
--space-1:4px; --2:8px; --3:12px; --4:16px; --5:20px; --6:24px; --8:32px; --10:40px; --12:48px; --16:64px;
--radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-xl:20px; --radius-2xl:28px; --radius-full:999px;
--font-sans:'Inter',system-ui,-apple-system,sans-serif; --font-mono:'JetBrains Mono',ui-monospace,monospace;
/* type scale (font-size / line-height / weight) */
--text-xs:12px; --text-sm:13px; --text-base:14px; --text-md:15px; --text-lg:18px; --text-xl:22px; --text-2xl:28px; --text-3xl:36px;
/* Base body: 14px, line-height 1.55, letter-spacing -0.011em. Headings: -0.02em, weight 600–700. */
--shadow-xs:0 1px 2px rgba(0,0,0,0.20);
--shadow-sm:0 2px 8px rgba(0,0,0,0.24);
--shadow-md:0 8px 24px rgba(0,0,0,0.28);
--shadow-lg:0 18px 48px rgba(0,0,0,0.40);
--shadow-glow:0 0 0 1px var(--accent-ring), 0 8px 32px rgba(23,196,206,0.30);
--ease:cubic-bezier(0.22,0.61,0.36,1); --ease-spring:cubic-bezier(0.34,1.56,0.64,1);
--dur-fast:120ms; --dur:180ms; --dur-slow:260ms;
--z-nav:100; --z-sticky:200; --z-panel:300; --z-modal:1000; --z-toast:1100; --z-cmdk:1200;
```
(Light theme keeps the same shadow scale but lighter: `--shadow-md:0 8px 24px rgba(20,24,40,0.10)` etc. — the foundation agent tunes these.)

---

## 3. Component primitives (global classes in `styles.css`)

Build these once as global classes so every screen is consistent. Each must work in both themes and be SSR-safe (no JS required to render).

- **Buttons** `.btn` + `.btn-primary` (`--accent` solid fill, white text, lift on hover), `.btn-secondary` (surface-2 + border), `.btn-ghost` (transparent, hover surface), `.btn-danger`, `.btn-icon` (square, icon-only), `.btn-sm` / `.btn-lg`. All: radius-md, weight 600, focus ring `box-shadow: 0 0 0 3px var(--accent-ring)`, `:active` scale 0.98, disabled 0.5 opacity.
- **Surfaces** `.card` (surface-1, 1px border, radius-lg, shadow-sm; `.card-hover` lifts + border-strong on hover), `.panel`, `.glass` (glass-bg + `backdrop-filter: blur(var(--glass-blur))` + glass-border).
- **Inputs** `.input`, `.textarea`, `.select` — surface-3 bg, 1px border, radius-md, focus → border-focus + ring. `.field` wrapper with `.field-label` + `.field-hint` + `.field-error`.
- **Chips / badges** `.chip` (pill, surface-2), `.badge` + semantic variants `.badge-success/-warning/-danger/-info/-accent` (use the `-soft` bg + solid text color).
- **Tabs** `.tabs` / `.tab` (active tab: text-primary + `--accent` solid underline bar).
- **Menu / dropdown** `.menu` (surface-2, shadow-md, radius-md), `.menu-item` (hover surface-3).
- **Modal** `.scrim` (fixed, `rgba(0,0,0,0.55)` + `backdrop-filter: blur(4px)`, fade in), `.modal` (surface-2, radius-xl, shadow-lg, spring scale-in from 0.96). `.modal-header/.modal-body/.modal-footer`.
- **Toast** `.toast` (glass, radius-md, shadow-md, slide-in from bottom-right) + semantic left accent bar.
- **Feedback** `.skeleton` (shimmer), `.spinner` (`--accent` solid border spin), `.empty-state` (centered icon-in-soft-circle + title + subtext + CTA).
- **Misc** `.avatar` (circle, `--accent-soft` fallback with initials), `.switch` (toggle), `.tooltip`, `.divider`, `.kbd` (keycap). Custom scrollbars (thin, `--border-strong` thumb). Global `*:focus-visible` ring.

Keyframes to provide: `fadeIn, scaleIn, slideUp, slideInRight, shimmer, spin, pulse`. Respect `@media (prefers-reduced-motion: reduce)` → collapse transitions/animations.

---

## 4. App-level signatures (in the Layout shell)

- **Sidebar**: collapsible left nav on `--surface-1`, 248px expanded / 68px rail (icon-only) mode with a collapse toggle. Nav items: icon + label, active item = `--accent-soft` bg + left `--accent` solid indicator bar + text-primary. Brand/logo at top (the Zedd Clarity **album cover image**). User avatar + menu pinned at bottom (replaces the inline logout). Rail state persists to `localStorage` (SSR-guarded).
- **Topbar**: slim sticky header inside the content area — page title/breadcrumb on the left; a **⌘K search/command trigger**, theme toggle (sun/moon), and notifications/avatar on the right.
- **Command palette (⌘K)**: a signature interactive element. Glass modal, fuzzy list of navigation destinations + quick actions (New Project, Go to Tasks, Toggle theme, etc.). Keyboard: ⌘/Ctrl+K to open, arrows to move, Enter to run, Esc to close. Build as a small standalone component mounted in the Layout. Actions map to existing router navigation + existing component methods only.
- **Theme toggle**: sets `data-theme` on `document.documentElement`, persists to `localStorage` (SSR-guarded), default dark.

Provide inline SVG icons (stroke 1.75, `currentColor`) — no icon-font/library dependency. A tiny set of `<svg>` snippets reused across screens is fine.

---

## 5. Per-screen creative briefs

Each builder rebuilds one screen's `.html` + `.css` (and minimal `.ts` for local UI state) against §2–4. Keep all existing data/handlers.

- **Layout shell** (`components/layout/`): §4 — sidebar + topbar + command palette + theme toggle. This is the frame every authed screen lives in.
- **Welcome / auth** (`components/welcome/`): a striking split hero — left: dark cool-slate backdrop (dot-grid texture) with the Clarity story + value props, `--accent` highlights; right: a clean glass auth card (login/register toggle, Google button, email/password). Remove the background-music gimmick unless trivially preserved. First impression = premium.
- **Dashboard** (`components/dashboard/`): a "today" command center — greeting + date, a row of stat cards (projects, tasks due, completion) each accented with a different album spectrum color (`--accent-blue`, `--accent-teal`, `--accent-green`, `--accent-lime`), an "upcoming tasks" list, and "recent projects" as rich cards with thumbnails/progress. Strong empty states.
- **Projects** (`components/projects/`): a responsive card grid of projects (cover tinted with `--accent-lime-soft` or `--accent-teal-soft`, name, meta, progress, quick actions on hover) + a prominent "New project" card/CTA. Redesign the create/delete/error modals with the new `.modal`. Optional list/grid toggle if the existing data supports it.
- **Project detail / canvas** (`components/projects/project-detail/`): the core workspace. Keep the DOM/CSS-transform canvas engine and all pan/zoom/drag/resize handlers intact — restyle it. A **floating glass toolbar** (zoom, fit, reset, grid, add-element, delete), a refined **element palette**, polished `.canvas-element` cards per type (todo/text/image/video) with clean selection + resize handles, a modern minimap, and elegant presence avatars + remote cursors. Redesign every inline modal. This is the biggest file — be surgical: restyle markup, preserve every handler binding.
- **Tasks** (`components/tasks/`): list ⇄ calendar toggle. List = grouped, checkable task rows with priority chips, due dates, tag chips. Calendar = clean month grid with task pills. Smooth toggle.
- **Analytics** (`components/analytics/`): keep chart.js/ng2-charts + the data; restyle chart cards, recolor chart series to the album accent spectrum (`--accent-blue`, `--accent-teal`, `--accent-green`, `--accent-lime` — solid, no gradients), add KPI stat cards above. Remove reliance on raw Angular Material look — wrap in `.card`s. (Material may stay functionally; restyle so it matches.)
- **AI Insights** (`components/ai-insights/`): a polished chat surface — message bubbles (user vs assistant), `--accent-soft` assistant avatar, suggestion chips using album spectrum `-soft` backgrounds, a sticky composer with send affordance, typing/loading state. Keep the existing `ai.service` call.
- **Settings** (`components/settings/`): sectioned settings with a left sub-nav or grouped cards — Profile, Integrations (Google Calendar/Contacts/Gmail connect cards), Server URL, Appearance (theme). Clean forms using `.field`/`.input`.
- **Auth callback** (`components/auth-callback/`): on-brand full-screen `--accent` spinner state.

---

## 6. Engineering constraints (non-negotiable)

1. **SSR-safe**: guard every `window`/`document`/`localStorage`/`navigator` access with `isPlatformBrowser(this.platformId)` (inject `PLATFORM_ID`). The app uses `@angular/ssr`.
2. **Zoneless**: the app runs `provideZonelessChangeDetection()`. Do not add code that assumes Zone.js auto-detects changes. Preserve the component's existing change-detection triggers (async pipe, signals, or explicit `ChangeDetectorRef`). If you add local UI state that must reflect immediately, prefer Angular **signals** or mirror the existing pattern in that file.
3. **Angular 21 control flow**: use `@if / @for / @else / @switch` (not `*ngIf/*ngFor`) in new markup; keep `trackBy`/`track`.
4. **Standalone components**: add imports to the component's own `imports:` array. Don't introduce NgModules.
5. **No contract drift**: never rename or change Socket.IO events, service methods, models, or routes. Never touch files under `services/`, `config/`, `shared_models/`, `guards/` for styling reasons.
6. **Preserve behavior**: every handler/binding in old markup must still exist in new markup (you may reorganize/rename DOM + classes). If a feature exists, it must still work.
7. **Keep per-component CSS** (that's the established pattern) but style **only** with the global tokens/classes from §2–3. No hardcoded hex/px colors.
8. **Icons**: inline SVG only; no new npm dependency, no icon fonts.
9. **Don't break the build**: `npm run build` in `frontend` must stay green. Delete dead/duplicate files only if explicitly in scope for your screen.

---

## 7. Definition of done (per screen)

- Rebuilt template + CSS use only Clarity design tokens/primitives; looks cohesive with the shell.
- Works in **both** dark and light themes.
- All original functionality/handlers preserved; SSR-guarded; zoneless-safe.
- Has hover/focus/active states, loading (skeleton/spinner) and empty states where relevant.
- No hardcoded colors; no new dependencies; Angular build compiles.
