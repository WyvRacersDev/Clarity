/**
 * AI assistant HTTP route (Phase 6a).
 *
 * Behavior-preserving extraction from `src/index.ts`:
 *   GET /ai-assistant/chat-agent   ?input&username   (blocking, tool-calling)
 *
 * C3 adds a streaming variant:
 *   GET /ai-assistant/chat-agent-stream ?input&username  (Server-Sent Events)
 *
 * The Chat_Agent instance is injected so the router owns no singletons. Mounted
 * at app root in index.ts, so the path and error mapping are unchanged.
 */
import { Router } from "express";
import type { Chat_Agent } from "@services/agent.service.js";
import { computeSuggestionsForUser } from "@services/notification.service.js";

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

  /**
   * Streaming chat over Server-Sent Events (C3).
   *
   * Emits, per token:      data: <json-encoded chunk>\n\n
   * On completion:         event: done\n data: {}\n\n
   * On a hard failure:     event: error\n data: {"message": "..."}\n\n
   *
   * Chunks are JSON-encoded so newlines/emoji/markdown survive the SSE framing
   * (a raw `data: <chunk>` would break on embedded newlines). The frontend
   * decodes each `data:` line with JSON.parse. `chatStream` never throws — it
   * yields a message instead — so the `error` event is a belt-and-suspenders
   * guard for unexpected transport failures.
   */
  aiRouter.get("/ai-assistant/chat-agent-stream", async (req, res) => {
    const input = String(req.query.input ?? "");
    const username = String(req.query.username ?? "Demo User");
    console.log("AI Assistant stream input:", input);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable proxy buffering (nginx) so tokens flush immediately.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Stop generating if the client disconnects mid-stream.
    let clientGone = false;
    req.on("close", () => { clientGone = true; });

    try {
      for await (const chunk of agent.chatStream(input, username)) {
        if (clientGone) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (!clientGone) {
        res.write("event: done\ndata: {}\n\n");
      }
    } catch (err: any) {
      console.error("[ai.routes] stream error:", err);
      if (!clientGone) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: "The AI service failed while streaming. Please try again.",
          })}\n\n`
        );
      }
    } finally {
      res.end();
    }
  });

  /**
   * On-demand proactive suggestion pull (C2 fallback for the Socket.IO push).
   *   GET /ai-assistant/suggestions ?username
   * Returns { suggestion: <payload> | null }. Never 500s on "no tasks" — an
   * empty result is `null`. Degrades to the heuristic when no valid key.
   */
  aiRouter.get("/ai-assistant/suggestions", async (req, res) => {
    const username = String(req.query.username ?? "");
    try {
      const suggestion = await computeSuggestionsForUser(agent, username);
      res.json({ suggestion });
    } catch (err: any) {
      console.error("[ai.routes] suggestions error:", err);
      res.status(500).json({
        error: true,
        message: "Could not compute suggestions right now. Please try again later.",
      });
    }
  });

  return aiRouter;
}
