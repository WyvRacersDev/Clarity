/**
 * Misc HTTP routes (Phase 6a).
 *
 * Behavior-preserving extraction from `src/index.ts`:
 *   POST /set-redirect-url   → acknowledges a frontend URL update request
 *
 * Mounted at app root in index.ts, so the path is unchanged.
 */
import { Router } from "express";
import express from "express";
import { FRONTEND_URL } from "../config/index.js";

export const miscRouter: Router = Router();

// Allow dynamic updates via API
miscRouter.post("/set-redirect-url", express.json(), (_req, res) => {
  // Note: This would require making FRONTEND_URL mutable or using a different approach
  console.log("Frontend URL update requested (using config value):", FRONTEND_URL);
  res.json({ success: true, currentUrl: FRONTEND_URL });
});
