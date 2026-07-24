# Clarity — Reshape & Change Backlog

_A working list of things to change/improve, to tackle **one at a time**. Pick an item, tell me the number, and we do it end-to-end (design → build → verify). Reprioritize freely — this is yours._

**Priority:** 🔴 P0 (do soon) · 🟡 P1 (should) · 🟢 P2 (nice) · 🔵 decision (needs your call)
**Effort:** S (hours) · M (a day) · L (multi-day)

---

## A. Close the proposal gaps

- [x] **A1** ✅ decided · **Mobile: native Kotlin (Android) + Swift/SwiftUI (iOS).** Separate native apps against the existing shared backend (Socket.IO + JWT + Postgres) — no server rewrites. **Deferred:** web UI/UX reshape comes first; mobile track starts later (contract doc → auth+connect → read-only → native canvas editor). — _L (later)_
- [ ] **A2** 🟡 M · **Interconnected task threads / dependencies.** The proposal's headline differentiator is unbuilt. Add a task-dependency model (blocks/blocked-by), visualize links on the canvas, and let status changes cascade.
- [ ] **A3** 🟡 M · **Task-level communication.** Comments/thread on each task (and/or todo item). New `task_comments` table + gateway + UI panel.

## B. Realtime upgrade (was Phase 6b)

- [ ] **B1** 🟡 L · **Granular per-element realtime ops.** Replace whole-project broadcast with project rooms + `element.create/move/update/delete` persisted individually (last-write-wins per element). Kills lost-edit conflicts. _Needs live 2-tab browser testing._
- [ ] **B2** 🟢 M · **Presence & cursors.** Show who's in a project and their live cursors. Big UX payoff for a Canva-like app.
- [ ] **B3** 🟢 L · **Collaborative text (CRDT/Yjs)** for `Text_document` co-editing. Only after B1.

## C. AI robustness

- [x] **C1** ✅ M · **Replaced regex intent-routing with real tool-calling — live-verified.** `chat()` uses Gemini structured tool-calls (LangChain `bindTools`) for `summarize_project`/`suggest_schedule`/`send_invite`. **Live test with a real key confirmed**: plain chat + a tool-routed "summarize project" round-trip both work. _Fixed a real bug found in testing: tools were wrapped in the OpenAI `{type:"function"}` envelope, which Gemini rejects (400) — now passed as plain `{name,description,schema}`. `create_task` not added — no backing agent method today._
- [ ] **C2** 🟢 M · **Proactive AI scheduling** — suggest due dates/ordering automatically from task history, not just on command.
- [ ] **C3** 🟢 S · **Stream AI responses** over Socket.IO/SSE instead of one blocking reply.

## D. Security & production hardening

- [x] **D1** ✅ S · **Real secrets.** Removed hardcoded `JWT_SECRET`/`DATABASE_URL` fallbacks — config now throws in prod if missing, warns in dev. Generated a strong `JWT_SECRET` into the gitignored `.env`; added `.env.example` documenting every var.
- [~] **D2** 🔴 S · **Flip socket auth to strict** (`AUTH_STRICT=true`). Strict path reviewed & confirmed correct; default left `false`. **Flip pending** — needs live test that the frontend always sends the JWT (post-Phase-4).
- [x] **D3** ✅ S · **Rate-limited auth routes.** `express-rate-limit` on `/auth/login` + `/auth/register` (env-configurable window/max).
- [x] **D4** ✅ S · **Payload size limits** on `uploadFile` (`MAX_UPLOAD_BYTES`, default 10MB) + Socket.IO `maxHttpBufferSize` bound. Streamed/multipart noted as future work.
- [x] **D5** ✅ S · **CORS tightened** — config-driven; prod refuses `*`/empty origins, dev stays permissive localhost/LAN.

## E. Code quality & cleanup

- [ ] **E1** 🟡 S · **Finish `screen-elements.model.ts`** (`:104` TODO "put all other screen element classes here") and remove dead/commented code + non-English TODO notes.
- [x] **E2** ✅ M · **Fixed pre-existing TypeScript errors.** `tsc --noEmit -p socket-server` is now **0 errors** (was 36 with in-flight work). Fixed: `shared_models` `.js` import extensions (nodenext) + dayjs `isSameOrBefore` typing + implicit-any; `OAuth2Client` exactOptionalPropertyTypes; auth.middleware type-only imports + token guard; a real masked bug in `project.service.ts` (null `calendar_event_id` pushed into `string[]`). Angular build re-verified green. Tests excluded from the app typecheck (Vitest owns them). Can gate CI now.
- [x] **E3** ✅ M · **Tests.** Vitest harness added: repository integration tests (identity/user/project — round-trips, upserts, granular element ops, cleanup) + a Socket.IO contract test (real `socketAuth` + `project.gateway` `listProjects`, JWT handshake, owner-filtering). **15 tests, all green** via `npm test`. _Assumes local Postgres up + migrated._
- [~] **E4** 🟢 S · **Shared models drift.** Added `shared_models/package.json` (`@clarity/shared-models`) documenting the single source of truth; both apps compile the same `.ts` source (backend via `@models/*` alias, frontend via relative import). **Full buildable/published package extraction deferred** — would force the Angular app onto compiled `.d.ts`/`.js` and risk its build. Also noted: stale `shared_models/dist/` legacy output worth deleting.

## F. Data & infra

- [x] **F1** ✅ S · **Versioned migration tooling.** `db:migrate` now runs ordered `db/migrations/NNNN_*.sql` tracked in a `schema_migrations` table (each in its own transaction, idempotent). `0001_init.sql` = current schema. _Verified: applies once, no-op on re-run._
- [x] **F2** ✅ S · **Seed script** (`db:seed`) — demo user + sample project/grid/elements/tasks, re-runnable (upserts). _Verified. Login: `demo@clarity.local` / `demo1234`._
- [x] **F3** ✅ S · **Google credentials into DB — live-verified.** Admin path `npm run db:seed-google` upserts the `google_credentials` (id=1) row from env vars (documented in `.env.example`). OAuth Web client created, Calendar/Gmail/People APIs enabled, row seeded. **Full browser login round-trip confirmed**: consent → callback → access+refresh tokens stored in `oauth_tokens` → user auto-created → JWT issued. _Gemini key + Gmail app password also configured & live-verified._

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
