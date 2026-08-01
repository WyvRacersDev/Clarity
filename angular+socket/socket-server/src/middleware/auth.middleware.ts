import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { JWT_SECRET, AUTH_STRICT } from '../config/index.js'
import { verifyJwt, type JwtClaims } from '../services/auth.service.js'

/**
 * Strict JWT gate — rejects any request without a valid `Authorization: Bearer`
 * token. Use for routes that must never be reachable unauthenticated.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)

    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

/**
 * Pull the JWT from either the `Authorization: Bearer` header or a `?token=`
 * query param. The query fallback exists because `EventSource` (used by the SSE
 * streaming route) cannot set custom headers.
 */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    const t = header.slice('Bearer '.length).trim()
    if (t) return t
  }
  const q = req.query.token
  if (typeof q === 'string' && q) return q
  return undefined
}

/**
 * HTTP identity middleware — the request-side analogue of the Socket.IO
 * `socketAuth` handshake. A valid JWT populates `req.user` with verified claims;
 * the permissive/strict behaviour is driven by the SAME `AUTH_STRICT` switch as
 * the socket layer:
 *   - PERMISSIVE (default): a missing/invalid token does NOT reject — the request
 *     continues unauthenticated and the route falls back to the legacy `?username`
 *     param (so the tokenless demo path keeps working).
 *   - STRICT: a missing/invalid token is rejected with 401.
 *
 * Pair with `resolveUsername()` so an authenticated caller's identity always
 * comes from the verified token, never a spoofable query param.
 */
export function resolveIdentity(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) {
    if (AUTH_STRICT) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    return next()
  }
  try {
    req.user = verifyJwt(token)
    return next()
  } catch {
    if (AUTH_STRICT) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    return next()
  }
}

/**
 * The authoritative username for a request: the verified token's username when
 * present (so a `?username` param can NOT impersonate an authenticated user),
 * otherwise the legacy `?username` fallback (permissive/demo). Returns '' when
 * neither is available; callers may substitute their own default.
 */
export function resolveUsername(req: Request): string {
  const claims = req.user as JwtClaims | undefined
  if (claims && typeof claims.username === 'string' && claims.username) {
    return claims.username
  }
  const q = req.query.username
  return typeof q === 'string' ? q : ''
}
