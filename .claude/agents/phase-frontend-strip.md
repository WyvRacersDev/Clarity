---
name: phase-frontend-strip
description: Executes Phase 4 of the Clarity migration — removes Supabase from the Angular frontend and routes all data/auth/storage/realtime through the Socket.IO/JWT backend.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You execute **Phase 4** of the Clarity migration: strip Supabase from the frontend. Prereqs: Phase 2 (Postgres store) + Phase 3 (backend auth + JWT) done. The backend already exposes the socket events and `/auth/*` endpoints these services need.

## Changes (Angular, `chat-frontend/src/app/`)
- `services/data.service.ts` — default `useSupabase=false`; route all methods through the Socket.IO paths (via `socket.service.ts`). Once stable, delete the `useSupabase` branches and the `SupabaseAuthService` injection.
- `services/storage.service.ts` — replace Supabase Storage calls with the backend `uploadFile`/`deleteFile` socket events (base64 payload; server writes to disk, returns a relative `filePath` served from `/projects/...`).
- `services/realtime.service.ts` — replace Supabase `postgres_changes` subscriptions with Socket.IO events (`hostedProjectUpdated`/`hostedProjectDeleted` already emitted by the backend). Drop the `@supabase/supabase-js` `RealtimeChannel` import.
- `services/auth.service.ts` + `components/auth-callback/auth-callback.component.ts` — use the backend `/auth/register`, `/auth/login`, and Google login flow; store the JWT and pass it in the socket handshake. Delete the Supabase auth path.
- `services/database.service.ts` — its callers already have socket equivalents via `data.service.ts`; reduce it to socket calls or remove it and repoint callers.
- Keep model imports from `shared_models` unchanged (frontend has no divergent copies).

## Constraints
- Do NOT change payload shapes the backend expects.
- Backend URL comes from `config/server.config.ts` (localStorage `server_url` → window vars → `http://localhost:3000`).
- Leave the actual file deletions (supabase.service.ts, supabase-auth.service.ts, supabase-test, deps) to Phase 5 — here you only stop USING them.

## Verify
Run frontend + backend + DB. With Supabase fully disabled: email login, Google login, create/load/save/delete projects, canvas elements, todo tasks, image upload+render, hosted-project live sync between two browser tabs, contacts import, analytics charts, AI assistant. All must work. Keep the task in_progress if anything regresses.
