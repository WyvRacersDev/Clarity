/**
 * Search HTTP route (N3 — global content search).
 *
 *   GET /search?q=<term>&username=<name>
 *
 * Mounted at app root in index.ts. Follows the analytics-route pattern exactly:
 * `resolveIdentity` honours the AUTH_STRICT switch and derives the username from
 * the verified JWT when present (so `?username` can't be used to search another
 * user's content), and every handler wraps its async body in try/catch so a
 * rejection never leaves the request hanging.
 */
import { Router } from "express";
import { searchUserContent } from "@services/search.service.js";
import { resolveIdentity, resolveUsername } from "../middleware/auth.middleware.js";

export const searchRouter: Router = Router();

searchRouter.use(resolveIdentity);

searchRouter.get("/search", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const username = resolveUsername(req) || "Demo User";
    const results = await searchUserContent(username, q);
    res.json({ results });
  } catch (err: any) {
    console.error("[search] error:", err);
    res.status(500).json({ error: "Search failed." });
  }
});
