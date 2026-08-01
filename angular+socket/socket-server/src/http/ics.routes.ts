/**
 * ICS calendar feed route (N10) — UNauthenticated on purpose.
 *
 *   GET /calendar/:token.ics
 *
 * A subscribed calendar client (Google/Apple Calendar) can't present a JWT, so
 * access is authorized by an opaque per-user feed token in the URL (minted in
 * `user_integrations`, rotatable from Settings), mirroring projects.link_share_token.
 * Unknown token → 404 (don't reveal whether a token ever existed).
 */
import { Router, type Request, type Response } from "express";
import type { IntegrationsService } from "@services/integrations.service.js";

export function createIcsRouter(integrations: IntegrationsService): Router {
  const router: Router = Router();

  router.get("/calendar/:token.ics", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token ?? "");
      const user = await integrations.resolveFeedUser(token);
      if (!user) return res.status(404).send("Not found");

      const ics = await integrations.buildCalendarForUser(user.username);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="clarity.ics"');
      // Let clients cache briefly; calendars poll on their own cadence anyway.
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(ics);
    } catch (err) {
      console.error("[ICS] feed error:", err);
      res.status(500).send("Could not build calendar");
    }
  });

  return router;
}
