/**
 * Integrations routes (N10) — per-user integration config (JWT-authed).
 *
 *   GET  /integrations                 → current config (feed token + webhook)
 *   POST /integrations/webhook         { url, kind } → set/clear the webhook
 *   POST /integrations/webhook/test    → deliver a synthetic notification
 *   POST /integrations/feed/regenerate → rotate the ICS feed token
 *
 * Strictly per-user (keyed on the verified JWT's user id), so it uses the strict
 * `authenticate` gate rather than the permissive `resolveIdentity`. A factory so
 * the shared IntegrationsService singleton can be injected (DIP).
 */
import { Router, type Request, type Response } from "express";
import express from "express";
import { authenticate } from "../middleware/auth.middleware.js";
import type { IntegrationsService } from "@services/integrations.service.js";
import type { WebhookKind } from "../repositories/integrations.repository.js";

function feedPath(token: string): string {
  return `/calendar/${token}.ics`;
}

export function createIntegrationsRouter(integrations: IntegrationsService): Router {
  const router: Router = Router();
  router.use(express.json());
  router.use(authenticate);

  const userId = (req: Request): string => (req as any).user?.id;
  const username = (req: Request): string => (req as any).user?.username;

  router.get("/integrations", async (req: Request, res: Response) => {
    try {
      const cfg = await integrations.getConfig(userId(req));
      res.json({
        icsFeedToken: cfg.icsFeedToken,
        feedPath: feedPath(cfg.icsFeedToken),
        webhookUrl: cfg.webhookUrl,
        webhookKind: cfg.webhookKind,
      });
    } catch (err) {
      console.error("[Integrations] get config error:", err);
      res.status(500).json({ error: "Could not load integrations" });
    }
  });

  router.post("/integrations/webhook", async (req: Request, res: Response) => {
    try {
      const rawUrl = (req.body?.url ?? "").toString().trim();
      const kind: WebhookKind = req.body?.kind === "slack" ? "slack" : "generic";
      if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
        return res.status(400).json({ error: "Webhook URL must start with http(s)://" });
      }
      const cfg = await integrations.setWebhook(userId(req), rawUrl || null, kind);
      res.json({ webhookUrl: cfg.webhookUrl, webhookKind: cfg.webhookKind });
    } catch (err) {
      console.error("[Integrations] set webhook error:", err);
      res.status(500).json({ error: "Could not save webhook" });
    }
  });

  router.post("/integrations/webhook/test", async (req: Request, res: Response) => {
    try {
      const delivered = await integrations.deliverWebhookForUser(username(req), {
        type: "test",
        title: "Clarity webhook test",
        body: "If you can see this, your Clarity webhook is working. 🎉",
        actor: "Clarity",
        projectName: null,
        link: null,
        created_at: new Date().toISOString(),
      });
      res.json({ success: true, delivered });
    } catch (err) {
      console.error("[Integrations] test webhook error:", err);
      res.status(500).json({ error: "Could not send test" });
    }
  });

  router.post("/integrations/feed/regenerate", async (req: Request, res: Response) => {
    try {
      const cfg = await integrations.regenerateFeed(userId(req));
      res.json({ icsFeedToken: cfg.icsFeedToken, feedPath: feedPath(cfg.icsFeedToken) });
    } catch (err) {
      console.error("[Integrations] regenerate feed error:", err);
      res.status(500).json({ error: "Could not regenerate feed" });
    }
  });

  return router;
}
