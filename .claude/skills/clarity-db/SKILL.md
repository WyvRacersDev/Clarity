---
name: clarity-db
description: Manage Clarity's local Postgres database (up, down, migrate, reset, psql, inspect). Use for any database lifecycle task on the Clarity project.
---

# Clarity DB

Postgres is the single source of truth for Clarity's backend. It runs in Docker (`clarity-postgres`) on host port **5433**. Connection: `postgres://clarity:clarity@localhost:5433/clarity` (`DATABASE_URL`).

Schema lives at `app/socket-server/db/schema.sql` and is idempotent (safe to re-run). Runner: `app/socket-server/db/migrate.ts`.

## Commands (run from `app/`)
- **Up:** `npm run db:up` → `docker compose -f ../docker-compose.yml up -d`
- **Down (keep data):** `npm run db:down`
- **Migrate / apply schema:** `npm run db:migrate`
- **Reset (WIPE + recreate):**
  ```bash
  docker compose -f ../docker-compose.yml down -v && npm run db:up
  # wait for healthy, then:
  npm run db:migrate
  ```

## Inspect (via container)
- List tables: `docker exec clarity-postgres psql -U clarity -d clarity -c "\dt"`
- Describe a table: `docker exec clarity-postgres psql -U clarity -d clarity -c "\d <table>"`
- Ad-hoc query: `docker exec clarity-postgres psql -U clarity -d clarity -c "SELECT ..."`

## Tables
`users`, `oauth_identities`, `contacts`, `projects`, `grids`, `screen_elements`, `tasks`, `project_collaborators`, `google_credentials`, `oauth_tokens`.

## Gotchas
- Port is **5433**, not 5432 (a local Postgres occupies 5432). If you get `role "clarity" does not exist`, you're hitting the wrong Postgres — confirm you're on 5433.
- `down -v` deletes the volume `clarity_pgdata` and all data.
