/**
 * Seeds the single-row `google_credentials` (id = 1) table from environment
 * variables, so Google login + Calendar/Gmail/Contacts work locally.
 *
 *   npm run db:seed-google
 *
 * Reads (from socket-server/.env):
 *   GOOGLE_CLIENT_ID       — OAuth 2.0 Web client ID   (…apps.googleusercontent.com)
 *   GOOGLE_CLIENT_SECRET   — OAuth 2.0 Web client secret
 *   GOOGLE_REDIRECT_URI    — must EXACTLY match a redirect URI registered in the
 *                            Google Cloud console (default the backend callback).
 *
 * The live OAuth path (OAuth.service.getGlobalOAuthClient / getAuthForUser)
 * builds its client from `redirect_uris[0]` of this row, so the value below must
 * be one of the Authorized redirect URIs on the Google OAuth client.
 *
 * Re-runnable: upserts id = 1.
 *
 * NOTE: the db:* CLI scripts don't preload dotenv (only src/index.ts does), so
 * we load socket-server/.env explicitly here before reading these vars.
 */
import "../loadenv.js"; // load socket-server/.env before reading process.env
import { sql } from "./db.js";

const DEFAULT_REDIRECT_URI = "http://localhost:3000/oauth2callback";

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;

  const missing = [
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(
      `❌  Missing required env var(s): ${missing.join(", ")}.\n` +
        "   Add them to socket-server/.env (from your Google Cloud OAuth 2.0 Web client),\n" +
        "   then re-run `npm run db:seed-google`."
    );
    process.exit(1);
  }

  await sql`
    insert into google_credentials (id, client_id, client_secret, redirect_uris)
    values (1, ${clientId!}, ${clientSecret!}, ${[redirectUri]}::text[])
    on conflict (id) do update
      set client_id     = excluded.client_id,
          client_secret = excluded.client_secret,
          redirect_uris = excluded.redirect_uris
  `;

  console.log("✅  google_credentials (id=1) upserted.");
  console.log("    client_id    :", clientId!.replace(/^(.{12}).*(.{20})$/, "$1…$2"));
  console.log("    redirect_uris:", [redirectUri]);
  console.log(
    "    Make sure this redirect URI (and /auth/google/callback) are Authorized\n" +
      "    redirect URIs on the Google OAuth client, and that Calendar/Gmail/People\n" +
      "    APIs are enabled."
  );
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error("❌  Google credentials seed failed:", err);
    await sql.end();
    process.exit(1);
  });
