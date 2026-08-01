/**
 * Loads socket-server/.env regardless of the process's current working directory.
 *
 * Import this as the VERY FIRST import in any entry point (server or CLI script)
 * so that env vars are populated before config/index.ts reads process.env.
 *
 * Why not `import 'dotenv/config'`? That resolves `.env` relative to the CWD,
 * which for `npm run dev`/`db:*` is the package root (app/), NOT this
 * folder — so the real .env silently wouldn't load. We resolve it by module path.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/loadenv.ts -> ../.env  == socket-server/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
