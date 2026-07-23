# Clarity — Functionality & Feature Audit

_Proposal claims vs. what is actually built. Audited against the codebase after the Supabase → Postgres migration (Phases 1–6a)._

**Legend:** ✅ implemented · ⚠️ partial · ❌ missing

## Core proposal features

| # | Feature (from proposal) | Status | Notes / Evidence |
|---|--------------------------|:------:|------------------|
| 1 | Task management (todos, priorities, due dates, completion) | ✅ | `ToDoLst` + `scheduled_task` (priority, `is_done`, `time`, `completion_time`). Full CRUD. |
| 2 | Scheduling (task times, calendar events) | ✅ | ISO task times; Google Calendar event create/delete (`calendar.service.ts`), `calendar_event_id` tracked. |
| 3 | Drag-and-drop canvas / semi-grid workspace | ✅ | Fabric.js canvas (`fabric-canvas.component.ts`): drag, resize, zoom, grid overlay, x/y positioning. |
| 4 | Interconnected task threads (dependencies, dynamic adaptation) | ❌ | No task-to-task dependency/threading model anywhere. Proposal's headline differentiator is unbuilt. |
| 5 | Real-time collaborative editing | ⚠️ | Works, but **coarse**: whole-project broadcast (`hostedProjectUpdated`), not per-element. No conflict handling. |
| 6 | Task-level communication / messaging | ❌ | No comments/threads on tasks. AI chat is separate. |
| 7 | Gmail integration (send mail / invites) | ✅ | `gmail.send` scope; email reminders + AI-agent invites (`notification.service.ts`, `invitation.service.ts`). |
| 8 | Google Calendar integration | ✅ | Create/delete events on task scheduling. |
| 9 | Google Contacts integration | ✅ | People API fetch → stored contacts; used for invite routing. |
| 10a | AI: chat assistant | ✅ | LangChain + Gemini 2.5 Flash (`ai.routes.ts`, `agent.service.ts`); chat UI with history. |
| 10b | AI: insights / analysis | ✅ | Productivity stats, bottlenecks, suggestions (`ai-insights.component.ts`). |
| 10c | AI: intelligent scheduling | ⚠️ | "Suggest schedule for project" via chat command; not proactive/automatic. |
| 10d | AI: agent actions (invites, scheduling) | ⚠️ | Sends invites via prompt-pattern matching; brittle (regex intent routing), limited action set. |
| 11 | Analytics / graphs / visualizations | ✅ | Chart.js + ng2-charts: completion-rate-by-tag (bar), completed-per-day (line). Backed by SQL now. |
| 12 | Cross-platform mobile (Ionic + Capacitor) | ❌ | **Web-only.** No `@ionic`/`@capacitor` installed. Proposal claim not met. |
| 13 | Auth (email/password + Google OAuth2) | ✅ | Backend-issued JWT; email/password (bcrypt) + Google OAuth2 login (`auth.service.ts`, `auth.routes.ts`). |

**Score:** ~10/13 core features working (with caveats on realtime granularity and AI robustness).

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

- Local vs **hosted** (collaborative) projects with live broadcast.
- Multi-grid projects; mixed element types (Text / Image / Video / ToDoLst) on one canvas.
- Collaborators on todo lists; `@`-command autocomplete in AI chat.
- Cron email reminders (24h before due).

## Architecture reality (post-migration — supersedes proposal's "no database")

- **Postgres is the single source of truth** (Docker, port 5433) for users, projects, grids, elements, tasks, contacts, oauth. The proposal's "structured JSON objects, no dedicated database" is **no longer true** — that was the starting point we migrated away from.
- **Disk storage** is only for binary **assets** (images/videos), behind `StorageService`/`DiskStorageService`, referenced by path from DB rows. This is correct (blobs on disk, metadata in DB).
- **Socket.IO** is the realtime backbone; **Supabase fully removed**.
- Backend is layered: `http/` routers + `realtime/` gateways + `services/` + `repositories/`; zod validation on inputs.

## Known gaps / half-built / tech debt

- ❌ Task dependencies/threads, ❌ task-level messaging, ❌ mobile (Ionic/Capacitor) — the three unbuilt proposal items.
- ⚠️ Realtime is whole-project (no per-element ops, no presence/cursors) — Phase 6b target.
- ⚠️ AI intent routing is regex/prompt-pattern based — fragile.
- 🧹 TODO comments + dead/commented code (e.g. `screen-elements.model.ts:104` "put all other screen element classes here"; non-English TODO notes).
- 🔒 Dev JWT secret + permissive socket auth still in place (see `CHANGES.md`).
