# Port Forwarding Setup Guide

This guide explains how to set up port forwarding so others can connect to your hosted projects.

## Server Configuration

### 1. Update Server Config (`angular+socket/socket-server/config.ts`)

```typescript
// Set to '0.0.0.0' to listen on all network interfaces
export const SERVER_HOST = '0.0.0.0';

// Set your desired port (default: 3000)
export const SERVER_PORT = 3000;

// Update CORS to allow your frontend domain/IP
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,  // Local network
  // Add your public IP or domain:
  'http://YOUR_PUBLIC_IP:4200',
  // Or allow all IPs (less secure, for development):
  // /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/,
];
```

### 2. Find Your Public IP Address

- Visit https://whatismyipaddress.com/ or similar
- Note your public IP address (e.g., `123.45.67.89`)

### 3. Configure Port Forwarding on Your Router

1. **Access Router Admin Panel**
   - Usually at `192.168.1.1` or `192.168.0.1`
   - Check router manual for default IP

2. **Find Port Forwarding Section**
   - Look for "Port Forwarding", "Virtual Server", or "NAT"
   - May be under "Advanced" or "Firewall" settings

3. **Add Port Forwarding Rule**
   - **Service Name**: Clarity Server (or any name)
   - **External Port**: `3000` (or your chosen port)
   - **Internal IP**: Your computer's local IP (e.g., `192.168.1.100`)
     - Find this with `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
   - **Internal Port**: `3000` (same as external, or your SERVER_PORT)
   - **Protocol**: TCP (or Both)

4. **Save and Apply**

### 4. Configure Firewall

**Windows:**
```powershell
# Allow incoming connections on port 3000
New-NetFirewallRule -DisplayName "Clarity Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

**Mac/Linux:**
```bash
# Allow incoming connections on port 3000
sudo ufw allow 3000/tcp
```

## Client Configuration

### Update Client Config (`angular+socket/chat-frontend/src/app/config/app.config.ts`)

```typescript
// Set to your server's public IP or domain
export const SERVER_HOST = 'http://YOUR_PUBLIC_IP';  // e.g., 'http://123.45.67.89'
export const SERVER_PORT = '3000';
export const SERVER_URL = `${SERVER_HOST}:${SERVER_PORT}`;
```

### Alternative: Set via index.html

Add this to `angular+socket/chat-frontend/src/index.html`:

```html
<script>
  // Set server URL before Angular loads
  window.__SERVER_HOST__ = 'http://YOUR_PUBLIC_IP';
  window.__SERVER_PORT__ = '3000';
</script>
```

## Testing

1. **Start the Server**
   ```bash
   cd angular+socket/socket-server
   npm start
   ```
   You should see: `🚀 Server running on http://0.0.0.0:3000`

2. **Test Local Connection**
   - Open browser to `http://localhost:3000`
   - Should see server response (or connection error if no route)

3. **Test External Connection**
   - From another device/network, try: `http://YOUR_PUBLIC_IP:3000`
   - Or use online tools like https://www.yougetsignal.com/tools/open-ports/

4. **Test Client Connection**
   - Start Angular app
   - Check browser console for connection status
   - Should see: `Connected to server: [socket-id]`

## Troubleshooting

### Can't Connect from External Network

1. **Check Port Forwarding**
   - Verify rule is active in router
   - Ensure internal IP matches your computer's IP
   - Try restarting router

2. **Check Firewall**
   - Ensure port 3000 is allowed in Windows Firewall/iptables
   - Temporarily disable firewall to test

3. **Check Server Binding**
   - Server must listen on `0.0.0.0`, not `localhost`
   - Verify in `config.ts`: `SERVER_HOST = '0.0.0.0'`

4. **Check CORS**
   - Add your client's origin to `ALLOWED_ORIGINS`
   - Or temporarily use `'*'` for testing

### Dynamic IP Address

If your public IP changes:
- Use a Dynamic DNS service (e.g., No-IP, DuckDNS)
- Update `SERVER_HOST` to use the domain name
- Or update config each time IP changes

### ISP Blocking

Some ISPs block incoming connections:
- Contact ISP to unblock port
- Use a VPN or cloud hosting as alternative

## Security Notes

⚠️ **Important Security Considerations:**

1. **Don't use `'*'` for CORS in production**
   - Only allow specific origins you trust

2. **Use HTTPS in production**
   - Set up SSL/TLS certificate
   - Update URLs to use `https://`

3. **Consider Authentication**
   - Add user authentication before allowing connections
   - Validate user permissions for hosted projects

4. **Firewall Rules**
   - Only open necessary ports
   - Consider using a reverse proxy (nginx) for additional security

## Environment Variables (Optional)

You can also use environment variables:

**Server (.env file):**
```
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
FRONTEND_URL=http://localhost:4200
```

**Client (environment.ts):**
```typescript
export const environment = {
  serverUrl: 'http://YOUR_PUBLIC_IP:3000'
};
```

