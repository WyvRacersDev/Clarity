/**
 * Project export routes (N10) — JWT-authed downloads.
 *
 *   GET /export/project?type=local|hosted&name=<project>&format=json|md
 *
 * Requires `view` access (delegated to AccessService, same rule as the sharing /
 * collab gateways). JSON returns the serialized project as-is; Markdown runs the
 * pure `projectToMarkdown` renderer. (PDF is produced client-side via the browser
 * print dialog — no server route needed.) A single query-param route avoids
 * colliding with the `/projects` static-asset mount and handles names with
 * spaces/dots cleanly.
 */
import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth.middleware.js";
import { AccessService } from "@services/access.service.js";
import { loadProject } from "../repositories/project.repository.js";
import { projectToMarkdown, type ExportProject } from "../lib/project-export.js";

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "project";
}

export function createExportRouter(access: AccessService = new AccessService()): Router {
  const router: Router = Router();
  router.use(authenticate);

  router.get("/export/project", async (req: Request, res: Response) => {
    try {
      const type = req.query.type;
      const name = (req.query.name ?? "").toString();
      const format = (req.query.format ?? "json").toString();
      if (type !== "local" && type !== "hosted") {
        return res.status(400).json({ error: "type must be 'local' or 'hosted'" });
      }
      if (!name) return res.status(400).json({ error: "name is required" });
      if (format !== "json" && format !== "md") {
        return res.status(400).json({ error: "format must be 'json' or 'md'" });
      }

      const username = (req as any).user?.username as string | undefined;
      const auth = await access.authorize(name, type, username, "view");
      if (!auth.ok) {
        return res.status(auth.reason === "not_found" ? 404 : 403).json({ error: auth.message });
      }

      const project = (await loadProject(name, type)) as ExportProject | null;
      if (!project) return res.status(404).json({ error: "Project not found" });

      const base = safeFilename(name);
      if (format === "md") {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.md"`);
        return res.send(projectToMarkdown(project));
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.json"`);
      return res.send(JSON.stringify(project, null, 2));
    } catch (err) {
      console.error("[Export] error:", err);
      res.status(500).json({ error: "Could not export project" });
    }
  });

  return router;
}
