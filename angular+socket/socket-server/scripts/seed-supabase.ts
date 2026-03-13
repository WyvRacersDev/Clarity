/**
 * One-time seed script: reads credentials.json + tokens.json
 * and pushes them into the Supabase tables.
 *
 * Prerequisites:
 *   1. Run scripts/schema.sql in the Supabase SQL Editor first.
 *   2. Make sure .env is present with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage (from the socket-server directory):
 *   npx tsx scripts/seed-supabase.ts
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDENTIALS_PATH = path.join(__dirname, "../credentials.json");
const TOKEN_PATH = path.join(__dirname, "../tokens.json");

// ─── 1. Seed google_credentials ────────────────────────────────────────────

async function seedCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn("⚠️  credentials.json not found, skipping Google credentials seed.");
    return;
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const web = raw.web;

  const { error } = await supabase.from("google_credentials").upsert(
    {
      id: 1,
      client_id: web.client_id,
      client_secret: web.client_secret,
      redirect_uris: web.redirect_uris,
      project_id: web.project_id ?? null,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("❌  Failed to seed google_credentials:", error.message);
  } else {
    console.log("✅  google_credentials seeded (client_id:", web.client_id + ")");
  }
}

// ─── 2. Seed oauth_tokens ─────────────────────────────────────────────────

async function seedTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.warn("⚠️  tokens.json not found, skipping tokens seed.");
    return;
  }

  const tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  const entries: Record<string, any> = tokenStore.entries ?? {};

  const rows = Object.entries(entries).map(([email, data]: [string, any]) => ({
    id: data.id,
    email,
    access_token: data.access_token ?? null,
    refresh_token: data.refresh_token ?? null,
    scope: data.scope ?? null,
    token_type: data.token_type ?? null,
    id_token: data.id_token ?? null,
    expiry_date: data.expiry_date ?? null,
    refresh_token_expires_in: data.refresh_token_expires_in ?? null,
  }));

  if (rows.length === 0) {
    console.log("ℹ️  No token entries found in tokens.json, nothing to seed.");
    return;
  }

  const { error } = await supabase
    .from("oauth_tokens")
    .upsert(rows, { onConflict: "email" });

  if (error) {
    console.error("❌  Failed to seed oauth_tokens:", error.message);
  } else {
    console.log(`✅  oauth_tokens seeded (${rows.length} user(s):`, rows.map(r => r.email).join(", ") + ")");
  }
}

// ─── Run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log("🚀  Seeding Supabase...\n");
  await seedCredentials();
  await seedTokens();
  console.log("\n✅  Done. You can now delete credentials.json and tokens.json from disk.");
})();
