# Frontend Comparison — Locked Decisions

Comparing two frontends on **visual design / UX**:
- **A** = `clarity/angular+socket/chat-frontend` (running :4201)
- **B** = `clarity2/frontend` (running :4200)

> Status: DECISIONS ONLY — no implementation yet.

| # | Screen | Winner | Tweaks to apply |
|---|--------|--------|-----------------|
| 1 | Login / auth | **A** | 1. **Bold** the creators' names in the footer. 2. Replace A's logo with **B's Clarity logo** (the clock mark). 3. **Center** the Clarity logo (place it in the middle). 4. **Add a sound/mute icon** that plays the **Clarity welcome song on app start** (mutable via the icon) — this was the best part of the OG login and A lacks it. mp3 already present at `chat-frontend/public/assets/welcome-music.mp3`. 5. **Use B's login card** (the right-side sign-in/register card) instead of A's — keep A's left panel/layout, swap in B's card, **but recolor the card to match A's colors** (A's palette/teal accent, B's card structure). |

| 2 | Dashboard / Home | **A** | Comes from A **entirely**. |
| 3 | Projects screen | **B** | Comes from B. |
| 4 | Tasks & Calendar | **A** (base) + B accents | Base from A (A has **both Tasks & Calendar**; B has no calendar). Take from **B**: the **search bar** ("Search tasks…"), the **boxes/bordered card containers around text**, and the **"All projects" pill dropdown**. **Calendar** stays from **A** (B lacks it). |
| 5 | Analytics | **B** (base) + A cards | Base from B. But the **chart cards** ("Tasks per day", "Completion rate" — clean white cards with the **teal left-accent title bar**) come from **A**. |
| 6 | AI Insights | **A** | From A, but **split out into its own separate screen** (distinct from the Assistant). Colored top-accent cards: **INSIGHTS** (blue), **BOTTLENECKS** (orange), **SUGGESTIONS** (green). |
| 7 | AI Assistant (chat) | **A** (base) + B buttons | From A as its **own separate screen** (the chat: "AI Assistant · Ready to help", "Aurora AI" badge, `@`-to-invoke input). **Add the action buttons from B's assistant that A doesn't have.** _(TODO: identify B's extra assistant buttons when implementing.)_ |
| 8 | Contacts | **B** | Comes **entirely from B** (A has no contacts screen). |
| 9 | Settings | **B** (base) + A sidebar | Comes **entirely from B**, but **add a settings sidebar from A**. The sidebar items just **scroll to that section on the same page** (in-page anchor nav) — **not** separate screens. |
| 10 | Editor / Canvas | **A** | Comes from A. |

## Global / cross-cutting decisions
_(apply across all screens)_
- **Navbar:** from **B**.
- **Sidebar:** from **B**, but with **icons from A**. Order follows **B's sequence**, except **Analytics comes before Insights and Assistant**.
- **Font size:** from **B**.
- **Font color:** from **A**.
- **Logout:** the app shows the user avatar ("D" for Demo) in **two places** — top-right and bottom-left of the sidebar. **Both must offer a logout action** (clicking either avatar lets you log out).

## Build / infra decisions
- **Build base:** **A (clarity/chat-frontend)**. Rationale: backends are identical, so it's a structure choice — A already holds the unique/hard winners (Editor/Canvas, Calendar, AI Insights, Assistant). Only **Contacts** must be ported in from B. Building on B would mean porting all of those *out* of A — much more work.
- **Backend:** A's and B's backends (`angular+socket/socket-server/src`) are **byte-for-byte identical**. Same backend either way — runs on `:3000`.
- **Theme:** ship **both light + dark** with the **theme toggle** (B has one).

## Screens to PORT (from B → into A base)
- **Contacts** (screen 8) — B has it, A doesn't.
- **Analytics** base shell (screen 5) — B base + A's chart cards.
- **Settings** (screen 9) — B base + A's sidebar-as-scroll-nav.
- **Projects** (screen 3) — B.
- **Sidebar + navbar** — B (icons from A; Analytics before Insights/Assistant).
- **Login card** — B (recolored to A's palette) + B's clock logo.
- B's **search bar / bordered boxes / "All projects" pill** onto A's Tasks screen (screen 4).
- B's **extra assistant buttons** onto A's Assistant (screen 7).

## Notes
- Both login pages are dark, split-layout, teal-accented and very close. A chosen as the base.
- Status: **decisions only — no implementation started.**
