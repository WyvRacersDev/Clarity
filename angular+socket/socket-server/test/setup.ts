/**
 * Vitest global setup — load the backend's .env exactly as src/index.ts does
 * (via `import "dotenv/config"`), so DATABASE_URL, JWT_SECRET, etc. are present
 * before any module under test imports src/config.
 *
 * We point dotenv at socket-server/.env explicitly because Vitest's cwd is the
 * repo `angular+socket/` root, not socket-server/.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, "..", ".env") });
