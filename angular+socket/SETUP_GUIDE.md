# Quick Setup Guide - Customizable Server IP and Port

## Server Configuration

Edit `angular+socket/socket-server/config.ts`:

```typescript
// Listen on all interfaces (required for external connections)
export const SERVER_HOST = '0.0.0.0';

// Your server port
export const SERVER_PORT = 3000;

// Add your public IP or domain to CORS (if needed)
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
  // Add your public IP:
  // 'http://YOUR_PUBLIC_IP:4200',
];
```

## Client Configuration

Edit `angular+socket/chat-frontend/src/app/config/app.config.ts`:

```typescript
// Set to your server's IP/domain
export const SERVER_HOST = 'http://YOUR_PUBLIC_IP';  // e.g., 'http://123.45.67.89'
export const SERVER_PORT = '3000';
export const SERVER_URL = `${SERVER_HOST}:${SERVER_PORT}`;
```

## Using Environment Variables

### Server (.env file in `socket-server/` directory)

Create `angular+socket/socket-server/.env`:
```
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
FRONTEND_URL=http://localhost:4200
SOCKET_CORS_ORIGIN=*
```

### Client (via index.html)

Add to `angular+socket/chat-frontend/src/index.html`:
```html
<script>
  window.__SERVER_HOST__ = 'http://YOUR_PUBLIC_IP';
  window.__SERVER_PORT__ = '3000';
</script>
```

## Port Forwarding Steps

1. **Find your public IP**: Visit https://whatismyipaddress.com/
2. **Find your local IP**: Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
3. **Configure router**: Forward external port 3000 → internal IP:3000
4. **Update configs**: Set SERVER_HOST in client config to your public IP
5. **Test**: Start server and try connecting from another network

See `PORT_FORWARDING.md` for detailed instructions.

