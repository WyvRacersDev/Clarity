# Clarity — Reshape & Change Backlog

_A working list of things to change/improve, to tackle **one at a time**. Pick an item, tell me the number, and we do it end-to-end (design → build → verify). Reprioritize freely — this is yours._

**Priority:** 🔴 P0 (do soon) · 🟡 P1 (should) · 🟢 P2 (nice) · 🔵 decision (needs your call)
**Effort:** S (hours) · M (a day) · L (multi-day)
**Status:** `[x]` done · `[~]` partial — some shipped, the rest scoped/deferred (see the item's italic note) · `[ ]` open or deliberately deferred

**Where things stand (2026-07-31):** **26 done** · **1 partial** (E4) · **0 open** — **G5 done** (backend-only `clarity2` copy created at `~/Documents/clarity2` for a fresh frontend; installs + typechecks clean). **B3 done** (collaborative text via Yjs/Quill — authoritative server Y.Doc, room-scoped sync/update/awareness events, CRDT merge of concurrent edits, new rich-text editor overlay). Section **B is now fully complete**, as are **C, D, F**. All shipped work is verified (**20 tests green**, both builds clean).

---

## A. Close the proposal gaps

- [x] **A1** ✅ decided · **Mobile: native Kotlin (Android) + Swift/SwiftUI (iOS).** Separate native apps against the existing shared backend (Socket.IO + JWT + Postgres) — no server rewrites. **Deferred:** web UI/UX reshape comes first; mobile track starts later (contract doc → auth+connect → read-only → native canvas editor). — _L (later)_
- [x] **A2** ✅ M · **Interconnected task threads / dependencies.** Element-level dependency model (`ToDoLst.dependsOn: string[]`, persisted in `screen_elements.content` JSONB, round-trips through toJSON/rebuild + granular collab). Canvas draws SVG dependency links between ToDoLst cards (blue link, arrowhead) with a link/pick-target affordance; cascade tints the link green when the blocking element's tasks are all done and shows a "blocked" badge otherwise.
- [x] **A3** ✅ M · **Task-level communication.** `task_comments` table (migration `0003`) + `comment.repository.ts` + `task:comment:add`/`:list` gateway events (author from JWT identity) + `task:comment:added` room broadcast. UI comments panel in the fullscreen-todo overlay with a composer + live updates + per-task count badge. **Durability:** tasks now serialize their DB `id`, `saveProject` reuses it as PK, and the comment FK cascade was dropped (migration `0004`) so comments survive whole-project re-saves.

## B. Realtime upgrade (was Phase 6b)

- [x] **B1** ✅ L · **Granular per-element realtime ops.** Project rooms (`${type}:${name}`) + `element:create/move/update/delete` each persisted individually to Postgres (repository ops `insertElement`/`updateElementTransform`/`updateElementContent`/`deleteElement`) and broadcast to the room **except the sender** (last-write-wins per element) — via `collab.gateway.ts` on the backend and `collab.service.ts` + the canvas (`project-detail`) on the frontend, which emits on every move/resize/create/delete/content-edit and applies remote ops. **Fixed two real create-path bugs found while verifying:** (1) the client discarded the create ack, so a freshly-created element never learned its server `id` and its later move/edit/delete ops silently no-op'd until a reload — now the authoritative id is captured onto the local element; (2) create fired *both* a whole-project save and a granular insert → a duplicate row — the granular create now runs first so the following whole-project save reuses the captured id (single row). **Verified:** new `collab.gateway.test.ts` drives a 2-client (2-tab) create/move/update/delete round-trip asserting peer broadcast + Postgres persistence + broadcast-except-sender. Full suite **17 tests green**; `ng build` + backend typecheck clean. _Presence & cursors are B2._
- [x] **B2** ✅ M · **Presence & cursors.** Presence avatars + live remote cursors wired end-to-end (collab room `presence:update`/`cursor:moved`), now **polished**: per-user album-accent color (hashed from username), an "N here" pill, and colored cursor labels. _Broader collab conflict-handling stays with B1 (deferred)._
- [x] **B3** ✅ L · **Collaborative text (CRDT/Yjs).** True concurrent co-editing of `Text_document` elements, no last-write-wins clobbering. **Backend:** an authoritative in-memory `Y.Doc` per element (`ydoc-registry.ts`) hydrated from Postgres, with three new room-scoped gateway events — `ydoc:sync` (a client catches up via state-vector diff), `ydoc:update` (applied to the server doc, relayed to the room except sender, and **debounce-persisted** into `content.ydoc` base64 + a `Text_field` plain-text mirror), and `ydoc:awareness` (remote-caret relay, not persisted). The Yjs state rides in `content` JSONB and round-trips through `serializeProject`/`buildElementContent` + the shared `Text_document` model (`ydoc?` field) so whole-project saves preserve it. **Frontend:** a new SSR-safe `TextDocEditorComponent` overlay (opened on double-click of a text element — previously the canvas had **no** text editor at all) hosting a **Quill 2** rich editor bound to the Y.Doc via `y-quill`, with live remote carets via `quill-cursors` + Yjs awareness, themed for dark+light. Legacy plain-text docs migrate into the CRDT on first open. All Quill/Yjs code is browser-only via dynamic import (lazy chunk). **Verified:** new `ydoc.gateway.test.ts` drives a 2-client Yjs round-trip — peer relay + Postgres persistence (ydoc + mirror) + late-joiner `ydoc:sync` catch-up + a **concurrent-edit merge** asserting both edits survive. Full suite **20 tests green**; `ng build` + backend typecheck clean. _Known limit (inherited from B1): an out-of-band whole-project save can still write a stale snapshot — the CRDT guarantees no clobbering among live editors, which is B3's goal._

## C. AI robustness

- [x] **C1** ✅ M · **Replaced regex intent-routing with real tool-calling — live-verified.** `chat()` uses Gemini structured tool-calls (LangChain `bindTools`) for `summarize_project`/`suggest_schedule`/`send_invite`. **Live test with a real key confirmed**: plain chat + a tool-routed "summarize project" round-trip both work. _Fixed a real bug found in testing: tools were wrapped in the OpenAI `{type:"function"}` envelope, which Gemini rejects (400) — now passed as plain `{name,description,schema}`. `create_task` not added — no backing agent method today._
- [x] **C2** ✅ M · **Proactive AI scheduling.** The 15-min notification cron now also computes proactive suggestions for overdue/undated tasks (reuses the `suggest_schedule` LLM prompt when a real key exists, else a deadline/priority heuristic), emits `ai:suggestion` to the user's `user:<username>` room (+ a `GET /ai-assistant/suggestions` pull), and surfaces them in the AI Insights "Suggestions" column with a "Proactive" tag. Deduped/capped, graceful without a key.
- [x] **C3** ✅ S · **Stream AI responses.** SSE route `GET /ai-assistant/chat-agent-stream` streams LangChain `.stream()` chunks (`agent.chatStream()`); frontend `ai.service.streamChat()` renders the reply token-by-token with a typing indicator. Existing blocking route kept as fallback; empty-stream falls back automatically.

## D. Security & production hardening

- [x] **D1** ✅ S · **Real secrets.** Removed hardcoded `JWT_SECRET`/`DATABASE_URL` fallbacks — config now throws in prod if missing, warns in dev. Generated a strong `JWT_SECRET` into the gitignored `.env`; added `.env.example` documenting every var.
- [x] **D2** ✅ S · **Flipped socket auth to strict** (`AUTH_STRICT=true` in `.env`; code default stays `false`). Verified the frontend always sends the JWT in the handshake and `reconnect()`s on login/logout. **Live-verified:** an unauthenticated socket is rejected (_"Authentication required: no token provided"_) while a valid-JWT socket connects and lists the owner's project. The 15-test suite (incl. the JWT-handshake gateway contract test) stays green under strict.
- [x] **D3** ✅ S · **Rate-limited auth routes.** `express-rate-limit` on `/auth/login` + `/auth/register` (env-configurable window/max).
- [x] **D4** ✅ S · **Payload size limits** on `uploadFile` (`MAX_UPLOAD_BYTES`, default 10MB) + Socket.IO `maxHttpBufferSize` bound. Streamed/multipart noted as future work.
- [x] **D5** ✅ S · **CORS tightened** — config-driven; prod refuses `*`/empty origins, dev stays permissive localhost/LAN.

## E. Code quality & cleanup

- [x] **E1** ✅ S · **Code cleanup.** Removed the stale `screen-elements.model.ts` TODO (all used element classes already exist). Deleted dead code: unused `svg-canvas`/`canvas-workspace`/`fabric-canvas` components, orphaned `ai-assistant/`, the stray `components.projects/` dir, the mis-located `projects/project-detail.component.css`, and `settings.component 3.css`; removed commented OAuth/`checkUpcomingTasks` blocks. Fixed `ai.service.ts` hardcoded `localhost:3000` → `getServerConfig()`. Build + typecheck green.
- [x] **E2** ✅ M · **Fixed pre-existing TypeScript errors.** `tsc --noEmit -p socket-server` is now **0 errors** (was 36 with in-flight work). Fixed: `shared_models` `.js` import extensions (nodenext) + dayjs `isSameOrBefore` typing + implicit-any; `OAuth2Client` exactOptionalPropertyTypes; auth.middleware type-only imports + token guard; a real masked bug in `project.service.ts` (null `calendar_event_id` pushed into `string[]`). Angular build re-verified green. Tests excluded from the app typecheck (Vitest owns them). Can gate CI now.
- [x] **E3** ✅ M · **Tests.** Vitest harness added: repository integration tests (identity/user/project — round-trips, upserts, granular element ops, cleanup) + a Socket.IO contract test (real `socketAuth` + `project.gateway` `listProjects`, JWT handshake, owner-filtering). **15 tests, all green** via `npm test`. _Assumes local Postgres up + migrated._
- [~] **E4** 🟢 S · **Shared models drift.** Added `shared_models/package.json` (`@clarity/shared-models`) documenting the single source of truth; both apps compile the same `.ts` source (backend via `@models/*` alias, frontend via relative import). **Full buildable/published package extraction deferred** — would force the Angular app onto compiled `.d.ts`/`.js` and risk its build. Stale `shared_models/dist/` legacy output **deleted** (unreferenced; both apps compile the `.ts` source directly).

## F. Data & infra

- [x] **F1** ✅ S · **Versioned migration tooling.** `db:migrate` now runs ordered `db/migrations/NNNN_*.sql` tracked in a `schema_migrations` table (each in its own transaction, idempotent). `0001_init.sql` = current schema. _Verified: applies once, no-op on re-run._
- [x] **F2** ✅ S · **Seed script** (`db:seed`) — demo user + sample project/grid/elements/tasks, re-runnable (upserts). _Verified. Login: `demo@clarity.local` / `demo1234`._
- [x] **F3** ✅ S · **Google credentials into DB — live-verified.** Admin path `npm run db:seed-google` upserts the `google_credentials` (id=1) row from env vars (documented in `.env.example`). OAuth Web client created, Calendar/Gmail/People APIs enabled, row seeded. **Full browser login round-trip confirmed**: consent → callback → access+refresh tokens stored in `oauth_tokens` → user auto-created → JWT issued. _Gemini key + Gmail app password also configured & live-verified._

## G. Product / UX reshaping — _needs your direction_

You said you want to reshape a lot. Tell me which of these you mean (or describe your own), and I'll expand each into concrete items:

> **Reshape delivered — "Clarity Aurora" ground-up redesign** (agent-orchestrated, build-verified). New design system in `src/styles.css` (semantic tokens, dark default + real light theme, full primitive set: buttons/cards/glass/inputs/fields/chips/badges/tabs/menus/modals/toasts/skeletons/empty-states/avatars/switches). All 9 screens + the layout shell rebuilt against it, visual-layer only (no Socket.IO/model/route/handler drift), SSR- and zoneless-safe. `ng build` green. Contract lives in the `clarity-redesign` skill; executed via `clarity-ui-orchestrator`/`-design-foundation`/`-ui-builder`/`-ui-reviewer` agents.

- [x] **G1** ✅ · **Navigation / IA** — collapsible sidebar (rail mode, persisted), slim glass topbar, and a new **⌘K command palette** (fuzzy nav + quick actions + theme toggle).
- [x] **G2** ✅ · **Canvas UX** — restyled workspace (floating glass toolbar, refined cards/handles, minimap, presence/cursors) **plus interaction depth**: multi-select (shift-click, shift-drag marquee, ⌘A/Esc, group-move/delete), grid snapping on drop (toggle), and a Templates quick-start (Kanban / Note+Tasks). All pan/zoom/drag/resize + A2 link mode preserved.
- [x] **G3** ✅ · **Onboarding & empty states** — empty states + skeletons + premium split-hero welcome, **plus** a 4-step first-run spotlight **tour** (localStorage-tracked, skippable) and a **"Create a sample project"** action on the empty projects state.
- [x] **G4** ✅ · **Visual redesign** — replaced the Neobrutalist theme with the Aurora system; consistent spacing/radius/shadows/type, **dark + light** both working, no hardcoded colors.
- [x] **G5** ✅ L · **Fresh frontend on a backend-only copy.** Copied the entire project into `~/Documents/clarity2` **backend/infra only** — excluded the whole Angular app (`chat-frontend/`), all `node_modules/`, `.git/`, and `.DS_Store`. Kept the Socket.IO backend (`socket-server/`), the shared model source (`shared_models/`, reached via the backend's `@models/*` alias), the workspace `package.json`/`package-lock.json`/`vitest.config.ts`, `docker-compose.yml`, the DB migrations, and the `.env` files so it runs as-is. **Verified self-contained:** a fresh `npm install` (285 pkgs) + `tsc --noEmit -p socket-server/tsconfig.json` both pass with **0 errors** in the new folder, and no frontend markers (`angular*.json`, `*.component.ts`, `src/app`) remain. A brand-new frontend will be built there against this existing Socket.IO + JWT + Postgres backend. `clarity2` starts with no git history (clean slate — `git init` when ready).

---

### How we'll work this
1. You pick an item (e.g. "A2" or "let's do G2").
2. I scope it (short plan), you confirm.
3. I build + verify, we check it in the running app.
4. Cross it off, next one.

_Recommended starting order if you want one: **D1 → D2** (quick hardening), then **A1** (mobile decision, since it affects everything), then a **G** item for the reshape you care about most._
