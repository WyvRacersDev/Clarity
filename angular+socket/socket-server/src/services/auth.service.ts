/**
 * Auth service — backend-issued authentication (Phase 3).
 *
 * Responsibilities:
 *   - Email/password register + login (bcryptjs against `users.password_hash`).
 *   - Issue / verify our own JWTs (claims { sub, username, email }).
 *   - Google login: find-or-create a `users` row from a Google profile and link
 *     it via `oauth_identities` (reusing the identity resolver's `ensureUser`).
 *
 * This does NOT replace `OAuth.service.ts` (which manages Google *API* tokens for
 * calendar/contacts). Google login here is about establishing app identity; the
 * two concerns are kept separate but the callback still saves API tokens.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { ensureUser } from "../repositories/identity.repository.js";
import type { UserRow } from "../repositories/identity.repository.js";
import * as authRepo from "../repositories/auth.repository.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/index.js";
import { SharingService } from "./sharing.service.js";

const BCRYPT_ROUNDS = 10;

// Stateless orchestrator for auto-accepting project invitations on account
// creation (N1). Failures here must never block sign-up / login.
const sharingService = new SharingService();

/**
 * N1: convert any pending project invitations addressed to this user's email
 * into real memberships, so an invited person gains access the moment they have
 * an account. Best-effort — swallow errors so auth never fails on this.
 */
async function acceptInvitationsFor(user: AuthUser): Promise<void> {
  try {
    await sharingService.acceptPendingInvitations({ id: user.id, email: user.email });
  } catch (err) {
    console.error("[auth] accepting pending invitations failed:", err);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

export interface JwtClaims {
  sub: string;
  username: string;
  email: string;
  /** Optional avatar URL (e.g. Google profile photo) for display only. */
  picture?: string;
}

/** Thrown for expected auth failures so routes can map them to HTTP codes. */
export class AuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, email: row.email };
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

/**
 * Sign a JWT for a user. Claims: { sub: userId, username, email }, plus an
 * optional `picture` (avatar URL) used by the frontend for display only.
 */
export function issueJwt(user: AuthUser, picture?: string): string {
  const claims: JwtClaims = {
    sub: user.id,
    username: user.username,
    email: user.email,
  };
  if (picture) {
    claims.picture = picture;
  }
  const options = {
    expiresIn: JWT_EXPIRES_IN,
  } as SignOptions;
  return jwt.sign(claims, JWT_SECRET, options);
}

/** Verify a JWT and return the decoded claims, or throw if invalid/expired. */
export function verifyJwt(token: string): JwtClaims {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
    throw new AuthError("Invalid token", 401);
  }
  const { sub, username, email, picture } = decoded as Record<string, unknown>;
  if (typeof sub !== "string") {
    throw new AuthError("Invalid token claims", 401);
  }
  return {
    sub,
    username: typeof username === "string" ? username : "",
    email: typeof email === "string" ? email : "",
    ...(typeof picture === "string" && picture ? { picture } : {}),
  };
}

// ─── Email / password ──────────────────────────────────────────────────────

/**
 * Register a new user with an email + username + password. Throws AuthError(409)
 * if the email or username is already taken (unique violation).
 */
export async function registerWithPassword(input: {
  email: string;
  username: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  const email = (input.email || "").trim().toLowerCase();
  const username = (input.username || "").trim();
  const password = input.password || "";

  if (!email || !username || !password) {
    throw new AuthError("email, username and password are required", 400);
  }
  if (password.length < 6) {
    throw new AuthError("password must be at least 6 characters", 400);
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const row = await authRepo.insertUserWithPassword(username, email, password_hash);
    const user = toAuthUser(row);
    await acceptInvitationsFor(user); // N1: honor pending invites for this email
    return { user, token: issueJwt(user) };
  } catch (err: any) {
    // Postgres unique_violation
    if (err && err.code === "23505") {
      throw new AuthError("A user with that email or username already exists", 409);
    }
    throw err;
  }
}

/**
 * Log in with an identifier (email or username) + password. Throws AuthError(401)
 * on unknown user, no password set (e.g. Google-only account), or bad password.
 */
export async function loginWithPassword(input: {
  identifier: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  const identifier = (input.identifier || "").trim();
  const password = input.password || "";
  if (!identifier || !password) {
    throw new AuthError("identifier and password are required", 400);
  }

  const hasAt = identifier.includes("@");
  const value = hasAt ? identifier.toLowerCase() : identifier;
  // Match against either column so email or username both work.
  const row = await authRepo.findUserByEmailOrUsername(value, identifier);
  if (!row || !row.password_hash) {
    throw new AuthError("Invalid credentials", 401);
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    throw new AuthError("Invalid credentials", 401);
  }

  const user = toAuthUser(row);
  return { user, token: issueJwt(user) };
}

// ─── Google login ────────────────────────────────────────────────────────────

export interface GoogleProfile {
  sub: string; // Google account id
  email: string;
  name?: string;
}

/**
 * Link a Google identity (`sub`) to a user in `oauth_identities`. Idempotent:
 * ON CONFLICT (provider, provider_user_id) keeps the existing mapping and just
 * refreshes the recorded email.
 */
export async function linkGoogleIdentity(
  userId: string,
  sub: string,
  email: string
): Promise<void> {
  await authRepo.linkGoogleIdentity(userId, sub, email);
}

/**
 * Find or create a user from a verified Google profile.
 *   1. If an oauth_identities row exists for this `sub`, reuse that user.
 *   2. Otherwise resolve/create the user by email (via `ensureUser`) and link.
 * Second logins for the same Google account always resolve to the same user id.
 */
export async function findOrCreateUserFromGoogle(
  profile: GoogleProfile
): Promise<AuthUser> {
  const email = (profile.email || "").trim().toLowerCase();
  if (!profile.sub || !email) {
    throw new AuthError("Google profile missing sub/email", 400);
  }

  // 1. Existing linked identity → reuse the user.
  const linkedUserId = await authRepo.findUserIdByGoogleSub(profile.sub);
  if (linkedUserId) {
    const row = await authRepo.findUserById(linkedUserId);
    if (row) {
      const user = toAuthUser(row);
      // Keep the recorded email fresh in case it changed.
      await linkGoogleIdentity(user.id, profile.sub, email);
      return user;
    }
  }

  // 2. No linked identity yet: resolve/create by email, then link.
  const row = await ensureUser(email);
  const user = toAuthUser(row);
  await linkGoogleIdentity(user.id, profile.sub, email);
  await acceptInvitationsFor(user); // N1: honor pending invites for this email
  return user;
}
