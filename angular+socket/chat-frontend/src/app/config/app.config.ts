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
// Priority: localStorage > window variables > default
export function getServerConfig() {
  if (typeof window !== 'undefined') {
    // First check localStorage (user-configured in settings)
    try {
      const storedUrl = localStorage.getItem('server_url');
      if (storedUrl) {
        return storedUrl;
      }
    } catch (e) {
      // localStorage might not be available
    }
    
    // Fallback to window variables
    const host = (window as any).__SERVER_HOST__ || 'http://localhost';
    const port = (window as any).__SERVER_PORT__ || '3000';
    return `${host}:${port}`;
  }
  // Default for SSR
  return 'http://localhost:3000';
}

// Helper function to save server URL to localStorage
export function saveServerConfig(url: string): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('server_url', url);
    } catch (e) {
      console.error('Failed to save server URL to localStorage:', e);
    }
  }
}

// Helper function to get current server URL (for display)
export function getCurrentServerConfig(): string {
  return getServerConfig();
}

// Helper function to check if server URL is localhost
export function isLocalhostServer(): boolean {
  if (typeof window === 'undefined') {
    return true; // Default to localhost for SSR
  }
  
  const serverUrl = getServerConfig().toLowerCase();
  // Check for localhost, 127.0.0.1, or ::1 (IPv6 localhost)
  return serverUrl.includes('localhost') || 
         serverUrl.includes('127.0.0.1') || 
         serverUrl.includes('[::1]') ||
         serverUrl.startsWith('http://localhost') ||
         serverUrl.startsWith('https://localhost');
}

// Export as constant for backward compatibility (will be evaluated at runtime in browser)
export const SERVER_URL = getServerConfig();

// Alternative: Set via environment variable or build-time config
// You can also set this in index.html as a script variable:
// <script>window.__SERVER_HOST__ = 'http://YOUR_PUBLIC_IP'; window.__SERVER_PORT__ = '3000';</script>

