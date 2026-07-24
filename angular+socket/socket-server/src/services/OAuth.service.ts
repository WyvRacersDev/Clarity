import { google } from "googleapis";
import { sql } from "../infrastructure/db.js";

// Derive the client type from the actual constructor so it matches the copy of
// google-auth-library that `google.auth.OAuth2` produces (googleapis bundles its
// own), avoiding cross-package "separate declarations" type errors.
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenStore {
  nextId: number;
  entries: {
    [email: string]: { id: number; [key: string]: any };
  };
  [email: string]: any;
}

// ─── Token store helpers ───────────────────────────────────────────────────────

/**
 * Loads all oauth_tokens rows from Postgres and reconstructs
 * the legacy TokenStore shape for backward compatibility.
 */
export async function loadTokenStore(): Promise<TokenStore> {
  const rows = await sql`SELECT * FROM oauth_tokens`;

  const entries: TokenStore["entries"] = {};
  let maxId = 0;
  for (const row of rows) {
    const id = Number(row.id);
    entries[row.email] = {
      id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      scope: row.scope,
      token_type: row.token_type,
      id_token: row.id_token,
      expiry_date: row.expiry_date === null ? null : Number(row.expiry_date),
      refresh_token_expires_in:
        row.refresh_token_expires_in === null ? null : Number(row.refresh_token_expires_in),
    };
    if (id > maxId) maxId = id;
  }
  return { nextId: maxId + 1, entries };
}

/**
 * Upsert Google API tokens for a user in Postgres.
 * Returns the numeric id assigned to that user entry.
 */
export async function saveUserTokens(email: string, tokens: any): Promise<{ id: number }> {
  const [row] = await sql`
    INSERT INTO oauth_tokens
      (email, access_token, refresh_token, scope, token_type, id_token, expiry_date, refresh_token_expires_in)
    VALUES (
      ${email},
      ${tokens.access_token ?? null},
      ${tokens.refresh_token ?? null},
      ${tokens.scope ?? null},
      ${tokens.token_type ?? null},
      ${tokens.id_token ?? null},
      ${tokens.expiry_date ?? null},
      ${tokens.refresh_token_expires_in ?? null}
    )
    ON CONFLICT (email) DO UPDATE SET
      access_token             = EXCLUDED.access_token,
      refresh_token            = EXCLUDED.refresh_token,
      scope                    = EXCLUDED.scope,
      token_type               = EXCLUDED.token_type,
      id_token                 = EXCLUDED.id_token,
      expiry_date              = EXCLUDED.expiry_date,
      refresh_token_expires_in = EXCLUDED.refresh_token_expires_in
    RETURNING id
  `;

  if (!row) throw new Error("saveUserTokens failed: no data returned");
  return { id: Number(row.id) };
}

// ─── OAuth client helpers ──────────────────────────────────────────────────────

/**
 * Loads Google OAuth app credentials from Postgres and returns
 * a fresh OAuth2 client (no user tokens).
 * Use this for the /auth URL generation and the /oauth2callback exchange.
 */
export async function getGlobalOAuthClient() {
  const [creds] = await sql`
    SELECT client_id, client_secret, redirect_uris
    FROM google_credentials
    WHERE id = 1
  `;

  if (!creds) throw new Error("Google credentials not found in database (google_credentials id=1)");
  return new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
}

/**
 * Returns an OAuth2 client pre-loaded with a specific user's stored tokens,
 * or a plain error object if credentials / tokens are missing.
 */
export async function getAuthForUser(email: string): Promise<OAuth2Client | { success: false; message: string }> {
  // Load credentials
  const [creds] = await sql`
    SELECT client_id, client_secret, redirect_uris
    FROM google_credentials
    WHERE id = 1
  `;

  if (!creds) {
    return { success: false, message: "Google credentials not found in database" };
  }

  // Load user tokens
  const [tokenRow] = await sql`
    SELECT * FROM oauth_tokens WHERE email = ${email}
  `;

  if (!tokenRow) {
    return { success: false, message: `No OAuth tokens found for user: ${email}` };
  }

  const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
  oAuth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    scope: tokenRow.scope,
    token_type: tokenRow.token_type,
    id_token: tokenRow.id_token,
    expiry_date: tokenRow.expiry_date == null ? null : Number(tokenRow.expiry_date),
  });
  return oAuth2Client;
}
