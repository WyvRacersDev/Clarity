/**
 * AI assistant HTTP route (Phase 6a).
 *
 * Behavior-preserving extraction from `src/index.ts`:
 *   GET /ai-assistant/chat-agent   ?input&username
 *
 * The Chat_Agent instance is injected so the router owns no singletons. Mounted
 * at app root in index.ts, so the path and error mapping are unchanged.
 */
import { Router } from "express";
import type { Chat_Agent } from "@services/agent.service.js";

export function createAiRouter(agent: Chat_Agent): Router {
  const aiRouter: Router = Router();

  aiRouter.get("/ai-assistant/chat-agent", async (req, res) => {
    const input = String(req.query.input ?? "");
    const username = String(req.query.username ?? "Demo User");
    console.log("AI Assistant chat input:", input);
    try {
      let result = await agent.chat(input, username);
      res.json(result);
    } catch (err: any) {
      if (err.status === 429 || err.code === 429) {
        return res.status(429).json({
          error: true,
          message: "Rate limit reached. Please wait a moment and try again.",
        });
      }

      if (err.status === 400 || err.code === 400) {
        return res.status(400).json({
          error: true,
          message: "Invalid request to AI model. Check your inputted AI mode.",
        });
      }

      if (err.status === 401 || err.code === 401) {
        return res.status(401).json({
          error: true,
          message: "Unauthorized. Invalid or missing API key.",
        });
      }

      return res.status(500).json({
        error: true,
        message: "Something went wrong with the AI service. Please try again later.",
      });
    }
  });

  return aiRouter;
}
