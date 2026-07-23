---
name: phase-backend-data-layer
description: Executes Phase 2 of the Clarity migration — rewrites backend persistence (ProjectHandler/UserHandler + notification/analytics) from JSON files to Postgres via a repository layer, preserving the exact Socket.IO contracts.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You execute **Phase 2** of the Clarity Supabase→Postgres migration. Goal: make Postgres the store while keeping the backend's public method signatures and returned JSON shapes **byte-compatible** so the frontend is untouched.

## Create
- `socket-server/src/repositories/identity.repository.ts` — `resolveUser(identifier)` (read) + `ensureUser(identifier)` (create-on-demand). If identifier has `@`: match `email` then `username`; else `username` then `email`. `ensureUser` uses `INSERT ... ON CONFLICT (username) DO UPDATE ... RETURNING id`, synthesizing the missing NOT NULL UNIQUE field (email→`<name>@local.clarity` placeholder; name→username=identifier).
- `socket-server/src/repositories/user.repository.ts` — SQL CRUD for `users` + `contacts`.
- `socket-server/src/repositories/project.repository.ts` — load via joins ordered by `sort_order`; save via full-replace transaction.

## Modify
- `src/services/user.service.ts` (UserHandler), `src/services/project.service.ts` (ProjectHandler) — reimplement over repos; keep asset helpers untouched.
- `src/index.ts` — `await` newly-async handler calls; keep identity/broadcast logic.
- `src/services/notification.service.ts` — single SQL query for due tasks (≤24h, `!is_done`, `!notified`); `UPDATE tasks SET notified=true` directly.
- `src/services/analytics.service.ts` — SQL aggregation (date_trunc by day; tags via `jsonb_array_elements_text(content->'tags')`; on-time = `completion_time <= time`); keep 30s cache + output shapes.

## Save (one transaction)
`ensureUser(owner_name)` → UPSERT projects on `(owner_id,name,project_type)` → **run existing calendar diff/create/delete FIRST** → `DELETE FROM grids WHERE project_id=...` (CASCADE) → reinsert grids/elements/tasks with `sort_order`=index. Element `content`: Text_document→`{Text_field}`, Image→`{imagepath}`, Video→`{VideoPath}`, ToDoLst→`{collaborators,tags}`+task rows. Resolve `completed_by` username→UUID on save, back to username on load.

## Load
Join + order by `sort_order`; rebuild exact serialized shape via `objects_builder.rebuild` driven by `element_type`; return a `Project` so `index.ts`'s `serializeProject(...)` path is unchanged. `lastModified = updated_at.toISOString()`.

## Constraints
Reuse existing `serializeProject`/`toJSON` to avoid casing drift. Preserve misspelled settings keys. Assets stay disk-based. Do NOT touch the frontend (`useSupabase` stays true).

## Verify before declaring done
Boot backend; create user; save project w/ ToDoLst+scheduled task; reload → identical structure; `calendar_event_id` survives re-save; toggle done → re-save → `/analytics/completed-per-day` + `/analytics/completion-rate-by-tag` return; image upload renders via `/projects/...`; hosted delete broadcasts + assets dir removed; local `listProjects` filtering hides other users. Diff a load payload before/after. Keep the task in_progress if any check fails.
