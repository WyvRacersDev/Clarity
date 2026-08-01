/**
 * IntegrationsService (N10) — the business boundary for external integrations:
 * the ICS calendar feed and per-user outbound webhooks (generic / Slack).
 *
 * SRP: it owns "how a user's integrations behave" (mint/rotate the feed token,
 * build the calendar, shape + deliver a webhook). DIP: it depends on the
 * repository + pure builders, not on SQL or the HTTP layer. The webhook delivery
 * is best-effort and never throws to its caller (it's a side-channel on the N2
 * notification path).
 */
import axios from "axios";
import {
  ensureIntegration,
  setWebhook,
  regenerateFeedToken,
  findUserByFeedToken,
  getWebhookByUsername,
  allDatedTasksForUser,
  type IntegrationRow,
  type WebhookKind,
} from "../repositories/integrations.repository.js";
import { buildIcsCalendar } from "../lib/ics.js";

/** The notification fields a webhook cares about (subset of N2's SerializedNotification). */
export interface WebhookNotification {
  type: string;
  title: string;
  body: string | null;
  actor: string | null;
  projectName: string | null;
  link: string | null;
  created_at: string;
}

/**
 * Shape a notification into the outbound webhook body. Slack incoming webhooks
 * expect `{ text }` (Markdown-ish); generic webhooks get the structured fields.
 * Pure — unit-testable.
 */
export function buildWebhookPayload(
  kind: WebhookKind,
  n: WebhookNotification
): Record<string, unknown> {
  if (kind === "slack") {
    const detail = n.body ? `\n${n.body}` : "";
    return { text: `*${n.title}*${detail}` };
  }
  return {
    source: "clarity",
    type: n.type,
    title: n.title,
    body: n.body,
    actor: n.actor,
    projectName: n.projectName,
    link: n.link,
    created_at: n.created_at,
  };
}

export class IntegrationsService {
  /** A user's integration config, creating the row (+ feed token) on first read. */
  getConfig(userId: string): Promise<IntegrationRow> {
    return ensureIntegration(userId);
  }

  /** Set or clear the outbound webhook. */
  setWebhook(
    userId: string,
    webhookUrl: string | null,
    webhookKind: WebhookKind
  ): Promise<IntegrationRow> {
    return setWebhook(userId, webhookUrl, webhookKind);
  }

  /** Rotate the ICS feed token (invalidates the previous subscribe URL). */
  regenerateFeed(userId: string): Promise<IntegrationRow> {
    return regenerateFeedToken(userId);
  }

  /** Resolve the user that owns a feed token (for the unauthenticated ICS route). */
  resolveFeedUser(token: string): Promise<{ id: string; username: string } | null> {
    return findUserByFeedToken(token);
  }

  /** Build the `.ics` calendar body for a user's dated tasks. */
  async buildCalendarForUser(username: string, now?: Date): Promise<string> {
    const tasks = await allDatedTasksForUser(username);
    const calName = `Clarity — ${username}`;
    return buildIcsCalendar(tasks, now ? { calName, now } : { calName });
  }

  /**
   * Deliver a notification to a user's webhook, if they configured one.
   * Best-effort: swallows all errors (a broken webhook must never disrupt the
   * in-app notification it mirrors). Returns true if a webhook was posted.
   */
  async deliverWebhookForUser(
    username: string,
    n: WebhookNotification
  ): Promise<boolean> {
    try {
      const hook = await getWebhookByUsername(username);
      if (!hook) return false;
      const payload = buildWebhookPayload(hook.webhookKind, n);
      await axios.post(hook.webhookUrl, payload, {
        timeout: 5000,
        headers: { "Content-Type": "application/json" },
      });
      return true;
    } catch (err: any) {
      console.error(`[Integrations] webhook delivery to ${username} failed:`, err?.message ?? err);
      return false;
    }
  }
}
