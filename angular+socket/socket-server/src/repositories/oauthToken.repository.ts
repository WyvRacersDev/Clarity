/**
 * OAuth token repository (R8).
 *
 * Owns the raw persistence for Google API OAuth tokens (`oauth_tokens`) and the
 * global Google app credentials (`google_credentials`). `OAuth.service.ts` keeps
 * the business logic (reconstructing the legacy TokenStore shape and building
 * OAuth2 clients) and no longer issues SQL directly.
 */
import { sql } from "../infrastructure/db.js";

export interface OAuthTokenRow {
  id: number | string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  id_token: string | null;
  expiry_date: number | string | null;
  refresh_token_expires_in: number | string | null;
}

export interface GoogleCredentialsRow {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

/** Every stored OAuth token row (used to rebuild the legacy TokenStore). */
export async function getAllTokens(): Promise<OAuthTokenRow[]> {
  return (await sql`SELECT * FROM oauth_tokens`) as unknown as OAuthTokenRow[];
}

/** A single user's stored OAuth token row, or null when none exists. */
export async function getTokenByEmail(email: string): Promise<OAuthTokenRow | null> {
  const [row] = await sql`SELECT * FROM oauth_tokens WHERE email = ${email}`;
  return (row as OAuthTokenRow | undefined) ?? null;
}

/** Upsert a user's Google API tokens; returns the numeric id of that entry. */
export async function upsertTokens(email: string, tokens: any): Promise<{ id: number }> {
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

  if (!row) throw new Error("upsertTokens failed: no data returned");
  return { id: Number(row.id) };
}

/** The single global Google app credentials row (id=1), or null when unset. */
export async function getGoogleCredentials(): Promise<GoogleCredentialsRow | null> {
  const [creds] = await sql`
    SELECT client_id, client_secret, redirect_uris
    FROM google_credentials
    WHERE id = 1
  `;
  return (creds as GoogleCredentialsRow | undefined) ?? null;
}
