/**
 * N10 DB-backed test — the user_integrations lifecycle + the service's calendar
 * build path over a real Postgres row. The pure ICS/VEVENT formatting is covered
 * by test/lib/n10.test.ts; here we prove the row is minted, mutated, and resolved.
 */
import { afterAll, describe, it, expect } from "vitest";
import { sql } from "@src/infrastructure/db.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import {
  ensureIntegration,
  setWebhook,
  regenerateFeedToken,
  findUserByFeedToken,
  getWebhookByUsername,
} from "@src/repositories/integrations.repository.js";
import { IntegrationsService } from "@services/integrations.service.js";

const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

afterAll(async () => {
  for (const username of createdUsers) {
    await sql`delete from users where username = ${username}`; // cascades to user_integrations
  }
  await sql.end();
});

describe("user_integrations repository (N10)", () => {
  it("mints a feed token on first access and is idempotent", async () => {
    const user = await ensureUser(unique("int"));
    createdUsers.add(user.username);

    const first = await ensureIntegration(user.id);
    expect(first.icsFeedToken).toBeTruthy();
    expect(first.webhookUrl).toBeNull();
    expect(first.webhookKind).toBe("generic");

    const again = await ensureIntegration(user.id);
    expect(again.icsFeedToken).toBe(first.icsFeedToken); // no churn
  });

  it("sets/reads a webhook and resolves it by username", async () => {
    const user = await ensureUser(unique("int"));
    createdUsers.add(user.username);

    await setWebhook(user.id, "https://hooks.slack.com/services/XXX", "slack");
    const hook = await getWebhookByUsername(user.username);
    expect(hook).toEqual({ webhookUrl: "https://hooks.slack.com/services/XXX", webhookKind: "slack" });

    // Clearing the webhook makes the username lookup return null.
    await setWebhook(user.id, null, "generic");
    expect(await getWebhookByUsername(user.username)).toBeNull();
  });

  it("regenerates the feed token and resolves the user by the new token", async () => {
    const user = await ensureUser(unique("int"));
    createdUsers.add(user.username);

    const before = await ensureIntegration(user.id);
    const after = await regenerateFeedToken(user.id);
    expect(after.icsFeedToken).not.toBe(before.icsFeedToken);

    // Old token no longer resolves; new one points back to this user.
    expect(await findUserByFeedToken(before.icsFeedToken)).toBeNull();
    const resolved = await findUserByFeedToken(after.icsFeedToken);
    expect(resolved?.username).toBe(user.username);
  });

  it("builds a valid VCALENDAR for the user (empty is still well-formed)", async () => {
    const user = await ensureUser(unique("int"));
    createdUsers.add(user.username);

    const ics = await new IntegrationsService().buildCalendarForUser(user.username);
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
