# Clarity — SOLID & Design-Pattern Record

_Where SOLID principles and design patterns were applied during the refactor pass. Companion to [REFACTOR.md](REFACTOR.md) (the backlog); this file is the "what/where" record. Item IDs (R1, R4, …) map back to the backlog._

**Legend:** SRP · Single Responsibility · OCP · Open/Closed · LSP · Liskov · ISP · Interface Segregation · DIP · Dependency Inversion

---

## Design patterns applied

| Pattern | Where | Files | Item |
|---|---|---|---|
| **Repository** | Raw SQL pulled out of the service layer into dedicated repositories; services depend on repository methods, not the DB. | `repositories/analytics.repository.ts`, `notification.repository.ts`, `auth.repository.ts`, `oauthToken.repository.ts` | R8 |
| **Repository** (frontend) | Socket CRUD isolated behind a project repository. | `services/project-repository.service.ts` | R13 |
| **Facade** | `DataService` reduced to a thin facade delegating to three collaborators; unchanged public API for ~11 consumers. | `services/data.service.ts` | R13 |
| **Strategy / Polymorphism** | Each `Screen_Element` subclass owns its own type literal + `toContent()` DB shape; callers use one polymorphic path instead of duck-typing ladders. | `shared_models/models/screen-elements.model.ts`, `objects_builder.typeOf()` / `contentOf()` | R11 |
| **Higher-order handler (Decorator-style wrapper)** | `onAuthed(event, schema, action, handler, opts)` wraps validate → authorize → element-check → try/catch → `clientError` once, instead of copy-pasting the sequence per handler. | `realtime/collab.gateway.ts` | R6 |
| **Registry** | Room membership / presence pulled out of a module-global map into an injectable registry. | `realtime/presence.registry.ts` (`PresenceRegistry`) | R4 |
| **Observer (Angular signals)** | Filter/derived state modeled as `signal` + `computed` so views re-derive automatically; imperative recompute + manual calls removed. | `components/tasks/tasks.component.ts`, `tasks.component.html` | R15 |

---

## SOLID principles applied

### Single Responsibility (SRP)

| What | Files | Item |
|---|---|---|
| **EmailService** — Gmail-API sender + nodemailer transport, duplicated byte-for-byte across two services, consolidated into one. | `services/email.service.ts` (consumers: `notification.service`, `invitation.service`) | R1 |
| **CollabService** — edit authorization + element ops + task comments + Yjs doc ops moved out of the gateway; gateway keeps only transport. | `services/collab.service.ts`, `realtime/collab.gateway.ts` | R4 |
| **ContactsService** — the ~120-line `importGoogleContacts` (OAuth + People API pagination + dedupe-merge + persistence) moved out of the gateway. | `services/contacts.service.ts`, `realtime/contacts.gateway.ts` | R5 |
| **CalendarSyncService** — ~100 lines of Google-Calendar diff/create/delete lifted out of `ProjectHandler.saveProject`, which now serializes + persists only. | `services/calendar-sync.service.ts`, `services/project.service.ts` | R7 |
| **Repository boundary** — services keep business logic (bcrypt, JWT, heuristics, caching); repositories own persistence. | see Repository row above | R8 |
| **data.service split** — one god-service → `ProjectSerializer` (translation), `UserStore` (state + localStorage), `ProjectRepository` (socket CRUD), `DataService` (orchestration). | `services/project-serializer.service.ts`, `user-store.service.ts`, `project-repository.service.ts`, `data.service.ts` | R13 |

### Open/Closed (OCP)

| What | Files | Item |
|---|---|---|
| **Element-type Strategy** — adding a new canvas element type means adding a subclass with its `type`/`toContent()`, not editing duck-typing ladders in 4 places. Also fixed a latent bug (whole-project saves dropping `ToDoLst.dependsOn`). | `shared_models/models/screen-elements.model.ts` + backend/frontend detectors | R11 |

### Interface Segregation (ISP)

| What | Files | Item |
|---|---|---|
| **ProjectPaths** — `ProjectHandler`'s path/dir responsibility expressed as a narrow interface, so `DiskStorageService` depends on that instead of the whole concrete handler. | `services/project.service.ts` | R7 |

### Dependency Inversion (DIP)

| What | Files | Item |
|---|---|---|
| **Gateway → service injection** — `collab.gateway` no longer imports repositories / ydoc-registry directly; `CollabService` + `PresenceRegistry` are injected via `GatewayDeps` (constructed once in `index.ts`). | `realtime/collab.gateway.ts`, `services/collab.service.ts`, `index.ts` | R4 |
| **Facade over collaborators** — components depend on `DataService`'s stable surface; the socket/serialization/state details sit behind it. | `services/data.service.ts` | R13 |

---

## Security / correctness fixes made alongside (not SOLID, recorded for completeness)

- **X1** — HTTP identity/authorization gap on `/analytics/*` and `/ai-assistant/*` closed with `resolveIdentity`/`resolveUsername` (`middleware/auth.middleware.ts`), mirroring the socket permissive/strict model.
- **X2** — raw `error.message` leak in `calendar.service.ts` replaced with server-side logging + sanitized `clientError(...)`.

---

## Deliberately not applied (churn without payoff)

Dropped from the backlog as "refactoring for its own sake" — kept here so the decision is recorded:

- **R9** — cosmetic `project.repository` DRY.
- **R10** — DI-seam purism (extract `IProjectHandler`/`IUserHandler` + constructor-inject with no test driving it).
- **R14** — DIP-facade purism (routing components through a `CollabService` facade when direct `SocketService` use works fine).
- **R12** — splitting the 2944-line `project-detail.component.ts` (`CanvasInteractionService` + `CollabController` + child components). Parked: the regression risk on the app's most delicate file (live drag/resize/marquee/realtime collab) isn't justified without runtime testing.
