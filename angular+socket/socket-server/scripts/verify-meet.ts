/**
 * One-off verification for E5's REAL Google Meet path.
 *
 * Uses the first Google-connected account in the token store to call the actual
 * production `createSharedCallLink()` and asserts it returns a real
 * `meet.google.com` link (provider "meet"), proving the Calendar
 * `conferenceData` integration works. Cleans up the calendar event it creates.
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/verify-meet.ts
 */
import "../src/loadenv.js";
import { google } from "googleapis";
import { getAuthForUser, loadTokenStore } from "../src/services/OAuth.service.js";
import { createSharedCallLink } from "../src/services/meet.service.js";

async function main(): Promise<void> {
  const store = await loadTokenStore();
  const email = Object.keys(store.entries ?? {})[0];
  if (!email) {
    console.log("⚠️  No Google-connected account in the token store — cannot test the Meet path.");
    process.exit(2);
  }
  console.log(`\n🔎 Verifying real Google Meet path as ${email}\n`);

  const label = `verify-${Date.now().toString(36)}`;
  const call = await createSharedCallLink(email, label);
  console.log(`  provider: ${call.provider}`);
  console.log(`  url:      ${call.url}`);

  const isMeet = call.provider === "meet" && /https:\/\/meet\.google\.com\//.test(call.url);
  console.log(isMeet
    ? "  ✅ real Google Meet room created via Calendar API"
    : "  ❌ expected a meet.google.com link (got the Jitsi fallback — check Google token/scopes)");

  // Cleanup: delete the calendar event we just created so nothing lingers.
  try {
    const auth = await getAuthForUser(email);
    if (auth instanceof google.auth.OAuth2) {
      const calendar = google.calendar({ version: "v3", auth });
      const found = await calendar.events.list({ calendarId: "primary", q: label, maxResults: 5 });
      for (const ev of found.data.items ?? []) {
        if (ev.id) {
          await calendar.events.delete({ calendarId: "primary", eventId: ev.id });
          console.log(`  🧹 deleted calendar event ${ev.id}`);
        }
      }
    }
  } catch (err) {
    console.warn("  (cleanup skipped:", err instanceof Error ? err.message : err, ")");
  }

  console.log();
  process.exit(isMeet ? 0 : 1);
}

main().catch((err) => {
  console.error("💥 verify-meet crashed:", err);
  process.exit(1);
});
