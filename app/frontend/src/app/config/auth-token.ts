/**
 * Single source of truth for the frontend's JWT.
 *
 * The token is stored under `auth_token` (the same key the Socket.IO handshake
 * and AuthService use). These helpers let the HTTP services attach the token so
 * the backend can identify the caller from the verified JWT instead of a
 * spoofable `?username` query param. SSR-safe: return null/empty off-browser.
 */
const AUTH_TOKEN_KEY = 'auth_token';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** `Authorization: Bearer` header object, or `{}` when there is no token. */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * `&token=<jwt>` query fragment for endpoints that can't send headers
 * (EventSource / SSE). Empty string when there is no token.
 */
export function authTokenQuery(): string {
  const token = getAuthToken();
  return token ? `&token=${encodeURIComponent(token)}` : '';
}
