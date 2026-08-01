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
import { Router, json } from "express";
import type { Chat_Agent, AgentProjectScope } from "@services/agent.service.js";
import { computeSuggestionsForUser } from "@services/notification.service.js";
import { resolveIdentity, resolveUsername } from "../middleware/auth.middleware.js";

export function createAiRouter(agent: Chat_Agent): Router {
  const aiRouter: Router = Router();

  // E9: optional project scope from the query. When a project is provided the
  // agent grounds its answer/tools in that project's context (see build_scope_prefix).
  const readScope = (req: { query: Record<string, any> }): AgentProjectScope | undefined => {
    const projectName = String(req.query.projectName ?? "").trim();
    if (!projectName) return undefined;
    const rawType = String(req.query.projectType ?? "").trim();
    return rawType === "local" || rawType === "hosted"
      ? { projectName, projectType: rawType }
      : { projectName };
  };

  // Identity: honour AUTH_STRICT and prefer the verified JWT's username over the
  // `?username` query param (the streaming route accepts the token via `?token=`
  // because EventSource cannot set an Authorization header).
  aiRouter.use(resolveIdentity);

  aiRouter.get("/ai-assistant/chat-agent", async (req, res) => {
    const input = String(req.query.input ?? "");
    const username = resolveUsername(req) || "Demo User";
    const scope = readScope(req);
    console.log("AI Assistant chat input:", input, "scope:", scope?.projectName ?? "(none)");
    try {
      let result = await agent.chat(input, username, scope);
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
    const username = resolveUsername(req) || "Demo User";
    const scope = readScope(req);
    console.log("AI Assistant stream input:", input, "scope:", scope?.projectName ?? "(none)");

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
      for await (const chunk of agent.chatStream(input, username, scope)) {
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
   * E9 (slice 2) — turn a chat conversation into tasks.
   *   POST /ai-assistant/thread-to-tasks
   *   body: { projectName, projectType?, thread }
   * Extracts action items from `thread` and creates them in the project, then
   * returns { message, created: string[], count }. Uses a JSON body (not query
   * params) because a conversation can be long. Never 500s on "no items" — that
   * is a normal { count: 0 } result.
   */
  aiRouter.post("/ai-assistant/thread-to-tasks", json({ limit: "1mb" }), async (req, res) => {
    const projectName = String(req.body?.projectName ?? "").trim();
    const thread = String(req.body?.thread ?? "").trim();
    const rawType = String(req.body?.projectType ?? "").trim();
    const projectType = rawType === "local" || rawType === "hosted" ? rawType : undefined;
    if (!projectName || !thread) {
      return res.status(400).json({ error: true, message: "projectName and thread are required." });
    }
    try {
      const result = await agent.thread_to_tasks_by_name(
        projectType ? { project_name: projectName, projectType, thread } : { project_name: projectName, thread }
      );
      res.json({ message: result.message, created: result.created, count: result.created.length });
    } catch (err: any) {
      console.error("[ai.routes] thread-to-tasks error:", err);
      res.status(500).json({
        error: true,
        message: "Could not turn the conversation into tasks right now. Please try again.",
      });
    }
  });

  /**
   * On-demand proactive suggestion pull (C2 fallback for the Socket.IO push).
   *   GET /ai-assistant/suggestions ?username
   * Returns { suggestion: <payload> | null }. Never 500s on "no tasks" — an
   * empty result is `null`. Degrades to the heuristic when no valid key.
   */
  aiRouter.get("/ai-assistant/suggestions", async (req, res) => {
    const username = resolveUsername(req);
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
