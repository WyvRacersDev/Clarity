---
name: run-clarity
description: Launch the full Clarity stack (Postgres + Socket.IO backend + Angular frontend) and verify all three are up. Use when asked to run, start, or boot the Clarity app locally.
---

# Run Clarity

Clarity has three processes. Start them in order and verify each.

## Ports
- Postgres (Docker): host **5433** (container 5432) — chosen to avoid a local Postgres on 5432
- Backend (Express + Socket.IO): **3000**
- Frontend (Angular dev server): **4200**

## Steps

1. **Database** — from repo root:
   ```bash
   docker compose up -d
   # wait for healthy:
   for i in $(seq 1 20); do hs=$(docker inspect --format='{{.State.Health.Status}}' clarity-postgres 2>/dev/null); [ "$hs" = "healthy" ] && break; sleep 1; done
   ```
   Then ensure schema is applied: `cd angular+socket && npm run db:migrate`

2. **Backend** — from `angular+socket/` (run in background, log to a file):
   ```bash
   npm run dev > /tmp/clarity-backend.log 2>&1 &
   ```
   Success line in the log: `🚀 Server running on http://0.0.0.0:3000`.

3. **Frontend** — from `angular+socket/chat-frontend/` (background):
   ```bash
   npm start > /tmp/clarity-frontend.log 2>&1 &
   ```
   Success line: `➜  Local:   http://localhost:4200/`.

## Verify
- `lsof -iTCP:5433 -sTCP:LISTEN` (via Docker), `:3000`, `:4200` all listening.
- `curl -s http://localhost:3000/profile` returns JSON (proves backend↔Postgres).
- Report the URL **http://localhost:4200** to the user.

## Notes
- First run needs deps: `npm install` in both `angular+socket/` and `angular+socket/chat-frontend/`.
- Backend requires `socket-server/.env` to EXIST (it calls `loadEnvFile` directly and crashes if absent). Minimum keys: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY` (placeholder ok).
- If the backend crashes on `GOOGLE_API_KEY`/Gemini, set a non-empty `GEMINI_API_KEY` placeholder — the AI agent is constructed at boot.
- AI assistant and Google integration need real keys/credentials; the core app runs without them.
