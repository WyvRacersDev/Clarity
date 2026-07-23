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
import { aggregateAnalytics } from "@services/analytics.service.js";

export const analyticsRouter: Router = Router();

// Route: completed-per-day
analyticsRouter.get("/analytics/completed-per-day", async (req, res) => {
  const days = Number(req.query.days ?? 30);
  const username = String(req.query.username ?? "Demo User");
  const { completedPerDay } = await aggregateAnalytics(days, username);
  res.json(completedPerDay);
});

// Route: completion-rate-by-tag
analyticsRouter.get("/analytics/completion-rate-by-tag", async (req, res) => {
  const days = Number(req.query.days ?? 30);
  const username = String(req.query.username ?? "Demo User");
  console.log("Analytics request for completion-rate-by-tag for user:", username, "days:", days);
  const { completionRateByTag } = await aggregateAnalytics(days, username);
  res.json(completionRateByTag);
});
