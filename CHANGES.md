# Clarity — Reshape & Change Backlog

_A working list of things to change/improve, to tackle **one at a time**. Pick an item, tell me the number, and we do it end-to-end (design → build → verify). Reprioritize freely — this is yours._

**Priority:** 🔴 P0 (do soon) · 🟡 P1 (should) · 🟢 P2 (nice) · 🔵 decision (needs your call)
**Effort:** S (hours) · M (a day) · L (multi-day)

---

## A. Close the proposal gaps

- [ ] **A1** 🔵 decision · **Mobile: Ionic + Capacitor, or drop it?** Proposal promises mobile; app is web-only. Decide: (a) wrap the Angular app with Capacitor for iOS/Android, (b) responsive-web only and amend the proposal, or (c) defer. — _M–L_
- [ ] **A2** 🟡 M · **Interconnected task threads / dependencies.** The proposal's headline differentiator is unbuilt. Add a task-dependency model (blocks/blocked-by), visualize links on the canvas, and let status changes cascade.
- [ ] **A3** 🟡 M · **Task-level communication.** Comments/thread on each task (and/or todo item). New `task_comments` table + gateway + UI panel.

## B. Realtime upgrade (was Phase 6b)

- [ ] **B1** 🟡 L · **Granular per-element realtime ops.** Replace whole-project broadcast with project rooms + `element.create/move/update/delete` persisted individually (last-write-wins per element). Kills lost-edit conflicts. _Needs live 2-tab browser testing._
- [ ] **B2** 🟢 M · **Presence & cursors.** Show who's in a project and their live cursors. Big UX payoff for a Canva-like app.
- [ ] **B3** 🟢 L · **Collaborative text (CRDT/Yjs)** for `Text_document` co-editing. Only after B1.

## C. AI robustness

- [ ] **C1** 🟡 M · **Replace regex intent-routing with real tool-calling.** The agent currently matches phrases like "send an invite to". Use Claude/Gemini structured tool-calls for summarize/schedule/invite/create-task so it's reliable and extensible.
- [ ] **C2** 🟢 M · **Proactive AI scheduling** — suggest due dates/ordering automatically from task history, not just on command.
- [ ] **C3** 🟢 S · **Stream AI responses** over Socket.IO/SSE instead of one blocking reply.

## D. Security & production hardening

- [ ] **D1** 🔴 S · **Real secrets.** `JWT_SECRET` is a dev placeholder; set strong secrets via env, never commit. (Old Supabase anon key was hardcoded — already removed.)
- [ ] **D2** 🔴 S · **Flip socket auth to strict** (`AUTH_STRICT=true`) once the frontend always sends the JWT (post-Phase-4 it does). Removes the payload-identity fallback.
- [ ] **D3** 🟡 S · **Rate-limit auth routes** (`/auth/login`, `/auth/register`) + basic brute-force protection.
- [ ] **D4** 🟡 S · **Payload size limits** on `uploadFile` (base64 images/videos) to prevent memory blowups; consider streamed/multipart upload.
- [ ] **D5** 🟢 S · **CORS tighten** for production (currently permissive localhost/LAN + `*` socket origin).

## E. Code quality & cleanup

- [ ] **E1** 🟡 S · **Finish `screen-elements.model.ts`** (`:104` TODO "put all other screen element classes here") and remove dead/commented code + non-English TODO notes.
- [ ] **E2** 🟡 M · **Fix the pre-existing TypeScript errors** (shared_models path resolution, `OAuth2Client` `exactOptionalPropertyTypes`, auth.middleware type-only imports) so `tsc --noEmit` is clean and can gate CI.
- [ ] **E3** 🟢 M · **Tests.** No test coverage today. Add unit tests for the repositories + a socket-contract integration test (the throwaway smoke scripts we used are a starting point).
- [ ] **E4** 🟢 S · **Shared models as a real package** — currently compiled via path alias; tighten so frontend/backend can't drift.

## F. Data & infra

- [ ] **F1** 🟡 S · **Migration tooling.** `db:migrate` re-runs one `schema.sql`. Move to ordered, versioned migrations (e.g. a `migrations/NNNN_*.sql` runner) so schema changes are tracked.
- [ ] **F2** 🟢 S · **Seed script** for demo data (a user + sample project) to speed local dev / demos.
- [ ] **F3** 🟢 S · **Google credentials into DB.** `google_credentials` is empty; add a small seed/admin path so Calendar/Gmail/Contacts + Google login work locally.

## G. Product / UX reshaping — _needs your direction_

You said you want to reshape a lot. Tell me which of these you mean (or describe your own), and I'll expand each into concrete items:

- [ ] **G1** 🔵 · **Navigation / information architecture** — rethink the dashboard, sidebar, and how projects/tasks/analytics relate.
- [ ] **G2** 🔵 · **Canvas UX** — the core workspace: element toolbar, interactions, snapping, multi-select, templates.
- [ ] **G3** 🔵 · **Onboarding & empty states** — first-run experience, sample project, guidance.
- [ ] **G4** 🔵 · **Visual redesign** — the Neobrutalist/Glassmorphism theme; consistency, spacing, dark/light.
- [ ] **G5** 🔵 · **Something else entirely** — tell me what's bugging you and we'll scope it.

---

### How we'll work this
1. You pick an item (e.g. "A2" or "let's do G2").
2. I scope it (short plan), you confirm.
3. I build + verify, we check it in the running app.
4. Cross it off, next one.

_Recommended starting order if you want one: **D1 → D2** (quick hardening), then **A1** (mobile decision, since it affects everything), then a **G** item for the reshape you care about most._
