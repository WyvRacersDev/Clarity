---
name: migrate-phase
description: Execute one phase of the Clarity Supabase→Postgres migration with pre-checks and per-phase verification. Use when asked to run/continue a migration phase (2–6).
---

# Migrate Phase

Drives the Clarity Supabase→Postgres migration **one phase at a time**. Full design lives in the approved plan and in memory (`supabase-to-postgres-migration`, `clarity-backend-design`).

## Principle
Phases 2–4 preserve the **exact Socket.IO payload contracts** so the frontend needs near-zero change until Phase 4. Never change a contract shape and a backing store in the same step without re-verifying byte-compatibility.

## Per-phase executor agents
Delegate the heavy lifting to the matching agent, then verify:
- Phase 2 → `phase-backend-data-layer`
- Phase 3 → `phase-auth`
- Phase 4 → `phase-frontend-strip`
- Phase 5 (cleanup) → do directly (mechanical deletes; see plan inventory)

## Procedure for any phase
1. **Pre-checks:** DB up + migrated (`clarity-db`), backend boots, git working tree noted.
2. **Execute** the phase scope (or dispatch its executor agent).
3. **Verify** using that phase's checklist in the plan file. Do not mark complete on partial work or failing verification.
4. **Report** what changed + verification results; then stop and await go-ahead for the next phase.

## Phase verification anchors
- **P2:** save→load a project with a ToDoLst+task; `calendar_event_id` survives re-save; ordering preserved; `/analytics/*` return; image upload renders; hosted delete broadcasts. Diff a load payload before/after.
- **P3:** register→JWT→socket-with-token→saveProject sets `owner_id` = token `sub`; tokenless rejected (strict); Google login creates then reuses one `user_id`.
- **P4:** app fully works with Supabase disabled (login, projects, canvas, tasks, upload, live sync across two tabs, analytics, AI).
- **P5:** `grep -ri supabase` over both `src` trees is clean; both apps build.
