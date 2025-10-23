const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:4200", // Angular dev server
    methods: ["GET", "POST"]
  }
});

const messages = []; // In-memory history

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // Send history immediately
  socket.emit("chatHistory", messages);

  socket.on("chatMessage", (msg) => {
    console.log("💬 Message:", msg);

    // Save message to history
    messages.push(msg);

    // Broadcast new message
    io.emit("chatMessage", msg);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});


// === Paths ===
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "tokens.json");

// === Load credentials ===
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
const { client_secret, client_id, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// === Generate auth URL ===
app.get("/auth", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures refresh token is returned
    scope: ["https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive.metadata.readonly", // add any scopes you want
    ],
  });
  res.redirect(authUrl);
});

// === Handle OAuth callback ===
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // === Get user info ===
    const oauth2 = google.oauth2({ version: "v2", auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();

    // === Read existing tokens ===
    let tokenStore = {};
    if (fs.existsSync(TOKEN_PATH)) {
      tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    }

    // === Save credentials for this user ===
    const email = userInfo.data.email;
    tokenStore[email] = tokens;

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenStore, null, 2));
    res.send(`✅ Authentication successful! Tokens saved for ${email}`);
  } catch (err) {
    console.error("Error during OAuth callback:", err);
    res.status(500).send("Error retrieving access token");
  }
});

// === Example protected route ===
app.get("/profile", async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.send("No tokens found. Please /auth first.");
  }

  const tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  const emails = Object.keys(tokenStore);
  res.json({ savedUsers: emails });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
app.get("/test", async (req, res) => {
  try {
    const allTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

    // pick one user to test
    const userEmails = Object.keys(allTokens);
    if (userEmails.length === 0) {
      return res.status(400).send("❌ No saved tokens found. Please log in first.");
    }

    const testEmail = userEmails[0];
    const tokens = allTokens[testEmail];

    // reauthorize client
    const oAuth2Client = new google.auth.OAuth2(
      credentials.web.client_id,
      credentials.web.client_secret,
      credentials.web.redirect_uris[0]
    );
    oAuth2Client.setCredentials(tokens);

    // call Google Calendar API
    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
    const events = await calendar.events.list({
      calendarId: "primary",
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
    });

    const upcoming = events.data.items || [];
    if (upcoming.length === 0) {
      res.send(`✅ Successfully reused tokens for ${testEmail}, but no upcoming events found.`);
    } else {
      res.send({
        message: `✅ Successfully reused tokens for ${testEmail}`,
        events: upcoming.map(e => e.summary || "No Title"),
      });
    }
  } catch (error) {
    console.error("Error reusing tokens:", error);
    res.status(500).send("❌ Failed to reuse tokens. Check console for details.");
  }
});
