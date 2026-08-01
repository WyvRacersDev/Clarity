# Clarity — SOLID & Design-Pattern Refactor Backlog

_Derived from the 3-agent SOLID/pattern audit (backend services/repos, backend transport, Angular frontend). Only genuine, high-value items are tracked here — pure SOLID/DRY purism has been dropped. Tackle one at a time — scope → build → verify (tsc + 20-test vitest suite + `ng build`) → check off._

**Priority:** 🔴 P0 · 🟡 P1 · 🟢 P2   **Effort:** S (hours) · M (a day) · L (multi-day)
**Status:** `[x]` done · `[~]` partial · `[ ]` open

---

## 0. Bugs (fixed first — done this pass)

- [x] **X1** 🔴 S · **HTTP identity/authorization gap.** `/analytics/*` and `/ai-assistant/*` trusted a spoofable `?username` query param with no token check, while `authenticate` middleware sat unused. Added `resolveIdentity` + `resolveUsername` (`middleware/auth.middleware.ts`) mirroring the socket permissive/strict model: a verified JWT (Bearer header, or `?token=` fallback for SSE) now drives the username, honouring `AUTH_STRICT`. Both routers apply it; the frontend now sends the JWT on these calls (`config/auth-token.ts` + analytics/ai services). _Verified: backend tsc + 20 tests, frontend tsc + build._
- [x] **X2** 🔴 S · **Raw error leak.** `calendar.service.ts` echoed `error.message` to clients on create/delete failure — the exact leak `lib/clientError.ts` prevents. Now logs the real error server-side and returns a sanitized `clientError(...)`. _Verified._

## 1. Done this pass (DRY / SRP, service layer)

- [x] **R1** 🟡 S · **EmailService extraction.** The Gmail-API sender + nodemailer transport were duplicated byte-for-byte in `notification.service` and `invitation.service`. Consolidated into one `services/email.service.ts` (`sendAppEmail` + `sendEmailWithGmailAuth`, lazy transport). Both consumers rewired; dead imports/commented code removed. _Verified._

---

## 2. Open — backend (transport & data)

- [x] **R4** ✅ M · **CollabService (DIP + SRP).** `collab.gateway.ts` no longer imports repositories/ydoc-registry directly. New `services/collab.service.ts` (`CollabService`) owns edit authorization + element ops + task comments + Yjs doc ops; new `realtime/presence.registry.ts` (`PresenceRegistry`) encapsulates the former module-global `roomMembers` map. Both are injected via `GatewayDeps` (constructed once in `index.ts`), so the gateway keeps only transport concerns (validate → call service → ack/broadcast). _Verified: backend tsc + 20 tests (incl. the 2-client collab round-trip + Yjs merge gateway tests, updated to inject the real service), and a **live 2-client session** — element broadcast + id assignment + presence for 2 distinct users._
- [x] **R5** ✅ M · **ContactsService (SRP).** `importGoogleContacts` (OAuth + People API pagination + dedupe-merge + persistence) extracted to `services/contacts.service.ts` (`ContactsService.importGoogleContacts(username)`); `contacts.gateway.ts` is now transport-only (validate → resolve username → call → emit). _Verified: service owns all business logic, gateway ~47 lines._
- [x] **R6** ✅ M · **`onAuthed` gateway wrapper (DRY).** Added higher-order `onAuthed(event, schema, action, handler, opts)` in `collab.gateway.ts` centralizing validate → authorize → element-check → try/catch → `clientError`; applied across all 8 collab handlers. Shared `Register` 3-arg type holds; `user.gateway` conforms. _Verified._
- [x] **R7** ✅ M · **CalendarSyncService (SRP).** ~100 lines of Google-Calendar diff/create/delete extracted to `services/calendar-sync.service.ts` (`syncTasks`, with a `loadPrevious` callback to break the cycle); `ProjectHandler.saveProject` now syncs-for-side-effects → serialize → persist. `ProjectHandler` also implements a `ProjectPaths` interface. _Verified._
- [x] **R8** ✅ M · **Repository boundary (SRP).** Raw SQL moved out of the service layer into dedicated repositories for `analytics.service` → `analytics.repository`, `notification.service` → `notification.repository`, `auth.service` → `auth.repository`, `OAuth.service` → `oauthToken.repository`. All four services now contain zero raw SQL; they keep business logic (bcrypt, JWT, heuristics, caching) and call repository methods. _Verified._

## 3. Cross-cutting (highest value)

- [x] **R11** ✅ L · **Element-type Strategy (OCP).** Two parts, both done:
  **(a) Type detection unified.** Every `Screen_Element` subclass sets an authoritative `type` literal in its constructor (survives frontend minification, unlike `constructor.name`); base `toJSON` prefers it. Added `objects_builder.typeOf()` + `CANVAS_ELEMENT_TYPES` as the SINGLE canonical detector, and pointed the 4 duplicated duck-typing ladders at it (backend `serializeProject` + `resolveElementType`; frontend `getElementType` + `data.service`).
  **(b) Content mapping made polymorphic.** Each subclass now owns its DB `content` JSONB shape via `toContent()`; `objects_builder.contentOf()` derives it. Backend `buildElementContent` delegates to it (write-side), and `serializeElementRow` collapsed its Text/Image/Video branches into a generic content-spread (read-side), leaving only the inherently DB-coupled ToDoLst task-join. Also replaced the whole manual duck-typing serialize block in `serializeProject` with one polymorphic `rebuild(...).toJSON()`, which **fixed a real latent A2 bug** — whole-project socket saves were silently dropping `ToDoLst.dependsOn`. _Verified: backend tsc + 20 tests, frontend tsc + `ng build`, and **two live socket round-trips** — all 4 element types + per-type content (Text_field/imagepath/VideoPath) + ToDoLst tasks/collaborators/tags/dependsOn survived save→Postgres→reload._

## 4. Frontend (god-object splits)

- [x] **R13** ✅ L · **Split `data.service.ts` (883 lines, god service).** Split into three focused collaborators behind a thin `DataService` facade (public API unchanged for all ~11 consumers): `ProjectSerializer` (`project-serializer.service.ts` — all (de)serialization/type-sniffing), `UserStore` (`user-store.service.ts` — current-user stream + in-memory map + localStorage), and `ProjectRepository` (`project-repository.service.ts` — socket CRUD + in-flight status streams). `DataService` keeps only the orchestration that spans state + backend. _Verified: frontend tsc + `ng build`._
- [x] **R15** ✅ S · **Signal/reactive consistency (Observer).** In `tasks.component`, `allTasks`/`filterPriority`/`filterStatus` are now signals and `filteredTasks` is a `computed` — deleting the imperative `applyFilters()` + its manual call sites; the template binds `[ngModel]`/`(ngModelChange)` to the filter signals. No `cdr.detectChanges()` existed here to remove. _Verified: frontend tsc + `ng build`._

_R12 (splitting the 2944-line `project-detail.component.ts` into a `CanvasInteractionService` + `CollabController` + child components) was deliberately dropped — not worth the churn/regression risk on the app's most delicate file._

---

### Status
All tracked items are done. R12 was dropped as not worth doing (see above). Nothing open.
