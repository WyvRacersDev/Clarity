/**
 * Auth routes (Phase 3, relocated to src/http/ in Phase 6a): email/password +
 * Google login.
 *
 *   POST /auth/register  { email, username, password }        -> { token, user }
 *   POST /auth/login     { identifier, password }             -> { token, user }
 *   GET  /auth/google                                          -> 302 to Google
 *   GET  /auth/google/callback  (handled in google.routes.ts alongside /oauth2callback)
 *
 * Google login is distinguished from the existing calendar-connect flow via the
 * OAuth `state=login` marker on the SAME registered redirect URI (/oauth2callback).
 *
 * Phase 6a adds zod validation on the register/login bodies: malformed bodies get
 * HTTP 400 `{ error }` (same shape used by AuthError), leaving the success path
 * and the existing AuthError mapping unchanged.
 */
import { Router } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import {
  registerWithPassword,
  loginWithPassword,
  AuthError,
} from "../services/auth.service.js";
import { getGlobalOAuthClient } from "../services/OAuth.service.js";
import { registerSchema, loginSchema, formatZodError } from "../validation/schemas.js";
import { AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX } from "../config/index.js";

export const authRouter: Router = Router();

// Parse JSON bodies for the auth POST endpoints only (keeps global app untouched).
authRouter.use(express.json());

// Rate limiter for credential endpoints: caps brute-force / abuse per IP.
// Window and max are env-configurable (defaults: 10 requests / 15 min per IP).
//
// A12: login and register get SEPARATE buckets. They previously shared one
// limiter instance (one counter per IP across both routes), so a burst of
// registrations — or a few failed login attempts mixed with them — could exhaust
// the shared budget and lock a user out of *login* for the rest of the window.
// Two independent `rateLimit` instances each keep their own per-IP counter, so
// register traffic can never consume login's allowance (and vice versa).
function makeAuthRateLimiter() {
  return rateLimit({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX,
    standardHeaders: true, // expose RateLimit-* headers
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  });
}

const loginRateLimiter = makeAuthRateLimiter();
const registerRateLimiter = makeAuthRateLimiter();

authRouter.post("/register", registerRateLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }
  try {
    const { email, username, password } = parsed.data;
    const { user, token } = await registerWithPassword({ email, username, password });
    res.status(201).json({ token, user });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("[auth] register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

authRouter.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }
  try {
    const { identifier, email, username, password } = parsed.data;
    // Accept `identifier`, or fall back to email/username for convenience.
    // The loginSchema refine guarantees at least one of these is present.
    const id = (identifier ?? email ?? username) as string;
    const { user, token } = await loginWithPassword({ identifier: id, password });
    res.json({ token, user });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("[auth] login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * Start Google login. Generates a Google consent URL with `state=login` so the
 * shared /oauth2callback can tell login apart from calendar-connect. We request
 * the same scopes as the calendar flow so `saveUserTokens` still enables
 * calendar/contacts after a login.
 */
authRouter.get("/google", async (_req, res) => {
  try {
    const client = await getGlobalOAuthClient();
    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state: "login",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        "https://www.googleapis.com/auth/contacts.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.modify",
      ],
    });
    res.redirect(authUrl);
  } catch (err: any) {
    console.error("[auth] google start error:", err);
    res
      .status(500)
      .json({ error: `Google login unavailable: ${err.message}` });
  }
});
