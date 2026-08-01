# Frontend Merge — Detailed Build Tasks

Self-contained implementation guide for merging the two frontends into one.
Companion to `FRONTEND_COMPARISON_DECISIONS.md` (the "what/why"); this file is the "how".

---

## 0. Context & ground rules

Two frontends were built and compared on **visual design / UX**. The winning pieces
are being merged into a single app.

| Ref | Name | Path | Dev port |
|-----|------|------|----------|
| **A** | clarity / chat-frontend | `/Users/mohammadhamzaiqbal/Documents/clarity/angular+socket/chat-frontend` | 4201 |
| **B** | clarity2 / frontend | `/Users/mohammadhamzaiqbal/Documents/clarity2/frontend` | 4200 |

**Build base = A.** All work happens inside A; pieces are ported *from B into A*.

**Facts that shape the work:**
- The two backends (`angular+socket/socket-server/src`) are **byte-for-byte identical**. Same
  backend, running on `:3000`. No backend changes needed for this merge.
- **A** is component-based: `src/app/components/<name>/<name>.component.{ts,html,css}`, plain CSS.
- **B** is feature-based: `src/app/features/<name>/<name>-page.{ts,html,scss}`, SCSS + design tokens
  in `src/styles.scss`.
- A's routing: eager components under `LayoutComponent` at `/dashboard/*`
  (`src/app/app.routes.ts`).
- B's routing: lazy `loadComponent` under `Layout` at top level (`/dashboard`, `/tasks`,
  `/analytics`, `/contacts`, `/assistant`, `/settings`, ...).
- **A has no Contacts and no standalone Assistant screen.** In A the assistant chat is currently
  **embedded inside** `components/ai-insights/ai-insights.component.html` — Insights and Assistant
  share one screen. They must be split.
- **B has no Calendar** and no standalone AI-Insights content.

**How to run both while working (they can co-exist):**
```
# A (base you edit):   cd .../clarity/angular+socket/chat-frontend && npx ng serve --port 4201
# B (reference only):  cd .../clarity2/frontend                    && npx ng serve --port 4200
# backend:             already on :3000 (identical for both)
```

**Definition of done for the whole merge:** A builds clean (`npx ng build`), every screen below
matches its decision, light+dark both work, and no Socket.IO/route/data regressions.

---

## Task index

- **T1** — Global: design tokens (font size from B, font color from A) + light/dark theme toggle
- **T2** — Global: Sidebar (from B, icons from A, custom order)
- **T3** — Global: Navbar / topbar (from B)
- **T4** — Global: Logout from BOTH avatars (top-right + bottom-left)
- **T5** — Login screen (A base + B card recolored + B logo centered + bold creators + sound/song)
- **T6** — Dashboard (A, unchanged)
- **T7** — Projects screen (from B)
- **T8** — Tasks & Calendar (A base + B search bar / boxes / "All projects" pill)
- **T9** — Analytics (B base + A chart cards)
- **T10** — Split AI Insights into its own screen (A)
- **T11** — Assistant as its own screen (A) + B's extra buttons
- **T12** — Contacts (port entirely from B)
- **T13** — Settings (B base + A sidebar as in-page scroll nav)
- **T14** — Editor / Canvas (A, unchanged)
- **T15** — Final build + both-theme + regression pass

Suggested order: **T1 → T2 → T3 → T4** (foundation), then screens **T5–T14** (parallel-safe), then **T15**.

---

## T1 — Global design tokens + theme toggle
**Goal:** One token system for the merged app. **Font size = B**, **font color = A**, and a working
**light/dark toggle** (B has one; A is dark-only).

**Sources**
- B tokens: `clarity2/frontend/src/styles.scss` (font sizes, spacing, the `--text-*` vars, light/dark blocks).
- A colors: `chat-frontend/src/styles.css` + `chat-frontend/src/styles/_variables.scss`.

**Target (A):** `chat-frontend/src/styles.css` (+ `src/styles/_variables.scss`).

**Steps**
1. Adopt **B's font-size scale** (base size, headings, `fs-sm`, line-heights) into A's tokens.
2. Keep **A's text/foreground colors** (the font colors) — do not take B's text colors.
3. Add a **theme system**: `:root` (dark, A's current look) + a `[data-theme="light"]` (or `.light`)
   block. Port B's light-mode variable values as the light theme.
4. Ensure a `themeService`/toggle sets the attribute on `<html>`/`<body>` and persists to
   `localStorage`. Reuse B's toggle logic (`clarity2/frontend/src/app/layout/*` has the sun/moon toggle).
5. SSR-safe: guard any `document`/`window`/`localStorage` access (A uses Angular SSR — see `server.ts`).

**Done when:** toggling theme flips the whole app light/dark, persists on reload, and text uses A's
colors at B's sizes.

---

## T2 — Sidebar (from B, icons from A, custom order)
**Goal:** Use **B's sidebar** design, but with **A's icons**, and this order:
`Dashboard → Projects → Tasks → Analytics → Insights → Assistant → Contacts → Settings`
(**Analytics before Insights and Assistant** — that's the one reordering vs B's default).

**Sources**
- B sidebar markup/style: `clarity2/frontend/src/app/layout/layout.{html,scss,ts}`.
- A icons: `chat-frontend/src/app/components/layout/layout.component.html` (current nav icons).

**Target (A):** `chat-frontend/src/app/components/layout/layout.component.{html,css,ts}`.

**Steps**
1. Recreate B's sidebar visual structure in A's `layout.component.html`.
2. Swap in A's icon set for each nav item.
3. Set nav item order exactly as above. Wire each `routerLink` to A's routes
   (`/dashboard`, `/dashboard/projects`, `/dashboard/tasks`, `/dashboard/analytics`,
   `/dashboard/ai-insights`, `/dashboard/assistant` [new, T11], `/dashboard/contacts` [new, T12],
   `/dashboard/settings`).
4. Keep active-route highlighting.

**Done when:** sidebar looks like B, uses A's icons, and items appear in the specified order.

---

## T3 — Navbar / topbar (from B)
**Goal:** Use **B's top navbar** (the top bar with search + theme toggle + avatar).

**Source:** B's topbar within `clarity2/frontend/src/app/layout/layout.html` (top region).
**Target (A):** `chat-frontend/src/app/components/layout/layout.component.{html,css}`.

**Steps**
1. Port B's topbar layout into A's layout shell.
2. Include the theme toggle (T1) and the top-right avatar (T4).
3. Preserve A's ⌘K command palette trigger if present (`components/command-palette`).

**Done when:** the top bar matches B and contains working search, theme toggle, and avatar menu.

---

## T4 — Logout from BOTH avatars
**Goal:** The user avatar ("D" for Demo) appears in **two** spots — **top-right** of the navbar and
**bottom-left** of the sidebar. **Both** must open a menu with a working **Log out**.

**Target (A):** `chat-frontend/src/app/components/layout/layout.component.{html,ts}`.

**Steps**
1. Add a click menu to the **top-right** avatar with a **Log out** action.
2. Add the same to the **bottom-left** sidebar avatar.
3. Both call the existing auth/logout path (see `chat-frontend/src/app/services` auth service +
   `guards/auth.guard.ts`), clear session, and route to `/login`.

**Done when:** clicking either avatar lets you log out and lands on the login screen.

---

## T5 — Login screen
**Goal:** Keep **A's login page** as the base with these changes:
1. **Bold** the creators' names in the footer (`Bilal Kashif · Mohammad Hamza Iqbal · Mawahid Abbas`).
2. Replace A's logo with **B's Clarity logo** (the clock mark) and **center** it.
3. Add a **sound / mute icon** that plays the **Clarity welcome song on app start**, mutable via the icon.
4. Replace A's sign-in card with **B's login card**, but **recolored to A's palette** (B's structure, A's teal).

**Sources**
- A login: `chat-frontend/src/app/components/welcome/welcome.component.{html,css,ts}`.
- B login card: `clarity2/frontend/src/app/features/auth/auth-page.{html,scss}` (the right-side card).
- B logo (clock mark): from B's layout/auth header; assets under `clarity2/assets` / B `public`.
- Song: **already present** at `chat-frontend/public/assets/welcome-music.mp3`.

**Steps**
1. In `welcome.component.html`, wrap the creator names in `<strong>` (or a bold class).
2. Swap the logo element for B's clock mark; center it (flex/justify-center at top of the panel).
3. Add an audio element + a mute/unmute icon button. On the welcome view init, attempt autoplay of
   `assets/welcome-music.mp3` (respect browser autoplay rules — start muted-or-prompt if blocked);
   icon toggles play/mute and persists preference. SSR-guard `Audio`/`window`.
4. Replace the sign-in/register card markup with B's `auth-page` card, then restyle it with A's
   colors (teal buttons/accents, A's surfaces). **Keep A's auth handlers/bindings** — only the card's
   markup/skin changes, not its logic.

**TODO to resolve here:** open B's `auth-page.html` and copy the exact card markup to recolor.

**Done when:** login shows centered B clock logo, bold creators, a working mute icon + welcome song,
and B's card in A's colors — with A's login logic intact.

---

## T6 — Dashboard
**Goal:** **From A, entirely.** No change.
**Files (A):** `chat-frontend/src/app/components/dashboard/*`.
**Done when:** dashboard renders exactly as A does today (verify after global T1–T4).

---

## T7 — Projects screen
**Goal:** **From B.** Bring B's Projects screen design into A.

**Sources**
- B: `clarity2/frontend/src/app/features/dashboard/projects-page.{html,scss,ts}`.
- A target: `chat-frontend/src/app/components/projects/projects.component.{html,css,ts}`
  (route `/dashboard/projects`).

**Steps**
1. Recreate B's projects layout/markup in A's `projects.component.html` + port styles to
   `projects.component.css` (convert SCSS → CSS or add SCSS support).
2. Keep A's data source, click handlers, and navigation into project detail
   (`/dashboard/projects/:id`, `ProjectDetailComponent`).

**Done when:** Projects list looks like B and still opens A's project detail/canvas.

---

## T8 — Tasks & Calendar
**Goal:** **A base** (A has both Tasks **and** Calendar; B has no calendar). Layer on **B's** search bar,
bordered card boxes, and the **"All projects" pill dropdown**. **Calendar stays from A.**

**Sources**
- A: `chat-frontend/src/app/components/tasks/tasks.component.{html,css,ts}`.
- B accents: `clarity2/frontend/src/app/features/tasks/tasks-page.{html,scss}`
  (search bar "Search tasks…", the rounded bordered content boxes, and "All projects" pill).

**Steps**
1. Keep A's Tasks + Calendar structure and logic.
2. Replace A's task search input with **B's rounded search bar** ("Search tasks…" + magnifier).
3. Wrap content sections in **B's bordered card boxes** (soft rounded borders).
4. Add **B's "All projects" pill dropdown** (folder icon + chevron) for project filtering; wire to A's
   existing project filter state.

**Done when:** Tasks shows B's search bar + boxes + "All projects" pill, and A's calendar still works.

---

## T9 — Analytics
**Goal:** **B base**, but the **chart cards** ("Tasks per day", "Completion rate") come from **A**
(clean white cards with the teal left-accent title bar).

**Sources**
- B shell: `clarity2/frontend/src/app/features/analytics/analytics-page.{html,scss,ts}`.
- A cards: `chat-frontend/src/app/components/analytics/analytics.component.{html,css,ts}`.

**Steps**
1. Adopt B's analytics page shell/layout in A's `analytics.component.html`.
2. For the individual chart cards, use **A's** card design (teal left-accent title bar, empty/loading
   states like "Select a tag to chart" / "Loading chart data…").
3. Keep A's analytics data wiring (`analytics.service` / `getCompletedPerDay`, `getCompletionRateByTag`).

**Done when:** Analytics uses B's overall layout but A-styled chart cards, with A's data intact.

---

## T10 — Split AI Insights into its own screen
**Goal:** In A, Insights and Assistant currently **share** `ai-insights.component`. Split them.
Insights keeps its own screen (route `/dashboard/ai-insights`): the colored top-accent cards
**INSIGHTS** (blue), **BOTTLENECKS** (orange), **SUGGESTIONS** (green).

**Files (A):** `chat-frontend/src/app/components/ai-insights/ai-insights.component.{html,css,ts}`.

**Steps**
1. In `ai-insights.component.html`, **remove the assistant/chat block** (moves to T11).
2. Keep only the Insights/Bottlenecks/Suggestions cards + their data.
3. Ensure the route `/dashboard/ai-insights` renders just the insights cards.

**Done when:** `/dashboard/ai-insights` shows only the three colored cards, no chat.

---

## T11 — Assistant as its own screen (+ B's extra buttons)
**Goal:** Move A's chat into a **new standalone Assistant screen** ("AI Assistant · Ready to help",
"Aurora AI" badge, `@`-to-invoke input), and **add the action buttons from B's assistant that A lacks**.

**Sources**
- Chat markup/logic to extract: the assistant block currently in
  `chat-frontend/src/app/components/ai-insights/ai-insights.component.html` (+ its TS handlers).
- B assistant (for the extra buttons): `clarity2/frontend/src/app/features/assistant/assistant-page.{html,scss,ts}`,
  plus `chat-input.ts`, `chat-message.ts`, `suggestion-card.ts`.

**Steps**
1. Create `chat-frontend/src/app/components/assistant/assistant.component.{ts,html,css}`.
2. Move the chat markup + handlers out of `ai-insights.component` into it. Keep the AI/socket wiring
   (`services/ai.service.ts`).
3. Add a route `{ path: 'assistant', component: AssistantComponent }` under the `dashboard` children
   in `chat-frontend/src/app/app.routes.ts`; add sidebar link (T2).
4. **Compare B's assistant to A's** and add the buttons B has that A doesn't.
   **TODO (identify at build time):** diff B's `assistant-page.html` action buttons vs A's chat toolbar
   and port the missing ones (likely service/`@`-command quick buttons, suggestion cards).

**Done when:** `/dashboard/assistant` is its own chat screen with A's chat logic + B's extra buttons.

---

## T12 — Contacts (port entirely from B)
**Goal:** **A has no Contacts.** Port B's Contacts screen in wholesale.

**Sources (B):** `clarity2/frontend/src/app/features/contacts/`:
`contacts-page.{html,scss,ts}`, `contact-row.ts`, `import-contacts-button.ts`.

**Steps**
1. Create `chat-frontend/src/app/components/contacts/contacts.component.{ts,html,css}` mirroring B's
   contacts page (fold `contact-row` / `import-contacts-button` in as needed).
2. Wire it to the backend contacts data over A's Socket.IO/services (backend is identical, so the
   contract matches — reuse B's service calls / event names).
3. Add route `{ path: 'contacts', component: ContactsComponent }` under `dashboard` children; add
   sidebar link (T2).

**Done when:** `/dashboard/contacts` shows B's contacts UI with working data + import.

---

## T13 — Settings (B base + A sidebar as in-page scroll nav)
**Goal:** Settings **entirely from B**, but add **A's settings sidebar** — and the sidebar items just
**scroll to that section on the same page** (in-page anchor nav), **not** separate screens/routes.

**Sources**
- B settings: `clarity2/frontend/src/app/features/settings/settings-page.{html,scss,ts}`,
  `google-connect-card.ts`, `setting-toggle.ts`.
- A settings sidebar (SETTINGS: Profile, Integrations, Server, Appearance):
  `chat-frontend/src/app/components/settings/settings.component.{html,css}`.

**Steps**
1. Bring B's settings content/sections into A's `settings.component`.
2. Add A's left settings sidebar (Profile / Integrations / Server / Appearance style).
3. Make each sidebar item a **scroll-to-section** link (anchor / `scrollIntoView`) targeting the section
   on the **same page** — no route change, no separate screen.
4. Optional: highlight the active section on scroll.

**Done when:** one Settings page shows B's content with A's sidebar; clicking a sidebar item smoothly
scrolls to that section.

---

## T14 — Editor / Canvas
**Goal:** **From A, entirely.** No change.
**Files (A):** `chat-frontend/src/app/components/projects/project-detail/*` (canvas/editor + realtime).
**Done when:** the canvas/editor works exactly as A does today (realtime collab intact).

---

## T15 — Final build + verification
**Steps**
1. `cd chat-frontend && npx ng build` — must compile with no errors.
2. Run `npx ng serve --port 4201` and click through every screen in **both light and dark**.
3. Verify: sidebar order (Analytics before Insights/Assistant), logout from both avatars, login song +
   mute, new routes (`/dashboard/assistant`, `/dashboard/contacts`) work, no console errors, no
   Socket.IO/data regressions (canvas realtime, tasks, contacts, analytics all load).

**Done when:** all of the above pass.

---

## Open TODOs to resolve during implementation
- **T5:** copy B's exact `auth-page.html` card markup, then recolor to A's palette.
- **T11:** diff B's assistant action buttons vs A's and port the ones A is missing.
- **T1/T7/T9/T12/T13:** B uses SCSS + tokens; A uses plain CSS. Either convert B's SCSS to CSS when
  porting, or enable SCSS in A's build. Decide once, apply consistently.
