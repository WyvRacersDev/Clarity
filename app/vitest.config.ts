/**
 * Vitest config for the Clarity Socket.IO backend (backlog E3 — first tests).
 *
 * These are INTEGRATION tests that run against the real, already-running local
 * Postgres (DATABASE_URL in socket-server/.env, docker port 5433) and a minimal
 * in-process Socket.IO server wiring the real gateways.
 *
 * The backend is ESM + TypeScript and uses tsconfig path aliases
 * (@services/*, @models/*, @types/*). We resolve those here so imports of the
 * repository / gateway modules under test work exactly as in the app.
 *
 * We do NOT use vite-tsconfig-paths (which would try to read the backend
 * tsconfig's `paths` verbatim) — instead we declare matching resolve.alias
 * entries directly so this file is self-contained and needs no extra plugin.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.join(root, "socket-server", "src");
// socket-server/tsconfig.json maps @models/* to ../shared_models/models/*
// (relative to socket-server/), i.e. app/shared_models/models.
const sharedModels = path.join(root, "shared_models", "models");

export default defineConfig({
  resolve: {
    // Mirror socket-server/tsconfig.json `paths`. The backend imports with a
    // ".js" extension (nodenext ESM), so alias the extensionless base and let
    // Vitest's resolver map ".js" -> ".ts" via the extension list below.
    alias: [
      { find: /^@services\/(.*)$/, replacement: path.join(serverSrc, "services") + "/$1" },
      { find: /^@types\/(.*)$/, replacement: path.join(serverSrc, "types") + "/$1" },
      { find: /^@models\/(.*)$/, replacement: sharedModels + "/$1" },
      // Test-only convenience alias for reaching backend source modules.
      { find: /^@src\/(.*)$/, replacement: serverSrc + "/$1" },
    ],
    extensions: [".ts", ".mts", ".js", ".mjs", ".json"],
  },
  test: {
    // Load socket-server/.env so DATABASE_URL / JWT_SECRET are present exactly
    // as the app sees them.
    setupFiles: [path.join(root, "socket-server", "test", "setup.ts")],
    // DB integration + a shared socket server: run serially to avoid cross-test
    // interference on the single Postgres connection / port.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["socket-server/test/**/*.test.ts"],
  },
});
