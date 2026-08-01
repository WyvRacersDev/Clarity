# Clarity

**A unified productivity workspace — tasks, projects, real-time collaboration, and AI in one place.**

Clarity brings task management, an infinite drag-and-drop canvas, real-time
multi-user collaboration, Google integrations, and an AI assistant into a
single web app — so you stop switching between a notes app, a calendar, and a
project board to get one piece of work done.

Built with **Angular 21** and a **Node.js + Socket.IO** backend on a
**PostgreSQL** source of truth.

> Originally built as a university project at **FAST-NUCES, Lahore**
> (Object-Oriented Analysis & Design). The course was graded on the analysis
> and design phases and on the correct application of **design patterns and
> SOLID principles** — see [Design & Architecture](#design--architecture) and
> the archived design artifacts in [`docs/design/`](./docs/design/).

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Design & Architecture (Patterns + SOLID)](#design--architecture)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Design Documents](#design-documents)
- [Limitations & Known Issues](#limitations--known-issues)
- [Authors](#authors)

---

## Features

Every proposal feature is built and working (mobile via Ionic/Capacitor was
deliberately descoped — Clarity is a web app).

**Canvas workspace**
- Infinite, Canva-style canvas with pan, zoom (25%–300%), grid overlay, and a mini-map — a **custom implementation** (no external canvas engine).
- Mixed element types on one canvas: **To-do lists, text documents, images, videos**; multi-grid projects, multi-select, and quick-start templates.
- **Interconnected task threads** — to-do lists can declare `dependsOn` links; the canvas draws dependency arrows and shows a "blocked" badge until the blocking list completes.

**Real-time collaboration**
- Granular per-element operations (`create` / `move` / `update` / `delete`), room-scoped and broadcast to peers, with last-write-wins reconciliation and reconnect-safe replay/dedup.
- **Live presence** — avatars in the project header + remote cursors on the canvas.
- **CRDT text co-editing** of text documents via **Yjs + Quill** (no clobbering between live editors).
- **Comments pinned to canvas elements** (thread + resolve), anchored through pan/zoom.
- **Version history** — whole-canvas snapshots (auto-on-save + manual named checkpoints) with one-click restore.

**Tasks & scheduling**
- Priorities, due dates, tags, completion tracking, collaborators.
- Global task list with filters and a calendar view.
- Google Calendar sync — scheduled tasks create/delete calendar events.

**Chat**
- Project channels + direct messages over Socket.IO: reactions, attachments, threaded replies, `@mentions` → notifications, and a shared "Join call" (Google Meet / Jitsi) link.

**AI assistant** (Google Gemini via LangChain)
- Project-aware chat with real **tool-calling**: summarize a project, find what's blocked, suggest schedules, send invites, and turn a chat thread into tasks.
- Proactive scheduling suggestions (cron) and productivity insights.

**Google integrations** — OAuth2 login + Gmail (invites/notifications), Calendar (event sync), Contacts (invite routing).

**Analytics** — completion-rate-by-tag and completed-per-day charts (Chart.js), backed by SQL.

**Quality-of-life** — backend-issued JWT auth (email/password + Google OAuth2), ⌘K command palette, first-run onboarding tour, email reminders (24h before due), notification center.

---

## Tech Stack

| Layer | Technology |
|------|------------|
| **Frontend** | Angular 21 (standalone, zoneless, SSR), Angular Material + CDK, RxJS, TypeScript |
| **Realtime / text** | Socket.IO client, Yjs + Quill (CRDT), quill-cursors |
| **Charts** | Chart.js + ng2-charts |
| **Backend** | Node.js, Express 5, Socket.IO 4, TypeScript (run via `tsx`) |
| **Database** | PostgreSQL 16 — the single source of truth (Docker, host port 5433) |
| **Auth** | Backend-issued JWT (bcrypt email/password) + Google OAuth2; authenticated Socket.IO handshake |
| **AI** | LangChain + Google Gemini |
| **Integrations** | Google APIs (Gmail, Calendar, Contacts), Nodemailer |
| **Validation** | Zod on inbound HTTP + Socket.IO payloads |
| **Testing** | Vitest (backend), Karma + Jasmine (frontend) |

> **Note:** Persistence originally used "structured JSON objects, no database"
> (as written in the proposal). It has since migrated to a **PostgreSQL**
> source of truth; the local filesystem is used only for binary **assets**
> (images/videos), referenced by path from DB rows.

---

## Architecture

```
Angular 21 SPA  ──HTTP (REST)──▶  Express 5 routers  (http/)
      │                                  │
      └──── Socket.IO (realtime) ───▶  Gateways        (realtime/)
                                         │
                                     Services          (services/)   ← business logic
                                         │
                                     Repositories      (repositories/) ← SQL only
                                         │
                                     PostgreSQL 16
```

The backend is layered so that **transport, business logic, and persistence
stay separate**:

- **`http/`** — Express routers (auth, analytics, AI, Google, search, export, …).
- **`realtime/`** — Socket.IO gateways; a single `onAuthed(...)` wrapper handles validate → authorize → element-check → error-shaping once per handler.
- **`services/`** — business logic (auth, collaboration, calendar sync, contacts, AI agent, notifications).
- **`repositories/`** — the only place raw SQL lives; services depend on repository methods, never the DB directly.
- **`infrastructure/`** — DB pool, migrations, seeds.
- **Zod** validates every inbound payload; JWT identity is resolved on both HTTP and the Socket.IO handshake (permissive in dev, strict in production).

---

## Design & Architecture

Clarity was graded on **object-oriented design**, so patterns and SOLID were
applied deliberately, not decoratively.

### Design patterns

| Pattern | Where it lives |
|---------|----------------|
| **Repository** | `repositories/*.repository.ts` (backend) and `services/project-repository.service.ts` (frontend) isolate all data access. |
| **Strategy / Polymorphism** | Each `Screen_Element` subclass (`Text_document`, `Image`, `Video`, `ToDoLst`) owns its own type literal and `toContent()` DB shape — one polymorphic path instead of type-checking ladders. |
| **Factory / Builder** | `objects_builder.rebuild()` reconstructs the correct element subclass from serialized data. |
| **Facade** | `DataService` presents a stable surface over serialization + socket + state collaborators. |
| **Registry** | `PresenceRegistry` owns room membership / presence instead of a module-global map. |
| **Decorator-style wrapper** | `onAuthed(event, schema, action, handler)` composes the validate→authorize→guard→try/catch pipeline around each gateway handler. |
| **Observer** | Angular signals (`signal`/`computed`) for derived UI state; RxJS + Socket.IO events for realtime streams. |
| **Singleton** | Angular services via `providedIn: 'root'`. |
| **Template Method** | `toJSON()` / `toContent()` defined in `Screen_Element` and specialized per subclass. |

### SOLID

- **SRP** — god-services were split: `EmailService` (one sender), `CollabService` (edit auth + element ops out of the gateway), `CalendarSyncService` (calendar diff out of `saveProject`), and the frontend `DataService` → `ProjectSerializer` + `UserStore` + `ProjectRepository`.
- **OCP** — adding a new canvas element type means adding a subclass, not editing detection ladders in four places.
- **LSP** — every `Screen_Element` subtype is substitutable wherever the base type is used.
- **ISP** — `ProjectPaths` exposes only the path helpers `DiskStorageService` needs, not the whole `ProjectHandler`.
- **DIP** — gateways receive `CollabService` / `PresenceRegistry` via injected `GatewayDeps` (constructed once in `index.ts`) rather than importing repositories directly.

---

## Repository Structure

```
clarity/
├── docs/
│   └── design/                     # Archived academic design docs (proposal, diagrams, Figma)
├── docker-compose.yml              # Local PostgreSQL (host port 5433)
├── README.md
└── angular+socket/
    ├── package.json                # Backend deps + scripts (dev/build/db:*/test)
    ├── vitest.config.ts
    ├── chat-frontend/              # Angular 21 client
    │   └── src/app/
    │       ├── components/         # ai-insights, analytics, assistant, chat, command-palette,
    │       │                       #   contacts, dashboard, kanban, layout, notification-bell,
    │       │                       #   projects (canvas), settings, tasks, timeline, tour, welcome
    │       ├── services/           # socket, collab, ai, data, project-repository, …
    │       ├── schemas/            # Zod schemas for inbound socket payloads
    │       ├── guards/  config/  shared/  utils/
    ├── socket-server/              # Express + Socket.IO backend
    │   ├── src/
    │   │   ├── index.ts            # Entry point (wires deps, starts server)
    │   │   ├── http/               # Express routers
    │   │   ├── realtime/           # Socket.IO gateways + presence registry
    │   │   ├── services/           # Business logic
    │   │   ├── repositories/       # SQL data access
    │   │   ├── infrastructure/     # DB pool, migrate, seed
    │   │   ├── middleware/  lib/  validation/  config/
    │   ├── db/
    │   │   ├── migrations/         # Numbered SQL migrations (0001 … 0015)
    │   │   └── schema.sql
    │   └── test/                   # Vitest suites
    └── shared_models/              # TypeScript models shared by both apps
        └── models/                 # project, screen-elements, user, ai-agent
```

---

## Getting Started

### Prerequisites

- **Node.js 20+** and npm
- **Docker** (for the PostgreSQL container)
- *(Optional)* a **Google Gemini API key** for AI features and **Google OAuth credentials** for Gmail/Calendar/Contacts — the core app runs without them.

### 1. Install dependencies

```bash
# from the repo root
cd angular+socket
npm install

cd chat-frontend
npm install
cd ..
```

### 2. Configure the backend environment

The backend requires `socket-server/.env` to exist. Copy the template and fill it in:

```bash
cp socket-server/.env.example socket-server/.env
```

Minimum keys to boot locally: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`
(a placeholder is fine — the AI agent is constructed at startup). See
[Configuration](#configuration) below.

### 3. Start the database and apply migrations

```bash
# from angular+socket/
npm run db:up        # starts PostgreSQL on host port 5433
npm run db:migrate   # applies db/migrations
npm run db:seed      # optional: seed demo data
```

### 4. Run the backend

```bash
# from angular+socket/
npm run dev
```

Look for `🚀 Server running on http://0.0.0.0:3000`.

### 5. Run the frontend

```bash
# from angular+socket/chat-frontend/
npm start
```

Open **http://localhost:4200**.

> **Ports:** PostgreSQL `5433` · backend `3000` · frontend `4200`.

---

## Configuration

Backend config lives in `angular+socket/socket-server/.env` (gitignored). The
committed `.env.example` documents every key; the essentials:

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` enables fail-fast checks (missing `JWT_SECRET`/`DATABASE_URL` throw; wildcard CORS refused). |
| `DATABASE_URL` | PostgreSQL connection string (defaults to the Docker Compose Postgres in dev). |
| `JWT_SECRET` | Signs the backend's JWTs. Required in production. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `GEMINI_API_KEY` | Google Gemini key for the AI assistant. |
| `SERVER_HOST` / `SERVER_PORT` | Backend bind address (default `0.0.0.0:3000`). |
| `FRONTEND_URL` | Used for OAuth redirects and CORS allow-list. |
| `SOCKET_CORS_ORIGIN` | Comma-separated allowed browser origins (`*` allowed in dev, refused in prod). |
| `AUTH_STRICT` | `true` rejects tokenless/invalid Socket.IO handshakes. |

Google integration additionally expects OAuth credentials at
`socket-server/credentials.json`; the server writes `tokens.json` after
authorization. Both are gitignored.

---

## Scripts

**Backend** — from `angular+socket/`:

| Script | Description |
|--------|-------------|
| `npm run dev` | Run the server with `tsx` (development). |
| `npm run build` | Compile TypeScript. |
| `npm start` | Run the compiled server. |
| `npm run db:up` / `db:down` | Start / stop the PostgreSQL container. |
| `npm run db:migrate` | Apply SQL migrations. |
| `npm run db:seed` / `db:seed-google` | Seed demo / Google data. |
| `npm test` | Run the Vitest suite. |

**Frontend** — from `angular+socket/chat-frontend/`:

| Script | Description |
|--------|-------------|
| `npm start` | Angular dev server. |
| `npm run build` | Production build. |
| `npm run watch` | Dev build with hot reload. |
| `npm test` | Karma + Jasmine unit tests. |

---

## Design Documents

The academic artifacts (kept as the project's record) live in
[`docs/design/`](./docs/design/):

| Phase | Deliverable |
|------|-------------|
| Proposal | Vision, scope, objectives, literature review |
| Phase 1 | Use-case diagram + descriptions, analysis class diagram |
| Phase 2 | Activity, sequence & state diagrams, design class diagram |
| Phase 3 | Figma UI design (video walkthrough + [live file](https://www.figma.com/design/4Yx1Epgv0W4xSCsVkuK4ee/Clarity-designing?node-id=0-1)) |
| Phase 4 | This implementation |

Some early-phase details evolved during implementation (most notably
persistence moving to PostgreSQL); this README describes the current system.

---

## Limitations & Known Issues

- **Web only** — native mobile (Ionic/Capacitor) was descoped.
- **Single server instance** — no built-in horizontal scaling; presence/room state is in-memory.
- **No offline mode** — requires a live server connection.
- **CRDT edge case** — an out-of-band whole-project save can still write a stale snapshot; the CRDT only guarantees no clobbering among *live* editors.
- **External quotas** — Google APIs and Gemini are subject to rate limits (e.g. Gemini `429`s under heavy use).
- **Asset uploads** — capped (default 100 MB) and stored on the server's local disk.

---

## Authors

| Name | Roll Number |
|------|-------------|
| Mohammad Hamza Iqbal | 23L-0848 |
| Bilal Kashif | 23L-0757 |
| Mawahid Abbas | 23L-0613 |

_National University of Computer and Emerging Sciences (FAST-NUCES), Lahore —
Department of Computer Science. Course Instructor: Sir Zeeshan Nazar._
