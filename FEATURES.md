# Clarity — Functionality & Feature Audit

_Proposal claims vs. what is actually built. Audited against the codebase after the Supabase → Postgres migration (Phases 1–6) and the A–G reshape backlog (see `CHANGES.md`). Last reconciled 2026-08-01._

**Legend:** ✅ implemented · ⚠️ partial · ❌ missing · 🚫 descoped (won't build)

## Core proposal features

| # | Feature (from proposal) | Status | Notes / Evidence |
|---|--------------------------|:------:|------------------|
| 1 | Task management (todos, priorities, due dates, completion) | ✅ | `ToDoLst` + `scheduled_task` (priority, `is_done`, `time`, `completion_time`). Full CRUD. |
| 2 | Scheduling (task times, calendar events) | ✅ | ISO task times; Google Calendar event create/delete (`calendar.service.ts`), `calendar_event_id` tracked. |
| 3 | Drag-and-drop canvas / semi-grid workspace | ✅ | Fabric.js canvas (`fabric-canvas.component.ts`): drag, resize, zoom, grid overlay, x/y positioning. |
| 4 | Interconnected task threads (dependencies, dynamic adaptation) | ✅ | **Built (A2):** `ToDoLst.dependsOn: string[]` persisted in `screen_elements.content` JSONB; canvas draws SVG dependency links between ToDoLst cards with a link/pick-target affordance; cascade tints the link green when the blocking element is complete, shows a "blocked" badge otherwise. |
| 5 | Real-time collaborative editing | ✅ | **Built (B1–B3):** granular per-element ops (`element:create/move/update/delete`, room-scoped, persisted, broadcast-except-sender, last-write-wins); presence avatars + live remote cursors (B2); true CRDT text co-editing of `Text_document` via Yjs/Quill (B3, no clobbering among live editors). |
| 6 | Task-level communication / messaging | ✅ | **Built (A3):** `task_comments` table + `comment.repository.ts` + `task:comment:add`/`:list` gateway events (author from JWT) + `task:comment:added` broadcast; comments panel with composer, live updates, and per-task count badge. |
| 7 | Gmail integration (send mail / invites) | ✅ | `gmail.send` scope; email reminders + AI-agent invites (`notification.service.ts`, `invitation.service.ts`). |
| 8 | Google Calendar integration | ✅ | Create/delete events on task scheduling. |
| 9 | Google Contacts integration | ✅ | People API fetch → stored contacts; used for invite routing. |
| 10a | AI: chat assistant | ✅ | LangChain + Gemini 2.5 Flash (`ai.routes.ts`, `agent.service.ts`); chat UI with history. |
| 10b | AI: insights / analysis | ✅ | Productivity stats, bottlenecks, suggestions (`ai-insights.component.ts`). |
| 10c | AI: intelligent scheduling | ✅ | **Now proactive (C2):** the 15-min cron computes suggestions for overdue/undated tasks (LLM `suggest_schedule` when a key exists, else a deadline/priority heuristic), emits `ai:suggestion` + a pull route, surfaced in Insights with a "Proactive" tag. |
| 10d | AI: agent actions (invites, scheduling) | ✅ | **Real tool-calling (C1):** regex intent-routing replaced with Gemini structured tool-calls (`summarize_project`/`suggest_schedule`/`send_invite`), live-verified. |
| 11 | Analytics / graphs / visualizations | ✅ | Chart.js + ng2-charts: completion-rate-by-tag (bar), completed-per-day (line). Backed by SQL now. |
| 12 | Cross-platform mobile (Ionic + Capacitor) | 🚫 | **Descoped — will not build.** Clarity is a web app. (The reshape backlog's A1 had scoped a native Kotlin/Swift track; that is now dropped, not deferred.) |
| 13 | Auth (email/password + Google OAuth2) | ✅ | Backend-issued JWT; email/password (bcrypt) + Google OAuth2 login (`auth.service.ts`, `auth.routes.ts`). |

**Score:** 12/12 in-scope core features working. Mobile (#12) is deliberately descoped, not a gap.

## Frontend routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/`, `/login` | Welcome | Landing / login |
| `/auth/callback` | AuthCallback | OAuth2 token capture |
| `/dashboard` | Layout | Authenticated shell |
| `/dashboard` | Dashboard | Overview |
| `/dashboard/projects` | Projects | List / manage projects |
| `/dashboard/projects/:id` | ProjectDetail | Canvas workspace |
| `/dashboard/tasks` | Tasks | Global task list + filters + calendar view |
| `/dashboard/analytics` | Analytics | Charts |
| `/dashboard/ai-insights` | AiInsights | Insights + AI chat (`@` commands) |
| `/dashboard/settings` | Settings | Profile + Google integrations |

## Bonus features (not in proposal, but built)

- Local vs **hosted** (collaborative) projects with granular per-element realtime, presence avatars + live cursors, and CRDT text co-editing.
- Multi-grid projects; mixed element types (Text / Image / Video / ToDoLst) on one canvas; multi-select, grid snapping, and quick-start templates.
- Collaborators on todo lists; `@`-command autocomplete in AI chat; streamed AI responses + proactive suggestions.
- Cron email reminders (24h before due); ⌘K command palette; first-run onboarding tour.

## Architecture reality (post-migration — supersedes proposal's "no database")

- **Postgres is the single source of truth** (Docker, port 5433) for users, projects, grids, elements, tasks, contacts, oauth. The proposal's "structured JSON objects, no dedicated database" is **no longer true** — that was the starting point we migrated away from.
- **Disk storage** is only for binary **assets** (images/videos), behind `StorageService`/`DiskStorageService`, referenced by path from DB rows. This is correct (blobs on disk, metadata in DB).
- **Socket.IO** is the realtime backbone; **Supabase fully removed**.
- Backend is layered: `http/` routers + `realtime/` gateways + `services/` + `repositories/`; zod validation on inputs.

## Resolved since the original audit (see `CHANGES.md`)

- ✅ Task dependencies/threads (**A2**) and task-level messaging (**A3**) — both built; no longer unbuilt proposal items.
- ✅ Realtime upgraded from whole-project to granular per-element ops + presence/cursors + CRDT text (**B1–B3**).
- ✅ AI intent routing replaced with real tool-calling (**C1**); proactive scheduling added (**C2**); streamed responses (**C3**).
- 🧹 TODO comments + dead/commented code cleaned up (**E1**); pre-existing TS errors fixed (**E2**); Vitest harness added (**E3**).
- 🔒 Dev JWT secret removed / config throws in prod (**D1**); socket auth flipped to strict `AUTH_STRICT=true` (**D2**); auth rate-limiting (**D3**), payload caps (**D4**), CORS tightened (**D5**).

## Remaining scope notes

- 🚫 Cross-platform mobile is **descoped** — Clarity is web-only by decision.
- ⚠️ Known CRDT limit (inherited from B1/B3): an out-of-band whole-project save can still write a stale snapshot; the CRDT guarantees no clobbering among *live* editors.
- 🟢 E4 (shared-models drift): a full published `@clarity/shared-models` package extraction is deferred; both apps still compile the same `.ts` source directly.
