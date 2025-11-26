# Step-by-Step Guide: Access Server from External Device

Follow these steps to allow external devices to connect to your server.

## Prerequisites
- Your server computer and external device must be on different networks (or use mobile data for testing)
- Admin access to your router
- Server and client code already set up

---

## Step 1: Find Your Public IP Address

**On your server computer:**

1. Open a web browser
2. Go to: https://whatismyipaddress.com/
3. **Write down your Public IPv4 address** (e.g., `123.45.67.89`)
   - This is what external devices will use to connect

---

## Step 2: Find Your Local IP Address

**On your server computer:**

### Windows:
1. Press `Win + R`
2. Type `cmd` and press Enter
3. Type: `ipconfig`
4. Look for **IPv4 Address** under your active network adapter
   - Usually looks like: `192.168.1.100` or `192.168.0.100`
   - **Write this down** - you'll need it for port forwarding

### Mac/Linux:
1. Open Terminal
2. Type: `ifconfig` or `ip addr`
3. Look for your network interface (usually `eth0` or `wlan0`)
4. Find the `inet` address (e.g., `192.168.1.100`)
   - **Write this down**

---

## Step 3: Configure the Server

**Edit `angular+socket/socket-server/config.ts`:**

```typescript
// Make sure these are set correctly:
export const SERVER_HOST = '0.0.0.0';  // Must be 0.0.0.0 (not localhost!)
export const SERVER_PORT = 3000;       // Your chosen port
```

**Add your public IP to CORS (optional, for testing you can use '*'):**

```typescript
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
  /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/,  // Allow any IP (for testing)
];
```

**Or use '*' for Socket.IO CORS (development only):**

```typescript
export const SOCKET_CORS_ORIGIN = '*';  // Allow all origins
```

---

## Step 4: Configure Windows Firewall

**On your server computer (Windows):**

1. Press `Win + R`
2. Type `wf.msc` and press Enter (opens Windows Firewall)
3. Click **"Inbound Rules"** on the left
4. Click **"New Rule..."** on the right
5. Select **"Port"** → Next
6. Select **"TCP"** and enter port **3000** → Next
7. Select **"Allow the connection"** → Next
8. Check all boxes (Domain, Private, Public) → Next
9. Name it **"Clarity Server"** → Finish

**Alternative (PowerShell as Admin):**
```powershell
New-NetFirewallRule -DisplayName "Clarity Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

---

## Step 5: Configure Router Port Forwarding

### 5.1 Access Router Admin Panel

1. Open a web browser
2. Type your router's IP address (usually one of these):
   - `192.168.1.1`
   - `192.168.0.1`
   - `192.168.2.1`
   - Check router manual or sticker on router
3. Enter admin username/password
   - Default is often `admin/admin` or `admin/password`
   - Check router manual if unsure

### 5.2 Find Port Forwarding Section

Look for one of these sections (varies by router):
- **"Port Forwarding"**
- **"Virtual Server"**
- **"NAT"** → **"Port Forwarding"**
- **"Advanced"** → **"Port Forwarding"**
- **"Firewall"** → **"Port Forwarding"**

### 5.3 Add Port Forwarding Rule

Click **"Add"** or **"Create New Rule"** and fill in:

- **Service Name**: `Clarity Server` (or any name)
- **External Port**: `3000`
- **Internal IP**: Your local IP from Step 2 (e.g., `192.168.1.100`)
- **Internal Port**: `3000`
- **Protocol**: `TCP` (or `Both`)

**Example:**
```
Service Name: Clarity Server
External Port: 3000
Internal IP: 192.168.1.100
Internal Port: 3000
Protocol: TCP
```

### 5.4 Save and Apply

1. Click **"Save"** or **"Apply"**
2. Router may restart - wait 1-2 minutes
3. **Write down the rule** - you may need to recreate it if router resets

---

## Step 6: Start the Server

**On your server computer:**

1. Open terminal/command prompt
2. Navigate to server directory:
   ```bash
   cd angular+socket/socket-server
   ```
3. Start the server:
   ```bash
   npm start
   # or
   node server.ts
   # or
   ts-node server.ts
   ```

4. You should see:
   ```
   🚀 Server running on http://0.0.0.0:3000
   📡 Listening on all interfaces (0.0.0.0) - ready for external connections
   ```

5. **Keep this terminal open** - server must stay running

---

## Step 7: Test Server Accessibility

### Option A: Online Port Checker

1. Go to: https://www.yougetsignal.com/tools/open-ports/
2. Enter your **Public IP** (from Step 1)
3. Enter port **3000**
4. Click **"Check"**
5. Should show **"Port 3000 is open"** ✅

### Option B: From Another Network

1. Use a different network (mobile hotspot, friend's WiFi)
2. Open browser on that device
3. Try: `http://YOUR_PUBLIC_IP:3000`
4. Should connect (may show error, but connection works)

---

## Step 8: Configure Client on External Device

### 8.1 On the External Device

**Edit `angular+socket/chat-frontend/src/app/config/app.config.ts`:**

```typescript
// Replace with your PUBLIC IP from Step 1
export const SERVER_HOST = 'http://YOUR_PUBLIC_IP';  // e.g., 'http://123.45.67.89'
export const SERVER_PORT = '3000';
export const SERVER_URL = `${SERVER_HOST}:${SERVER_PORT}`;
```

**OR set it in `index.html` (before Angular loads):**

Edit `angular+socket/chat-frontend/src/index.html`:

```html
<!doctype html>
<html>
<head>
  <!-- Add this script BEFORE other scripts -->
  <script>
    window.__SERVER_HOST__ = 'http://YOUR_PUBLIC_IP';  // e.g., 'http://123.45.67.89'
    window.__SERVER_PORT__ = '3000';
  </script>
  <!-- ... rest of head ... -->
</head>
```

### 8.2 Build and Run Client

```bash
cd angular+socket/chat-frontend
npm install  # if first time
ng serve --host 0.0.0.0 --port 4200
```

Or for production build:
```bash
ng build
# Serve the dist folder with a web server
```

---

## Step 9: Test Connection

1. **On external device**, open the Angular app
2. **Open browser console** (F12)
3. Look for:
   ```
   Connected to server: [socket-id]
   [SocketService] Identified user: [username]
   ```
4. Try listing projects - should see hosted projects from server

---

## Troubleshooting

### ❌ "Connection refused" or "Cannot connect"

**Check:**
1. ✅ Server is running (Step 6)
2. ✅ Server listening on `0.0.0.0` (not `localhost`)
3. ✅ Firewall allows port 3000 (Step 4)
4. ✅ Port forwarding is active (Step 5)
5. ✅ Public IP is correct
6. ✅ Client config has correct IP

**Test locally first:**
- Try `http://localhost:3000` on server computer
- Should work if server is running

### ❌ "CORS error" in browser

**Fix:**
1. Add your client's origin to `ALLOWED_ORIGINS` in `config.ts`
2. Or temporarily use `'*'` for `SOCKET_CORS_ORIGIN`

### ❌ Port forwarding not working

**Check:**
1. Router admin panel shows rule is active
2. Internal IP matches your computer's IP (check with `ipconfig` again)
3. Try restarting router
4. Some routers need "Enable" checkbox checked

### ❌ Public IP changed

**If your ISP gives you a dynamic IP:**
- IP may change when router restarts
- Use Dynamic DNS service (No-IP, DuckDNS) for a stable domain
- Or check IP again and update client config

### ❌ Can't access router admin

**Try:**
- Check router manual for default IP
- Try `192.168.1.1`, `192.168.0.1`, `10.0.0.1`
- Reset router to factory defaults (last resort)

---

## Quick Checklist

Before testing external access, verify:

- [ ] Public IP written down
- [ ] Local IP written down
- [ ] Server config: `SERVER_HOST = '0.0.0.0'`
- [ ] Firewall allows port 3000
- [ ] Port forwarding rule created in router
- [ ] Server is running
- [ ] Client config has public IP
- [ ] Testing from different network

---

## Security Notes

⚠️ **Important:**

1. **Don't use `'*'` for CORS in production** - only allow trusted origins
2. **Use HTTPS** for production (requires SSL certificate)
3. **Consider authentication** before allowing connections
4. **Close port forwarding** when not needed
5. **Use strong passwords** for router admin

---

## Need Help?

If you're stuck:
1. Check server console for error messages
2. Check browser console (F12) for client errors
3. Verify each step was completed
4. Test with port checker tool first
5. Try connecting from local network first (using local IP)

