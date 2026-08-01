# Clarity — Enhancement Backlog (E-series)

_Companion to `NEXT.md` (N1–N10). Same one-at-a-time flow: pick an item by number, I scope it into a short plan, you confirm, we build + verify in a terminal, cross it off. All additive, grounded in what already exists (`FEATURES.md`) — no rewrites._

**Priority:** 🔴 P0 (do soon) · 🟡 P1 (should) · 🟢 P2 (nice) · 🔵 decision (needs your call)
**Effort (AI wall-clock / human-equiv):** `S` ≈ under 1 hr / half day · `M` ≈ 1–3 hrs / ~1 day · `L` ≈ half–1 day / multi-day
**Status:** `[x]` done · `[~]` partial · `[ ]` open

**Persistence note:** anything storing new data (reactions, comments, mentions, history) should land on the Postgres repository layer, not the legacy JSON layer, or it's throwaway rework. Each item below flags whether it needs a new migration.

**Suggested order:** E1 → E2 → E3 (chat comes alive) → E6 (canvas comments) → E9 (AI actions) → the rest. Start with E1 — fastest visible win.

---

## Make chat feel alive

- [x] 🔴 P0 · **S** (~30–60 min) · **E1 — Chat message reactions.**
  - **What/why:** emoji reactions on any message. Highest delight-to-effort ratio; chat currently only supports send/edit/delete/typing/read.
  - **Backend:** new `chat:react` event in `chat.gateway.ts` (toggle `{messageId, emoji, username}`); add `reactions` (map of emoji → username[]) to the message model; broadcast `chat:reacted` to the conversation room. Migration: **yes** (add `reactions` jsonb column to messages) if chat is on Postgres; if still JSON, defer or store inline.
  - **Frontend:** hover emoji-bar + reaction pills under each message in `chat-conversation.component.ts`; optimistic toggle, reconcile on `chat:reacted`.
  - **Verify:** two tabs, react/unreact, count updates live both sides.

- [x] 🔴 P0 · **S–M** (~1–2 hrs) · **E2 — Chat attachments.**
  - **What/why:** send images/files in chat. File gateway already exists — this is mostly wiring, not new infra.
  - **Backend:** reuse `file.gateway.ts` upload; add `attachments[]` (url, name, mime, size) to the message payload. Size/type guards. Migration: **yes** if persisting attachment metadata on Postgres.
  - **Frontend:** attach button + drag-drop into composer; inline image preview / file chip in the message bubble.
  - **Verify:** upload an image + a pdf, both render, persist across reload, sync to other tab.

- [x] 🟡 P1 · **S–M** (~1–2 hrs) · **E3 — @mentions in chat → notifications.**
  - **What/why:** typing `@name` notifies that user. Connects chat to the existing notification center (N2) — two systems you already own.
  - **Backend:** parse mentions server-side on `chat:send`; call the existing `NotificationCenterService` to record a `mention` notification (enum already supports it). Emits `notification:new`.
  - **Frontend:** `@` autocomplete dropdown (conversation participants) in the composer; render mention chips in messages.
  - **Verify:** mention a user → their bell badge increments; deep-links to the conversation.

- [x] 🟢 P2 · **M** (~2–3 hrs) · **E4 — Threaded replies.** _(no migration — `reply_to_id` already existed from `0012`)_
  - **Result:** inline quoted replies (flat-list, iMessage/Slack-inline style — chosen over a separate thread panel to fit the existing flat render loop). **Zero backend/migration work needed:** the `replyToId`/`reply_to_id` field was already plumbed end-to-end (DB column since `0012`, repository, `ChatService`, `chatSendSchema`, and the frontend `ChatService.send({ replyToId })`) but nothing composed or rendered it. All changes landed in `chat-conversation.component.ts`: a **Reply** action on every message (next to Edit/Delete, hover-revealed), a `replyingTo` signal driving a **"Replying to X"** chip above the composer (× to cancel; Esc cancels after closing the mention menu), `send()` now forwards `{ replyToId }`, and each reply renders a **quoted parent preview** (author + one-line body, or 📎 Attachment, or "Original message unavailable" if the parent isn't loaded/was deleted). Clicking the quote **scrolls to the parent and flashes it** (`jumpTo` via `data-mid` + a `highlightId` signal / `replyFlash` keyframes). Reply target is cleared on target switch and restored on send failure. _Verified: `ng build` clean; `chat-smoke.ts` extended with 3 E4 checks (send with `replyToId` → ack, peer broadcast, and history all carry it) — **20/20** pass._
  - **What/why:** reply-to a specific message; keeps busy project channels readable. UI is the bulk of the cost.
  - **Backend:** `parentId` on message model; thread-scoped history query in `chat.gateway.ts`. Migration: **yes**.
  - **Frontend:** "reply" affordance, thread-count indicator, side/inline thread view in `chat-conversation`.
  - **Verify:** reply, open thread, counts and ordering correct across tabs.

## Calls

- [x] 🟡 P1 · **S** (~30–45 min) · **E5 — Real shared Meet room.** _(no migration — link rides the existing message model)_
  - **Result:** new `chat:call:start` socket event mints ONE shared link and posts it into the conversation (persists + syncs to every tab via the existing `chat:message` broadcast). New `meet.service.ts`: Google Meet via Calendar `conferenceData` when the initiator has a connected Google account, else a shared `meet.jit.si/clarity-…` room (never throws). Frontend `startCall()` opens the returned link; messages with a Meet/Jitsi URL render a **"Join call" card**. Removed the old paste-your-own-link hint. _Verified end-to-end: (1) `chat-smoke.ts` extended with a two-client call test — alice's ack link == the link broadcast into bob's channel (same room for everyone; Jitsi fallback path). (2) `verify-meet.ts` drove the real Google path with a connected account → created a live `meet.google.com` room via the Calendar API (event auto-deleted). Both typecheck clean; 17/17 smoke checks pass._
  - **What/why:** today `startCall()` just opens `meet.google.com/new` — every clicker gets a *different* room. Create one link, share it into the conversation so everyone joins the same call.
  - **Backend:** use existing Google integration (`google-integration.service.ts` / `google.routes.ts`) to create a Meet link; post a system message with it into the conversation.
  - **Frontend:** call button posts + opens the shared link; render a "Join call" card in chat.
  - **Verify:** two users click → same room.
  - _Stretch (🔵 decision, **L** ~1 day, high complexity): in-app WebRTC 1:1 audio/video with Socket.IO signaling instead of Meet. Real feature, real edge cases (ICE/TURN, reconnection). Needs a scope call._

## Canvas collaboration

- [x] 🟡 P1 · **M–L** (~half day) · **E6 — Comments pinned to canvas elements.** _(migration **0014_element_comments**)_
  - **Result:** full vertical slice on the Postgres layer. New `element_comments` table (`0014`) + `elementComment.repository.ts` (create/list-for-project/resolve/delete), surfaced through `CollabService` and four `comment:create|list|resolve|delete` gateway events (via the existing `onAuthed` preamble; `create` uses the `requireElement` guard, author derived server-side). Each mutation broadcasts `comment:created|resolved|deleted` to the whole project room; `create` also fans `@mentions` to the durable inbox (N2 `recordCommentNotifications`, `mention`/`comment` types already existed) + a live `mention:notified` push. **Persistence gotcha handled:** `element_comments.element_id` is a plain uuid with **no FK** to `screen_elements` (only `project_id` cascades) — `saveProject` full-replaces elements every save, so a cascade would wipe threads; this mirrors the `0004` task_comments decouple. Frontend: `socket.service`/`collab.service` wrappers + inbound Zod schemas, and in `project-detail` a comment badge per element, comment **pins** rendered inside `.canvas-area` (inherit pan/zoom like remote cursors), and a screen-space **thread popover** (constant size across zoom) with post / resolve-reopen / delete and optimistic-with-error-restore. Viewers get a read-only thread. _Verified: `comment-smoke.ts` (two clients + a non-collaborator) — **14/14** pass (create→broadcast same-id, list, @mention live push, resolve stamp+broadcast, delete carries elementId + drops from list, non-collaborator rejected). Backend typechecks clean; `ng build` clean; migration applied (table has projects-cascade, no element FK, both indexes)._
  - **What/why:** the #1 thing Figma/Miro users expect; you have cursors + presence but no way to leave a comment on an element. Reuses collab + notification infra.
  - **Backend:** new comment model (elementId, projectId, author, body, resolved) + gateway events (`comment:create|list|resolve|delete` → broadcast to project room); record `comment` notifications for participants/mentions via N2. Migration: **yes** (new `element_comments` table).
  - **Frontend:** comment pin anchored to the element (the fiddly part — must survive pan/zoom, reuse `canvas-viewport.service.ts` coordinate transforms), thread popover, resolve/unresolve.
  - **Verify:** comment on an element, pan/zoom stays anchored, other tab sees it, resolve hides it.

- [x] 🟢 P2 · **S** (~30 min) · **E7 — Presence avatars in project topbar.** _(no migration — frontend only)_
  - **Result:** the header avatar stack (already bound to live `presenceUsers`) got the polish it was missing: caps at 5 avatars then collapses the rest into a **"+N"** chip (`getVisiblePresence`/`getPresenceOverflow`), rings the **current user's own** avatar and labels its tooltip "(you)" (`isSelfPresence`/`presenceTooltip`), keeps the "N here" count pill, and the per-avatar name tooltip. Deduping is handled server-side by the presence registry. _Verified via E6's two-client room join (presence broadcast reaches both); `ng build` clean._
  - **What/why:** show who else is viewing this project. Presence data already flows via `collab.gateway` (`presence:update`).
  - **Frontend only:** avatar stack in the project-detail header bound to existing presence state.
  - **Verify:** open same project in two tabs → both avatars show.

- [x] 🔵 decision → 🟡 P1 · **L** (~half day) · **E8 — Canvas version history / restore.** _(migration **0015_project_snapshots**)_
  - **Decision resolved:** investigation confirmed **no** canvas history was persisted — the DB stored only current state (saveProject full-replaces, granular ops mutate in place, the "activity feed" is just a read-model over comments + member-adds). So E8 = build snapshot persistence from scratch. Chosen scope (both recommended): **whole-canvas snapshots** (not per-op event log) + **auto-on-save with manual named checkpoints**.
  - **Result:** full vertical slice on the Postgres layer. New `project_snapshots` table (`0015`) stores the FULL serialized project payload per version — the exact shape `saveProject`/`loadProject` already speak, so versioning is "store the payload you saved" and restore is "feed an old payload back through the full-replace `saveProject`" (no new serializer, no per-element diffing). New `snapshot.repository.ts`: `createSnapshot`/`listSnapshots` (metadata-only, payload omitted)/`getSnapshotPayload`/`snapshotCurrentState`/`restoreSnapshot`, plus `maybeAutoSnapshot` (best-effort, never fails a save) with **content-hash de-dup** (a no-op save adds no version) + a **60s throttle** (rapid saves collapse to one checkpoint) + prune to the newest 30 auto per project. Auto-capture is hooked into `ProjectHandler.saveProject` after the commit. Manual/restore surface through `CollabService` + three `snapshot:create|list|restore` gateway events (edit-gated via the existing `onAuthed` preamble; `createdBy` derived server-side). `create` echoes `snapshot:created` to the whole room; `restore` snapshots the pre-restore state as a `"Before restore"` auto version (so restore is itself reversible), full-replaces the canvas, and broadcasts `snapshot:restored` to peers. Frontend: `socket.service`/`collab.service` wrappers + inbound Zod schemas, and a new **`version-history`** dialog (modeled on `activity-feed`) opened from a **History** button in the project header — timeline with per-version kind/author/element-count, a "Save version" composer (editors only, viewers read-only), and inline restore-with-confirm; on restore the initiator reloads via `reloadProjectFromServer()` and peers reload off the broadcast.
  - _Verified: `snapshot-smoke.ts` (two collaborators + a non-collaborator) — **18/18** pass: manual create→broadcast (same id), list, move-then-restore reverts canvas to the saved coords both sides, a "Before restore" safety version is written, auto-snapshot writes-on-change / de-dups an unchanged save / throttles a rapid save, and every op by a non-collaborator is rejected. Backend typecheck + `ng build` clean; existing `collab.gateway.test.ts` still 3/3._
  - _Not restored: Google Calendar events for restored ToDoLst tasks (restore uses the repo full-replace directly, bypassing calendar-sync) — acceptable for v1._
  - **What/why:** "restore to this point" on the canvas; high trust value.

## AI as a differentiator

- [x] 🟡 P1 · **L** (~half–1 day, prompt iteration is the variable) · **E9 — Project-aware AI actions.** _(no migration — tasks persist via the existing whole-project save)_
  - **Slice 1 done:** the assistant is now project-aware. New pure `lib/project-context.ts#buildProjectContext(project)` projects a project into a compact, model-friendly block (per-list tasks with priority·status·due·OVERDUE flag·inter-list `dependsOn`, plus header counts) — replaces the old `JSON.stringify(project)` in `summarise_project`. `chat()`/`chatStream()` take an optional `{projectName, projectType}` scope (read from `?projectName&projectType` in `ai.routes.ts`) and inject that context so answers/tools default to the focused project. New `find_blocked` tool + `find_blocked`/`find_blocked_by_name` methods (overdue/undated/stalled/blocked-by-list analysis). Frontend: `ai.service` `chat/streamChat` accept a scope; Assistant screen gains a **project picker scope bar** + **Summarize / What's blocked** quick-action chips (replaced the placeholder "YOOO" chips), all streaming.
  - **Slice 2 done:** `thread_to_tasks` tool + `POST /ai-assistant/thread-to-tasks` route. `Chat_Agent.extract_tasks_from_thread` asks Gemini for a strict JSON array of `{task_name, priority?, due_date?}` (fence-tolerant parse, never throws → []); `thread_to_tasks(project, thread)` appends them in-memory (Project-first, testable like summarise); `thread_to_tasks_by_name` loads → delegates → saves ONCE via the shared `saveProject` (reuses N5's `addTaskToProject`/`priorityFromWord`/`resolveDueIso`). Frontend: `chat-conversation` gains a checklist button on **project channels** that serializes the loaded thread (skips call cards/empty, last 100 msgs) → creates tasks → shows a transient "Created N tasks…" notice.
  - _Verified: `scripts/verify-e9.ts` — **20/20** incl. live Gemini: (slice 1) summary + find_blocked both reference the seeded overdue task; (slice 2) a 4-line thread → 4 well-named tasks that land in the project, the non-actionable "thanks" line ignored, task count grows correctly. Backend typecheck + Angular build clean._
  - **What/why:** the assistant streams from Gemini but is generic. Make it act on real project context: "summarize this project," "turn this chat thread into tasks," "what's blocked." Ties AI + chat + tasks together. Builds on N5's `create_task` tool.
  - **Backend:** context assembly (serialize project/chat/tasks into the prompt), a few structured tools alongside `create_task` in `agent.tools.ts` (`summarize_project`, `thread_to_tasks`, `find_blocked`). Streaming already exists (`ai.routes.ts`).
  - **Frontend:** surface actions in the Assistant screen + a "turn thread into tasks" action from chat.
  - **Verify:** run each action against a seeded project; created tasks appear on next load (persist-only, like N5).

## Reliability polish

- [x] 🟡 P1 · **M–L** (~half day) · **E10 — Optimistic writes + reconnect handling on canvas.** _(no migration — dedup is in-memory, per the reconnect-window scope)_
  - **Result:** three reliability gaps closed. (1) **Reconnect rejoin** — `SocketService` now exposes `onConnect()`/`onDisconnect()`/`isConnected()`; `CollabService` re-joins the active project room on every (re)connection so remote ops + presence resume after a blip (Socket.IO hands back a fresh server-side socket that's in no room). (2) **No lost/stale moves** — `element:move` is now a `volatile` emit (intermediate offline frames are dropped, not buffered-then-replayed-stale); `CollabService` coalesces the latest per-element transform made while offline and replays only that final state (absolute, last-write-wins) after rejoin. Pending queue is cleared on room switch/leave. (3) **No dupes** — `element:create` carries a client-generated `opId`; `collab.gateway` keeps a bounded in-memory `opId` cache and collapses a replayed create to the original insert (acks `deduped:true`, no second row, no second broadcast). _Verified: backend typecheck clean; `collab.gateway.test.ts` extended with an E10 idempotency test (same opId twice → 1 row, second ack `deduped`, peer gets no second broadcast) — 3/3 collab tests pass. Frontend typecheck clean._
  - **What/why:** realtime apps live or die on this. Optimistic local apply, dedup + reconcile on reconnect, basic conflict handling.
  - **Backend:** ensure idempotent element ops / op ids in `collab.gateway`.
  - **Frontend:** optimistic apply in `collab.service.ts` / `realtime.service.ts`, replay/dedup queue on reconnect.
  - **Verify:** drop network mid-drag, reconnect → no dupes, no lost moves.

- [x] 🟢 P2 · **S** (~1 hr) · **E11 — Command palette actions (not just search).** _(frontend only, no migration)_
  - **Result:** grew the ⌘K `Actions` group with **New Task** and **Ask the assistant**, and made the create actions actually *do* something: the existing `New Project` action deep-linked to `/dashboard/projects?new=1` but no component read the flag, so it just landed on the list. Wired `projects.component` and `tasks.component` to read `?new=1` (via `ActivatedRoute.queryParams`) and open their create modals, then strip the flag (`replaceUrl`) so a refresh/back doesn't reopen it. Tasks uses `takeUntilDestroyed` (signal/zoneless-consistent); projects unsubscribes in `ngOnDestroy`. _Verified: frontend typecheck clean._
  - **What/why:** ⌘K already does nav + content search (N3); add an action registry — create task, jump to project, invoke AI.
  - **Frontend only:** action registry + handful of commands in `command-palette.component.ts`.
  - **Verify:** run "Create task" / "New project" from the palette.

---

## Recommended bundles

- **"Chat comes alive"** — E1 + E2 + E3 · ~3–4 hrs incl. your browser testing · best value-to-effort.
- **"Canvas collaboration"** — E6 + E7 · ~half day.
- **"AI differentiator"** — E9 · ~half–1 day, highest uncertainty.

_How to run one: say e.g. "do E1" — I scope a short plan, you confirm, we build, verify in the terminal (two tabs for realtime), then mark `[x]` here with a one-line result + any migration number, matching the `NEXT.md` convention._
