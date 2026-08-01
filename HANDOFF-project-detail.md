# Handoff — Project-detail stabilize + decomposition (Stage 1)

**Branch:** `hamza-clarity`
**Date:** 2026-08-01
**Status:** Stabilize pass complete + verified. Decomposition Stage 1 complete + verified. Stages 2–5 not started. Nothing committed.

This document is a handoff for another terminal/developer. It covers three pieces of work done this session, all in the Angular frontend (`angular+socket/chat-frontend`).

---

## 0. TL;DR

- The "inside a project" screen (`project-detail.component.ts`, ~3000 lines) was the app's most troubled screen (visual, bugs, perf, code size).
- **Fixed the headline bug:** it leaked 7 `document` event listeners + 4 RxJS subscriptions + a timer on every visit — the screen got slower/jankier the more you navigated in/out. Now cleaned up. **Verified live** (listener count stays flat across 6 nav cycles).
- **Fixed 3 theme-breaking colors** (hardcoded `#FFFFFF` on accent backgrounds → `var(--text-inverse)`).
- **Started the decomposition:** extracted the fullscreen todo + comments overlay (~250 lines) into a new child component `app-fullscreen-todo`. Builds clean, verified working.
- **Also (separate small task):** added a **Share** button to hosted project cards on the projects list, reusing the existing share dialog.

---

## 1. Files changed this session

### Stabilize pass — `project-detail`
- `src/app/components/projects/project-detail/project-detail.component.ts`
  - Added `DestroyRef` inject + `import { takeUntilDestroyed } from '@angular/core/rxjs-interop'`.
  - Piped 4 leaking subscriptions (`route.params`, `currentUser$`, `savingProject$`, `loadingProject$`) through `takeUntilDestroyed(this.destroyRef)`.
  - Document listeners now registered via a helper `addDocumentListener()` that records each handler in `documentListeners[]`; `ngOnDestroy` removes them all. Also clears `longPressTimer` on destroy.
- `src/app/components/projects/project-detail/project-detail.component.css`
  - `.remote-cursor-label`, `.comment-count`, `.link-mode-cancel:hover`: `color: #FFFFFF` → `var(--text-inverse)` (they sit on `--accent`/`--accent-blue`, which are LIGHT in the default dark theme).
  - NOTE: `.presence-avatar { color:#FFFFFF }` was intentionally LEFT — it sits on a per-user hashed color, white is correct there.

### Decomposition Stage 1 — extract FullScreenTodoComponent
- **NEW** `src/app/components/projects/project-detail/fullscreen-todo/fullscreen-todo.component.{ts,html,css}`
  - Standalone `app-fullscreen-todo`. `@Input({required:true}) list: ToDoLst`. `@Output() closed`, `@Output() save`.
  - Owns: task add/toggle/delete/priority/repeat, tags, and the comments panel (loads/posts via `CollabService`, subscribes to `onCommentAdded` with `takeUntilDestroyed`). All model mutations happen on `this.list`, then it emits `(save)`.
  - Uses `authorColor()` → shared `userColor` util for comment author colors.
- **NEW** `src/app/utils/user-color.util.ts`
  - `ACCENT_SPECTRUM` + `userColor(username)` — the deterministic hash→accent-color logic, previously inline in the parent. Now used by parent (presence avatars, remote cursors) AND the child.
- `project-detail.component.ts` (parent)
  - Imports `FullScreenTodoComponent`; kept `openFullScreenTodo`, `saveFullScreenTodo` (UNCHANGED — still stamps `lastSaveTimestamp` for the hosted reload-skip, saves, reloads, detectChanges), `closeFullScreenTodo` (now just resets its own 4 fields).
  - Removed all the moved methods/state (task/tag/comment logic) and the `onCommentAdded` subscription line in `wireCollabStreams()`. `getUserColor()` now delegates to the util.
- `project-detail.component.html` (parent)
  - The old `@if (showFullScreenTodo && fullScreenTodoElement) { …overlay… }` block (was ~140 lines) replaced with:
    ```html
    @if (showFullScreenTodo && fullScreenTodoElement) {
      <app-fullscreen-todo [list]="fullScreenTodoElement"
                           (save)="saveFullScreenTodo()"
                           (closed)="closeFullScreenTodo()"></app-fullscreen-todo>
    }
    ```

### Separate task — Share button on hosted project cards
- `src/app/components/projects/projects.component.{ts,html,css}`
  - Added a Share icon-button to each hosted project card's `.pj-actions` (next to delete), opening the existing `ShareDialogComponent` (imported into `projects.component.ts`). Added `openShareDialog`/`closeShareDialog`/`canManageProject` + `showShareDialog`/`shareProject` state. `.pj-share` CSS mirrors `.pj-del`.

---

## 2. Design decisions / gotchas (READ before extending)

- **Zoneless app.** Manual `cdr.detectChanges()` everywhere. Preserve every one; don't assume Zone.js.
- **The parent's save path was deliberately kept in the parent.** The child mutates the shared `ToDoLst` model then emits `(save)`; the parent's unchanged `saveFullScreenTodo()` persists it. This keeps the delicate `lastSaveTimestamp` hosted-reload-skip logic and reload/re-resolve untouched. Don't move `saveProject` into the child without also handling `lastSaveTimestamp`.
- **Do NOT "fix" the drag/marquee coordinate math.** An audit claimed elements jump on a panned/zoomed canvas — that's WRONG. `project-detail.component.ts` ~line 1703 already correctly subtracts pan and divides by zoom. It works.
- **Per-mousemove change detection is already one call per event** (each branch `return`s). Not a hot-path storm.
- `getUserColor` is used in 3 places (presence, cursors, comments) — that's why it became a shared util.

---

## 3. How to run + verify

### Run the stack (skill: `run-clarity`)
```bash
# from repo root
docker compose up -d                         # Postgres on :5433
cd angular+socket && npm run db:migrate       # idempotent
npm run dev > /tmp/clarity-backend.log 2>&1 & # backend :3000
cd chat-frontend && npm start > /tmp/clarity-frontend.log 2>&1 &  # frontend :4200
```
IMPORTANT: if you edit/add component files, the vite dev server sometimes does NOT pick up a NEW component directory — **restart `npm start`** if a new component doesn't appear (this bit us: the running server served stale code with the old inline overlay until restarted).

### Build check
```bash
cd angular+socket/chat-frontend
npx tsc --noEmit -p tsconfig.app.json
npx ng build --configuration development     # only pre-existing SettingsComponent NG8107 warnings are OK
```

### Leak verification (how it was proven)
Playwright-core (system Chrome via `channel:'chrome'`), driving demo login → open a project → `page.goBack()/goForward()` (client-side nav) 6×, counting `document` listeners via CDP `DOMDebugger.getEventListeners`. Expected: **7 on the project screen, 1 on the list, flat across all cycles** (pre-fix it climbed 7→14→21).
- Tour gets in the way: `localStorage.setItem('clarity_tour_done','true')` before login.
- Fullscreen todo opens on **double-click** of a `.canvas-element[data-type="ToDoLst"]`; Playwright's `.dblclick()` self-intercepts once the overlay opens — dispatch instead:
  `el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window}))`.
- playwright isn't installed in the repo; used a throwaway `npm i playwright-core` in `/tmp/pw` and ran scripts from there.

### Smoke result (Stage 1)
`app-fullscreen-todo` mounts with the overlay inside it; add-task ✓, add-tag ✓, comments panel ✓, open/close ✓.

---

## 4. OPEN CAVEAT (not caused by this work)

During smoke testing the backend logged `Failed to save project` — even for a real JWT user on a fresh hosted project. This is **NOT** from the refactor (the save path is unchanged parent code). It was NOT root-caused; the running backend was from a prior session. **Check the backend before trusting hosted saves locally.** Start here:
- Watch `/tmp/clarity-backend.log` (or wherever the backend logs) while saving.
- Confirm the socket handshake carries the JWT and the sharing/access checks pass for the project owner.

---

## 5. What's left — decomposition Stages 2–5

The parent is still ~2800 lines. Remaining, roughly in risk order (do one at a time, build + live-verify between each):

1. **CanvasViewportService** — pan/zoom/fit/grid state + screen↔canvas coord math. HIGHER RISK (drag paths read this state).
2. **DragEngineService** — long-press + drag/resize. HIGHER RISK.
3. **Element type interfaces + guards** — kill ~30 `as any` casts and the mixed `constructor.name` vs `objects_builder.typeOf()` detection. LOW risk, mechanical.
4. **ModalManager** — collapse ~15 modal booleans into one state object. LOW risk.

Pattern to follow for UI extractions: mirror the existing `text-doc-editor/` and `share-dialog/` child components (standalone, `@Input` element + `@Output() closed`, inject own services, `takeUntilDestroyed`).

---

## 6. Nothing is committed

All changes above are in the working tree only (`git status`). New dirs: `.../project-detail/fullscreen-todo/`, `src/app/utils/`. Commit when ready; the repo convention ends commit messages with a `Co-Authored-By: Claude ...` trailer.
