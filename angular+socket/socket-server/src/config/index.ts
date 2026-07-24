/**
 * Server Configuration
 * 
 * To allow external connections:
 * 1. Set SERVER_HOST to your public IP or '0.0.0.0' to listen on all interfaces
 * 2. Set SERVER_PORT to your desired port (default: 3000)
 * 3. Set up port forwarding on your router:
 *    - Forward external port to SERVER_PORT on this machine
 *    - Use your public IP address
 * 4. Update FRONTEND_URL to match your frontend URL
 * 5. Update CORS origins to allow your frontend domain
 */

// Whether we're running in production. Used to decide between "fail fast on
// missing secrets" (prod) and "warn but keep booting" (dev ergonomics).
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Resolve a required secret env var.
 *   - production: missing value throws at startup (fail fast, no insecure default).
 *   - development: missing value falls back to `devDefault` but logs a loud
 *     [SECURITY] warning so it's obvious the insecure default is in use.
 */
function requireSecret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (IS_PRODUCTION) {
    throw new Error(
      `[SECURITY] ${name} is required in production but is not set. ` +
        `Refusing to start with an insecure default. Set ${name} in the environment (.env).`
    );
  }
  console.warn(
    `[SECURITY] Using insecure dev ${name} — set ${name} in .env`
  );
  return devDefault;
}

// Server binding configuration
export const SHARED_SERVER= "192.0.0.1"//dummy value
export const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0'; // '0.0.0.0' = all interfaces, 'localhost' = local only
export const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);

// Frontend URL (for CORS and OAuth redirects)
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

// CORS Configuration
// Development-only default allow-list: localhost + private LAN ranges. These are
// ONLY applied when not in production (see resolveCorsOrigin below).
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  /^http:\/\/localhost:\d+$/,  // Localhost with any port
  /^http:\/\/127\.0\.0\.1:\d+$/,  // 127.0.0.1 with any port
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,  // Local network IPs (192.168.x.x)
  /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,  // Private network IPs (10.x.x.x)
  // Add your public domain/IP here if needed:
  // 'http://yourdomain.com:4200',
  // /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/,  // Any IP address (less secure)
];

// Raw Socket.IO CORS origin env value. In development we default to '*' (allow
// all) for convenience; in production '*' is refused (see below).
export const SOCKET_CORS_ORIGIN = process.env.SOCKET_CORS_ORIGIN || (IS_PRODUCTION ? '' : '*');

/**
 * Compute the explicit list of allowed origins for production from
 * SOCKET_CORS_ORIGIN and FRONTEND_URL (both comma-separated allowed).
 * Returns a de-duplicated array of concrete origin strings.
 */
export function getExplicitAllowedOrigins(): string[] {
  const raw = [SOCKET_CORS_ORIGIN, FRONTEND_URL]
    .filter((v) => v && v !== '*')
    .join(',');
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '*');
  return Array.from(new Set(list));
}

// In production we MUST NOT run with a wildcard CORS origin.
if (IS_PRODUCTION && (SOCKET_CORS_ORIGIN === '*' || getExplicitAllowedOrigins().length === 0)) {
  throw new Error(
    `[SECURITY] Refusing to start in production with wildcard/empty CORS origins. ` +
      `Set SOCKET_CORS_ORIGIN and/or FRONTEND_URL to explicit, comma-separated origins.`
  );
}

// ─── Database ──────────────────────────────────────────────────────────────
// Postgres is the single source of truth (see docker-compose.yml).
export const DATABASE_URL = requireSecret(
  'DATABASE_URL',
  'postgres://clarity:clarity@localhost:5433/clarity'
);

// ─── Auth ──────────────────────────────────────────────────────────────────
// Secret used to sign/verify the backend's own JWTs.
export const JWT_SECRET = requireSecret('JWT_SECRET', 'dev-insecure-change-me');
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ─── Uploads ───────────────────────────────────────────────────────────────
// Max accepted size (bytes) for an incoming uploadFile base64 payload. Enforced
// in the file gateway (per-message) and mirrored at the Socket.IO transport
// layer via maxHttpBufferSize. Default 10MB.
export const MAX_UPLOAD_BYTES = parseInt(
  process.env.MAX_UPLOAD_BYTES || String(10 * 1024 * 1024),
  10
);

// ─── Rate limiting (auth routes) ───────────────────────────────────────────
// Window and max requests per IP for POST /auth/login and /auth/register.
export const AUTH_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000),
  10
); // default 15 minutes
export const AUTH_RATE_LIMIT_MAX = parseInt(
  process.env.AUTH_RATE_LIMIT_MAX || '10',
  10
); // default 10 requests per window per IP

// When true, the Socket.IO handshake REQUIRES a valid JWT (tokenless connections
// are rejected). When false (default, "permissive"), tokenless handshakes are
// allowed and fall back to the legacy payload-based identity. This lets the app
// keep working before the frontend is fully wired up (Phase 4). Flip to strict
// (AUTH_STRICT=true) once every client sends a token.
export const AUTH_STRICT =
  (process.env.AUTH_STRICT || 'false').toLowerCase() === 'true';

