/**
 * Socket.IO handshake auth middleware (Phase 3).
 *
 * Reads the JWT from `socket.handshake.auth.token`, verifies it, and stores the
 * resulting user on `socket.data.user` so handlers can trust the token instead
 * of client-sent payload identity.
 *
 * Rollout mode is controlled by config `AUTH_STRICT`:
 *   - PERMISSIVE (default, AUTH_STRICT=false): a missing/invalid token does NOT
 *     reject the connection — it connects unauthenticated and handlers fall back
 *     to the legacy payload-based identity. A warning is logged.
 *   - STRICT (AUTH_STRICT=true): a missing or invalid token rejects the
 *     handshake with an error.
 *
 * NOTE (D2): AUTH_STRICT=true is the PRODUCTION TARGET, to be enabled once the
 * frontend always sends the JWT via `socket.handshake.auth.token`. The default
 * is intentionally left permissive (false) here and in config; flipping it
 * requires live end-to-end testing (the client must send a valid token or every
 * connection will be rejected). See .env.example for the AUTH_STRICT note.
 */
import type { Socket } from "socket.io";
import { verifyJwt } from "../services/auth.service.js";
import type { AuthUser } from "../services/auth.service.js";
import { AUTH_STRICT } from "../config/index.js";

// Augment socket.data with the authenticated user.
declare module "socket.io" {
  interface SocketData {
    user?: AuthUser;
  }
}

export function socketAuth(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const token =
    (socket.handshake.auth && (socket.handshake.auth as any).token) ||
    undefined;

  if (!token) {
    if (AUTH_STRICT) {
      return next(new Error("Authentication required: no token provided"));
    }
    console.warn(
      `[socketAuth] Permissive: tokenless handshake allowed (socket ${socket.id}); falling back to legacy identity.`
    );
    return next();
  }

  try {
    const claims = verifyJwt(token);
    socket.data.user = {
      id: claims.sub,
      username: claims.username,
      email: claims.email,
    };
    console.log(
      `[socketAuth] Authenticated socket ${socket.id} as ${claims.username || claims.email} (${claims.sub})`
    );
    return next();
  } catch (err: any) {
    if (AUTH_STRICT) {
      return next(new Error("Authentication failed: invalid token"));
    }
    console.warn(
      `[socketAuth] Permissive: invalid token on socket ${socket.id} (${err?.message ?? err}); falling back to legacy identity.`
    );
    return next();
  }
}
