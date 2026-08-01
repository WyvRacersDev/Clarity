/**
 * Analytics HTTP routes (Phase 6a).
 *
 * Behavior-preserving extraction from `src/index.ts`:
 *   GET /analytics/completed-per-day        ?days&username
 *   GET /analytics/completion-rate-by-tag   ?days&username
 *
 * Mounted at app root in index.ts, so paths are unchanged.
 */
import { Router } from "express";
import { aggregateAnalytics, listUserTags, MAX_ANALYTICS_DAYS, parseDays } from "@services/analytics.service.js";
import { resolveIdentity, resolveUsername } from "../middleware/auth.middleware.js";

export const analyticsRouter: Router = Router();

// Identity: honour the AUTH_STRICT switch and derive the username from the
// verified JWT when present, so analytics can't be pulled for an arbitrary user
// by spoofing the `?username` query param.
analyticsRouter.use(resolveIdentity);

// Route: completed-per-day
//
// The handler is async, and Express 4 does NOT forward a rejected async handler
// to the error pipeline — an unhandled rejection would leave the HTTP request
// hanging with no response, which is exactly what leaves the frontend charts
// stuck on their skeleton loaders forever (A4). So every handler wraps its body
// in try/catch and always sends a response.
analyticsRouter.get("/analytics/completed-per-day", async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const username = resolveUsername(req) || "Demo User";
    const { completedPerDay } = await aggregateAnalytics(days, username);
    res.json(completedPerDay);
  } catch (err: any) {
    console.error("[analytics] completed-per-day error:", err);
    res.status(500).json({ error: "Failed to load analytics." });
  }
});

// Route: completion-rate-by-tag
analyticsRouter.get("/analytics/completion-rate-by-tag", async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const username = resolveUsername(req) || "Demo User";
    console.log("Analytics request for completion-rate-by-tag for user:", username, "days:", days);
    const { completionRateByTag } = await aggregateAnalytics(days, username);
    res.json(completionRateByTag);
  } catch (err: any) {
    console.error("[analytics] completion-rate-by-tag error:", err);
    res.status(500).json({ error: "Failed to load analytics." });
  }
});

// Route: tags — every distinct tag on the user's ToDoLists (not just those with
// completed tasks), used to populate the "Filter by tag" chips.
analyticsRouter.get("/analytics/tags", async (req, res) => {
  try {
    const username = resolveUsername(req) || "Demo User";
    const tags = await listUserTags(username);
    res.json({ tags });
  } catch (err: any) {
    console.error("[analytics] tags error:", err);
    res.status(500).json({ error: "Failed to load tags." });
  }
});

export { MAX_ANALYTICS_DAYS };
