---
name: phase-auth
description: Executes Phase 3 of the Clarity migration — backend-issued auth (Google OAuth2 + email/password), JWT, and authenticated Socket.IO handshake, rolled out permissive→strict.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You execute **Phase 3** of the Clarity migration: move auth server-side. Prereq: Phase 2 done (Postgres is the store; `resolveUser`/`ensureUser` exist).

## Create
- `socket-server/src/services/auth.service.ts` — `registerWithPassword`/`loginWithPassword` (bcryptjs vs `users.password_hash`), `issueJwt`/`verifyJwt` (use `JWT_SECRET`/`JWT_EXPIRES_IN` from `config/index.ts`; claims `{sub:userId, username, email}`), `findOrCreateUserFromGoogle` + `linkGoogleIdentity` (rows in `oauth_identities`).
- `socket-server/src/routes/auth.routes.ts` — `POST /auth/register`, `POST /auth/login`, Google login start + callback.
- `socket-server/src/middleware/socketAuth.ts` — `io.use` handshake middleware: read `socket.handshake.auth.token`, `verifyJwt`, set `socket.data.user`.

## Modify
- `src/index.ts` — mount auth routes; add `io.use(socketAuth)`; in handlers derive identity from `socket.data.user` (NOT trusting payload `owner_name`/`username` for authorization) while keeping payload SHAPES identical. `identifyUser` becomes a harmless no-op.
- Google login: reuse `getGlobalOAuthClient()` + the `/oauth2callback` pattern but **distinguish login from calendar-connect** (via `state=login` or separate routes) so the existing `oauth=success&id=` calendar redirect does not regress. Still call `saveUserTokens(email, tokens)`. Calendar/notification paths key on **email** → pass `socket.data.user.email`.
- Frontend (minimal): `services/socket.service.ts` connects `io(url, { auth: { token } })`; store JWT from login response. This is the only frontend change in Phase 3.

## Rollout ordering (no mid-flight breakage)
1. Add endpoints + JWT issue/verify + Google linking, socket enforcement OFF.
2. Frontend obtains/stores JWT and sends it in the handshake while `io.use` is **permissive** (tokenless → fall back to legacy identity + warn).
3. Flip to **strict** (reject tokenless) once all clients send tokens; drop payload-trust and the `userSessions` map.

## Verify
register → JWT → socket-with-token → saveProject sets `projects.owner_id` = token `sub` (ignoring client `owner_name`); tokenless handshake rejected in strict mode; loading another user's local project denied even if payload lies; new Google email creates `users`+`oauth_identities`, second login reuses the same `user_id`; existing calendar connect still works. Watch token-expiry reconnect and identity continuity (token username must resolve to the same owning `users.id`).
