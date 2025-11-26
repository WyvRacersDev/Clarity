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

// Server binding configuration
export const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0'; // '0.0.0.0' = all interfaces, 'localhost' = local only
export const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);

// Frontend URL (for CORS and OAuth redirects)
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

// CORS Configuration
// Add your frontend URLs here (supports localhost, IP addresses, and domains)
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  /^http:\/\/localhost:\d+$/,  // Localhost with any port
  /^http:\/\/127\.0\.0\.1:\d+$/,  // 127.0.0.1 with any port
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,  // Local network IPs (192.168.x.x)
  /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,  // Private network IPs (10.x.x.x)
  // Add your public domain/IP here if needed:
  // 'http://yourdomain.com:4200',
  // /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/,  // Any IP address (less secure)
];

// Socket.IO CORS configuration
export const SOCKET_CORS_ORIGIN = process.env.SOCKET_CORS_ORIGIN || '*'; // '*' = allow all (for development)

