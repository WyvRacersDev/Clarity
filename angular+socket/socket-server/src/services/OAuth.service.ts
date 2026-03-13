import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { supabase } from "../../lib/supabase.js";

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
 * Loads all oauth_tokens rows from Supabase and reconstructs
 * the legacy TokenStore shape for backward compatibility.
 */
export async function loadTokenStore(): Promise<TokenStore> {
  const { data, error } = await supabase.from("oauth_tokens").select("*");
  if (error) throw new Error("loadTokenStore failed: " + error.message);

  const entries: TokenStore["entries"] = {};
  let maxId = 0;
  for (const row of data ?? []) {
    entries[row.email] = {
      id: row.id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      scope: row.scope,
      token_type: row.token_type,
      id_token: row.id_token,
      expiry_date: row.expiry_date,
      refresh_token_expires_in: row.refresh_token_expires_in,
    };
    if (row.id > maxId) maxId = row.id;
  }
  return { nextId: maxId + 1, entries };
}

/**
 * Upsert OAuth tokens for a user in Supabase.
 * Returns the numeric id assigned to that user entry.
 */
export async function saveUserTokens(email: string, tokens: any): Promise<{ id: number }> {
  const { data, error } = await supabase
    .from("oauth_tokens")
    .upsert(
      {
        email,
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token ?? null,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? null,
        id_token: tokens.id_token ?? null,
        expiry_date: tokens.expiry_date ?? null,
        refresh_token_expires_in: tokens.refresh_token_expires_in ?? null,
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (error || !data) throw new Error("saveUserTokens failed: " + (error?.message ?? "no data returned"));
  return { id: data.id };
}

// ─── OAuth client helpers ──────────────────────────────────────────────────────

/**
 * Loads Google OAuth app credentials from Supabase and returns
 * a fresh OAuth2 client (no user tokens).
 * Use this for the /auth URL generation and the /oauth2callback exchange.
 */
export async function getGlobalOAuthClient() {
  const { data, error } = await supabase
    .from("google_credentials")
    .select("client_id, client_secret, redirect_uris")
    .eq("id", 1)
    .single();

  if (error || !data) throw new Error("Google credentials not found in Supabase: " + (error?.message ?? "no row"));
  return new google.auth.OAuth2(data.client_id, data.client_secret, data.redirect_uris[0]);
}

/**
 * Returns an OAuth2 client pre-loaded with a specific user's stored tokens,
 * or a plain error object if credentials / tokens are missing.
 */
export async function getAuthForUser(email: string): Promise<OAuth2Client | { success: false; message: string }> {
  // Load credentials
  const { data: creds, error: credsError } = await supabase
    .from("google_credentials")
    .select("client_id, client_secret, redirect_uris")
    .eq("id", 1)
    .single();

  if (credsError || !creds) {
    return { success: false, message: "Google credentials not found in Supabase" };
  }

  // Load user tokens
  const { data: tokenRow, error: tokenError } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("email", email)
    .single();

  if (tokenError || !tokenRow) {
    return { success: false, message: `No OAuth tokens found for user: ${email}` };
  }

  const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
  oAuth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    scope: tokenRow.scope,
    token_type: tokenRow.token_type,
    id_token: tokenRow.id_token,
    expiry_date: tokenRow.expiry_date,
  });
  return oAuth2Client;
}