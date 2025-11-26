/**
 * Client Configuration
 * 
 * To connect to a remote server:
 * 1. Set SERVER_HOST to your server's public IP address or domain
 * 2. Set SERVER_PORT to the port your server is listening on (default: 3000)
 * 3. If using port forwarding, use your public IP and the forwarded port
 * 
 * Examples:
 * - Local development: 'http://localhost:3000'
 * - Local network: 'http://192.168.1.100:3000'
 * - Public IP with port forwarding: 'http://YOUR_PUBLIC_IP:3000'
 * - Domain: 'http://yourdomain.com:3000'
 */

// Server URL - Update this to point to your server
// For SSR compatibility, we use a function that checks window at runtime
export function getServerConfig() {
  if (typeof window !== 'undefined') {
    const host = (window as any).__SERVER_HOST__ || 'http://localhost';
    const port = (window as any).__SERVER_PORT__ || '3000';
    return `${host}:${port}`;
  }
  // Default for SSR
  return 'http://localhost:3000';
}

// Export as constant for backward compatibility (will be evaluated at runtime in browser)
export const SERVER_URL = getServerConfig();

// Alternative: Set via environment variable or build-time config
// You can also set this in index.html as a script variable:
// <script>window.__SERVER_HOST__ = 'http://YOUR_PUBLIC_IP'; window.__SERVER_PORT__ = '3000';</script>

