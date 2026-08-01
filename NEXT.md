# Clarity — Next Features Backlog

_Candidate features to build next, in the same one-at-a-time style as `CHANGES.md`. Pick an item by number, I scope it (short plan), you confirm, we build + verify, cross it off. All grounded in what already exists (see `FEATURES.md`) — additive, not rewrites._

**Priority:** 🔴 P0 (do soon) · 🟡 P1 (should) · 🟢 P2 (nice) · 🔵 decision (needs your call)
**Effort:** S (hours) · M (a day) · L (multi-day)
**Status:** `[x]` done · `[~]` partial · `[ ]` open

**Where things stand (2026-08-01):** **9 done** (N1–N8, N10) · **1 open** (N9, responsive done / PWA deferred). N10 (integrations beyond Google) is the latest: ICS calendar feed (opaque per-user token, unauthenticated subscribe), Slack/generic webhook mirroring every N2 notification, and project export (JSON/Markdown/print-to-PDF) — **no app-level API keys**, migration `0011`, **full backend suite 86 green**, `ng build` clean. N2 added the durable notification center + activity feed (migration `0010`). N8 closed the CRDT stale-snapshot limit. N5 added the AI `create_task` tool. N3/N4/N6 shipped global content search + timeline + kanban (migration `0007`). N7 shipped recurring tasks + live @mentions (migration `0005`). N1 shipped access control & sharing (migrations `0008`/`0009`).

**What's left:** only **N9**'s optional PWA piece (manifest + service worker + offline) — responsive is already done. Needs a scope call before starting.

---

## Highest leverage

- [x] **N1** ✅ L · **Access control & sharing for projects.** Real role model (owner > admin > editor > viewer) replacing the old owner-only(local)/open(hosted) rule.
  - **Schema (`0008_sharing.sql` + `0009` fixup):** `project_collaborators` (now applied, not just in `schema.sql`), new `project_invitations` (pending invites addressed by email), and `projects.link_share_role`/`link_share_token`. Backfill keeps existing hosted projects publicly editable.
  - **Backend:** `AccessService` (single source of truth for effective role + `view/edit/manage` capabilities), `SharingService` (invite/role/revoke/link + auto-accept pending invites on sign-up), `member`/`invitation` repositories, and a `sharing.gateway` (`sharing:get|invite|updateRole|removeMember|revokeInvite|setLink` → broadcasts `sharing:updated`). Enforcement wired into `CollabService.authorize` (delegates to AccessService), `project.gateway` load (view + `canEdit`/`role`), `collab.gateway` (viewers may join, edits gated), and shared-with-me projects now appear in the local list. Pending invites auto-convert to memberships on register/Google login.
  - **Frontend:** self-contained `ShareDialogComponent` (invite by email + role, change roles, revoke, link sharing with copyable URL) opened from a **Share** button in the project header (owner/admin only); a **View only** chip for viewers.
  - **Verified:** 13 new backend tests (9 access/sharing service + 2 sharing gateway + covered by suite) — **full backend suite 52 green**; `ng build` clean; migrations `0008`/`0009` applied.

- [x] **N2** ✅ M · **In-app notification center + activity feed.** Durable inbox for events that were previously live-push/email-only and lost when offline.
  - **Schema (`0010_notifications.sql` + `schema.sql`):** `notifications` table keyed by `recipient` username (no FK, like `task_comments.author`), `type` CHECK enum (`mention`/`comment`/`project_shared`/`ai_suggestion`/`due_soon`), `read_at` NULL = unread; recipient+created / partial-unread indexes.
  - **Backend:** `notifications.repository.ts` (insert, list, unread-count, mark-read/all, `participantUsernames`, and a `projectFeed` read-model UNION over `task_comments` + `project_collaborators`), `NotificationCenterService` (single source of truth for who-gets-notified: skips self/Demo User, de-dupes fan-out; `recordCommentNotifications` = mention rows + comment rows for other participants), and a `notification.gateway` (`notification:list|unreadCount|markRead|markAllRead|feed` → self-scoped; feed needs `view`). Write sites wired: collab comment handler (mention + comment, alongside N7's live `mention:notified`), sharing invite (`project_shared`), and the cron (`due_soon` + `ai_suggestion`, both naturally deduped). Emits `notification:new` to `user:<username>`.
  - **Frontend:** `NotificationBellComponent` (topbar bell + unread badge + dropdown inbox, mark-read/mark-all, live `notification:new`) and a per-project `ActivityFeedComponent` dialog opened from an **Activity** button in the project header.
  - **Verified:** new `notification.gateway.test.ts` (2 tests: sharing→durable `project_shared` + list/markRead/unreadCount/feed; comment fan-out = mention row + comment row for others + nothing for author) — **full backend suite 74 green**; `ng build` clean; migration `0010` applied. _`task_assigned` deferred: no assignee field/event exists in the model; the enum is left extensible for a later drop-in._

- [x] **N3** ✅ M · **Global content search.** ⌘K palette now searches content, not just nav/actions.
  - **Backend:** `search.repository.ts` (owner-scoped `ILIKE` UNION over `tasks.taskname`, `task_comments.body`, `screen_elements.name`, and `Text_document` bodies), `search.service.ts` (identity resolve + min-length policy), `GET /search` (`search.routes.ts`, mounted root, `resolveIdentity`/`resolveUsername` like analytics).
  - **Frontend:** `SearchService` (HttpClient, `authHeaders`) + a debounced content-results mode in `command-palette.component.ts` — Commands and Content sections, one unified keyboard flow, hits navigate to the owning project (name→index).

## Enhancements to what exists

- [x] **N4** ✅ M · **Dependency-aware timeline / Gantt view.** New `/dashboard/timeline` route + sidebar/palette entry. `TimelineComponent` renders each ToDoLst as a bar spanning its tasks' `time` range (with done/total progress + a today marker), and draws `ToDoLst.dependsOn` (A2) as SVG dependency arrows — dashed/danger when the predecessor list is still open (reusing the canvas completion rule). Read-only; data via the shared `task-lens.util.ts`.

- [x] **N5** ✅ M · **AI `create_task` tool.** Closes the C1 gap ("no backing agent method today"). Natural-language task creation from chat ("add a task to review the deck Friday, high priority").
  - **Backend:** new pure `src/lib/task-create.ts` (`priorityFromWord` high/medium/low→1/2/3, `resolveDueIso`, `normalizeRepeat`, `findOrCreateTodoList`, `addTaskToProject`) — no DB/socket, fully testable. Added a `create_task` tool to `agent.tools.ts` (schema: project_name, task_name, priority, due_date, list_name, repeat) + a `createTask` on `AgentToolContext`; `Chat_Agent.create_task_by_name` loads the named project (local→hosted), appends the task to a to-do list (creating a "Tasks" list — and a "Main" grid — if the project has none), and persists via the same `saveProject` path the canvas uses (calendar sync + repository transaction). The tool-calling system prompt now includes **today's date** so relative due dates ("Friday", "tomorrow") resolve to concrete ISO dates.
  - **Verified:** new `test/lib/n5.test.ts` (14 tests: priority/date/repeat mapping + find-or-create-list + add-task); **full backend suite 66 green**; backend `tsc` clean. _Persist-only, like the other write tools — the created task appears on next project load._

- [x] **N6** ✅ M · **Kanban board view for tasks.** New `/dashboard/kanban` route + sidebar/palette entry. `KanbanComponent` (CDK drag-drop) with **To Do / In Progress / Done** columns and a project filter; a drop sets the task's lane and persists via `saveProject`. Added a real `status` field: `TaskStatus` enum + `set_status()` on the shared `scheduled_task` (kept in lockstep with `is_done`, single mutation point), `toJSON`/`rebuild` round-trip (legacy rows backfill from `is_done`), migration `0007_task_status.sql` (+ `schema.sql`, `normalizeStatus` guard, load/insert threaded through `project.repository.ts` — mirrors how N7's `repeat` was wired). Verified by `n6.test.ts` (10 tests).

- [x] **N7** ✅ S · **Recurring tasks + @mentions in comments.**
  - **Recurring tasks (full):** `RepeatRule` (`none`/`daily`/`weekly`/`monthly`) + a pure `nextOccurrence()` helper and `scheduled_task.build_next_occurrence()` in the shared model (round-trips through toJSON/rebuild); DB column via migration `0005_task_repeat.sql` (+ CHECK constraint, mirrored in `schema.sql`) persisted in `project.repository.ts` (read-back + both insert branches, guarded by `normalizeRepeat`). Frontend: repeat selector in the add-task composer + a per-task inline control and repeat badge in the fullscreen todo; completing a repeating task spawns its next occurrence in the same list (both the canvas `onTaskToggle` and fullscreen paths).
  - **@mentions (lightweight/live):** pure `parseMentions()` helper; the `task:comment:add` gateway emits `mention:notified` to each mentioned user's `user:<username>` room (same pattern as `ai:suggestion`, skips self), surfaced as a transient toast from the layout shell. **Durable notification history is intentionally deferred to N2** — this is a live push only.
  - **Verified:** new `test/lib/n7.test.ts` (11 tests: recurrence math + mention parsing + toJSON round-trip); full backend suite **31 green**; `ng build` + backend typecheck of the N7 files clean; migration `0005` applied. _A pre-existing unrelated `OAuth.service.ts` typecheck error (surfaced during verification) was subsequently fixed — backend `tsc` is now 0 errors._

- [x] **N8** ✅ M · **Closed the CRDT stale-snapshot limit.** The known B3 limit — an out-of-band whole-project save writing a stale snapshot over live rich-text edits — is fixed: the server Y.Doc is now authoritative on save.
  - **Backend:** `ydoc-registry.ts` gains `getAuthoritativeContent(elementId)` — the resident doc's encoded `ydoc` + `Text_field` mirror, or `null` when no live doc exists (so non-collab elements save unchanged). `ProjectHandler.saveProject` now runs `reconcileWithLiveDocs(serialized)` before the repository write: every `Text_document` with a stable id and a resident doc has its content replaced by the authoritative state, so **no** save path (client whole-project save, N5 `create_task`, calendar-sync re-save) can clobber live edits. A pure `src/lib/ydoc-reconcile.ts` (`preferLiveContent`) holds the one guard — a transient/un-seeded empty doc never wipes non-empty snapshot text (an empty *CRDT-backed* doc is still honoured as a real clear).
  - **Verified:** new `test/lib/n8.test.ts` (4 guard unit tests) + `test/realtime/ydoc-authoritative.test.ts` (2 integration tests: a stale whole-project save no longer overwrites "Live edit"; the empty-doc guard keeps legacy text). **Full backend suite 72 green**; backend `tsc` clean.

## Strategic

- [~] **N9** 🔵 L · **Responsive / PWA web experience.** Native mobile is descoped (FEATURES #12). **Responsive: already done** — viewport meta is set, the layout shell has a mobile drawer + scrim + hamburger (breakpoints at 720/900px), and nearly every screen ships its own media queries (projects uses a fluid `auto-fit minmax` card grid). No further work needed to "show it's responsive." _Remaining (optional, deferred): the installable **PWA** piece (manifest + service worker + offline) and any touch-first polish — needs your call on scope if pursued._

- [x] **N10** ✅ M · **Integrations beyond Google.** ICS calendar feed + Slack/webhook notifications + project export. **No app-level API keys** (unlike the Google integrations): the webhook is a user-supplied URL, the feed is an opaque per-user token.
  - **Schema (`0011_user_integrations.sql` + `schema.sql`):** `user_integrations` (one row/user): `ics_feed_token` UUID (unauthenticated calendar-subscribe secret, like `link_share_token`) + `webhook_url`/`webhook_kind` (`generic`/`slack`). Dedicated table, not the `users.settings` allow-listed JSONB.
  - **Backend:** pure `lib/ics.ts` (RFC-5545 VCALENDAR builder, CRLF/escape/fold) + `lib/project-export.ts` (Markdown renderer); `integrations.repository.ts` (config CRUD + token resolve + `allDatedTasksForUser`); `IntegrationsService` (calendar build + best-effort webhook delivery via `axios`, generic vs Slack payload). Routes: `GET /calendar/:token.ics` (unauthenticated, token-resolved), `GET /export/project?type&name&format=json|md` (JWT + `view` via AccessService), and JWT-authed `/integrations` (get / set webhook / test / regenerate feed). Webhook is wired into the single `NotificationCenterService.notify()` choke-point via an injected side-channel (DIP) so **every** N2 notification mirrors out.
  - **Frontend:** Angular `IntegrationsService`; a Settings → Integrations block (copyable ICS feed URL + regenerate, webhook URL + kind + Save/Test); and a project-detail header **Export** dropdown → Download JSON / Download Markdown / Print (browser Save-as-PDF, rendered client-side from the loaded project).
  - **Verified:** `test/lib/n10.test.ts` (8: ICS + Markdown + webhook payload) + `test/repositories/integrations.repository.test.ts` (4: row lifecycle + calendar build) — **full backend suite 86 green**; `ng build` clean; migration `0011` applied.

---

### How we'll work this
1. You pick an item (e.g. "N1").
2. I scope it (short plan), you confirm.
3. I build + verify in the running app.
4. Cross it off, next one.
