// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { ProjectHandler } from "./utils/project_handler.ts";
import { SERVER_HOST, SERVER_PORT, FRONTEND_URL, ALLOWED_ORIGINS, SOCKET_CORS_ORIGIN } from "./config.ts";




// const fs = require("fs");
// const path = require("path");
// const { google } = require("googleapis");
import fs from "fs";
import path from "path";
import { checks_v1alpha, google } from "googleapis";

import { Socket } from "socket.io";
import {objects_builder} from '../shared_models/dist/screen_elements.model.js'; // incredible location ngl 
import { Project, Grid } from '../shared_models/dist/project.model.js';
import cors from "cors";
import type { CorsOptions } from "cors";
import { startNotificationService } from "./utils/notification_service.ts";


const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: SOCKET_CORS_ORIGIN, // Configurable CORS origin
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 1e8 // 100MB - maximum buffer size for file uploads
});

// Dynamic CORS middleware in TypeScript
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, CURL, mobile apps)
    if (!origin) return callback(null, true);

    const isAllowed = ALLOWED_ORIGINS.some(pattern => {
      if (typeof pattern === 'string') {
        return pattern === origin;
      } else {
        return pattern.test(origin);
      }
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}. Add it to ALLOWED_ORIGINS in config.ts`);
      callback(new Error(`CORS blocked origin: ${origin}`));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));

// checkUpcomingTasks();
startNotificationService();

//   // Send history immediately
//   socket.emit("chatHistory", messages);

//   socket.on("chatMessage", (msg) => {
//     console.log("💬 Message:", msg);

//     // Save message to history
//     messages.push(msg);

//     // Broadcast new message
//     io.emit("chatMessage", msg);
//   });

//   socket.on("disconnect", () => {
//     console.log("❌ User disconnected:", socket.id);
//   });
// });


// === Paths ===

const project_handler=new ProjectHandler();

app.use('/projects', express.static(project_handler.get_base_path(), {
  setHeaders: (res, filePath) => {
    // Set appropriate content types
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (filePath.endsWith('.gif')) {
      res.setHeader('Content-Type', 'image/gif');
    } else if (filePath.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    } else if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (filePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    } else if (filePath.endsWith('.ogg')) {
      res.setHeader('Content-Type', 'video/ogg');
    }
  }
}));
// === Socket Event Handlers ===

// Store user sessions: socketId -> username
const userSessions = new Map<string, string>();

io.on("connection", (socket:Socket) => {
  console.log("✅ User connected:", socket.id);
  
  // Register user when they identify themselves
  socket.on("identifyUser", (data: { username: string }) => {
    userSessions.set(socket.id, data.username);
    console.log(`[Server] User identified: ${data.username} (socket: ${socket.id})`);
    socket.emit("userIdentified", { success: true, username: data.username });
  });
  
  // Clean up on disconnect
  socket.on("disconnect", () => {
    const username = userSessions.get(socket.id);
    if (username) {
      console.log(`[Server] User disconnected: ${username} (socket: ${socket.id})`);
      userSessions.delete(socket.id);
    } else {
      console.log("❌ User disconnected:", socket.id);
    }
  });

  // Receiving method
  socket.on("screenElement", (raw) => { 
    console.log("📦 Received element from client:", raw);

    // Optional: rebuild for server use
    const element = objects_builder.rebuild(raw); //will be used to store later on (abhi kerna hai)
    
    // Do something locally (save, log, process)
    // ❌ No broadcasting back
  });

  // === Project Management Socket Events ===

  /**
   * Save a project
   * Expected payload: { project: Project, projectType: 'local' | 'hosted' }
   */
  socket.on("saveProject", (data: { project: any; projectType: 'local' | 'hosted' }) => {
    try {
      const projectType = data.projectType || data.project?.project_type || 'local';
      console.log(`[Server] 💾 Saving project: "${data.project?.name}", Type: "${projectType}"`);
      const result = project_handler.saveProject(data.project, projectType);
      
      if (result.success) {
        // Send confirmation to the user who saved
        socket.emit("projectSaved", { success: true, message: result.message, projectName: data.project.name });
        
        // For hosted projects, broadcast the update to all connected clients
        if (projectType === 'hosted') {
          const connectedClients = io.sockets.sockets.size;
          console.log(`[Server] 📡 Broadcasting hosted project update: "${data.project.name}" to ${connectedClients} connected clients`);
          io.emit("hostedProjectUpdated", { 
            projectName: data.project.name,
            projectType: 'hosted'
          });
          console.log(`[Server] ✓ Broadcast sent for hosted project: "${data.project.name}"`);
        } else {
          console.log(`[Server] ℹ️ Project "${data.project.name}" is local, skipping broadcast`);
        }
      } else {
        console.error(`[Server] ✗ Failed to save project "${data.project?.name}":`, result.message);
        socket.emit("projectSaved", { success: false, message: result.message });
      }
    } catch (error: any) {
      console.error("Error in saveProject handler:", error);
      socket.emit("projectSaved", { success: false, message: `Error: ${error.message}` });
    }
  });

  /**
   * Load a project
   * For 'local': only owner can load
   * For 'hosted': anyone can load (public sharing)
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted' }
   */
  socket.on("loadProject", (data: { projectName: string; projectType: 'local' | 'hosted', eventName?: string }) => {
    try {
      const currentUser = userSessions.get(socket.id);
      
      // Load the project
      const result = project_handler.loadProject(data.projectName, data.projectType);
      
      // Use the provided event name if available, otherwise use default
      const eventName = data.eventName || "projectLoaded";
      
      if (result.success && result.project) {
        // Check access permissions
        const isOwner = result.project.owner_name === currentUser;
        const isHosted = data.projectType === 'hosted';
        
        if (data.projectType === 'local' && !isOwner) {
          // Local projects: only owner can access
          socket.emit(eventName, { 
            success: false, 
            message: `Access denied: You can only view your own local projects` 
          });
          return;
        }
        
        // Hosted projects: anyone can view
        // Local projects: owner can view/edit
        const serialized = project_handler.serializeProject(result.project);
        serialized.projectType = data.projectType;
        serialized.isOwner = isOwner; // Add flag to indicate if current user is owner
        serialized.canEdit = isOwner || isHosted; // Can edit if owner, or if hosted (for now, allow editing)
        
        console.log(`[Server] Sending project: name="${serialized.name}", owner="${serialized.owner_name}", currentUser="${currentUser}", isOwner=${isOwner}`);
        socket.emit(eventName, { 
          success: true, 
          project: serialized, 
          message: result.message 
        });
      } else {
        socket.emit(eventName, { success: false, message: result.message });
      }
    } catch (error: any) {
      console.error("Error in loadProject handler:", error);
      const eventName = data.eventName || "projectLoaded";
      socket.emit(eventName, { success: false, message: `Error: ${error.message}` });
    }
  });

  /**
   * List all projects of a type
   * For 'local': returns only current user's projects
   * For 'hosted': returns ALL hosted projects (anyone can view)
   * Expected payload: { projectType: 'local' | 'hosted' }
   */
  socket.on("listProjects", (data: { projectType: 'local' | 'hosted', requestId?: string }) => {
    try {
      const currentUser = userSessions.get(socket.id);
      
      if (data.projectType === 'hosted') {
        // For hosted projects, show ALL projects (public sharing)
        // Each project includes owner_name so users know who owns it
        const result = project_handler.listProjects('hosted');
        console.log(`[Server] Listing hosted projects for user: ${currentUser || 'anonymous'}`);
        socket.emit(`projectsListed_${data.projectType}`, result);
      } else {
        // For local projects, show only current user's projects
        const result = project_handler.listProjects('local');
        // Filter by owner if user is identified
        if (currentUser && result.success && result.projects) {
          result.projects = result.projects.filter((p: any) => p.owner_name === currentUser);
        }
        socket.emit(`projectsListed_${data.projectType}`, result);
      }
    } catch (error: any) {
      console.error("Error in listProjects handler:", error);
      socket.emit(`projectsListed_${data.projectType}`, { 
        success: false, 
        projects: [], 
        message: `Error: ${error.message}` 
      });
    }
  });

  /**
   * Upload a file (image or video) for a project
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted', fileName: string, fileData: string (base64), fileType: 'image' | 'video' }
   */
  socket.on("uploadFile", async (data: { projectName: string; projectType: 'local' | 'hosted'; fileName: string; fileData: string; fileType: 'image' | 'video'; eventName?: string }) => {
    try {
      const assetsDir = project_handler.getProjectAssetsDirectory(data.projectName, data.projectType);
      
      // Generate a unique filename to avoid conflicts
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const fileExtension = data.fileType === 'image' 
        ? (data.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)?.[1] || 'png')
        : (data.fileName.match(/\.(mp4|webm|ogg)$/i)?.[1] || 'mp4');
      
      const safeFileName = project_handler.sanitizeFilename(data.fileName.replace(/\.[^/.]+$/, '')) || 'file';
      const uniqueFileName = `${safeFileName}_${timestamp}_${randomStr}.${fileExtension}`;
      const filePath = path.join(assetsDir, uniqueFileName);
      
      // Convert base64 to buffer and save
      const base64Data = data.fileData.replace(/^data:.*,/, ''); // Remove data URL prefix
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      
      // Return relative path from project directory
      const projectDir = project_handler.getProjectDirectory(data.projectType);
      const relativePath = path.relative(projectDir, filePath).replace(/\\/g, '/'); // Use forward slashes for web
      
      const eventName = data.eventName || `fileUploaded_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      socket.emit(eventName, {
        success: true,
        filePath: relativePath,
        fileName: uniqueFileName,
        message: `File uploaded successfully`
      });
    } catch (error: any) {
      console.error("Error uploading file:", error);
      socket.emit("fileUploaded", {
        success: false,
        message: `Failed to upload file: ${error.message}`
      });
    }
  });

  /**
   * Delete a file (image or video) for a project
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted', filePath: string (relative path) }
   */
  socket.on("deleteFile", async (data: { projectName: string; projectType: 'local' | 'hosted'; filePath: string; eventName?: string }) => {
    try {
      console.log(`[Server] deleteFile called: projectName="${data.projectName}", projectType="${data.projectType}", filePath="${data.filePath}"`);
      
      const projectDir = project_handler.getProjectDirectory(data.projectType);
      console.log(`[Server] Project directory: ${projectDir}`);
      
      const fullFilePath = path.join(projectDir, data.filePath);
      console.log(`[Server] Full file path: ${fullFilePath}`);
      
      // Security check: ensure the file is within the project directory
      const normalizedFilePath = path.normalize(fullFilePath);
      const normalizedProjectDir = path.normalize(projectDir);
      console.log(`[Server] Normalized file path: ${normalizedFilePath}`);
      console.log(`[Server] Normalized project dir: ${normalizedProjectDir}`);
      
      if (!normalizedFilePath.startsWith(normalizedProjectDir)) {
        console.error(`[Server] ✗ Security check failed: file path outside project directory`);
        throw new Error('Invalid file path: outside project directory');
      }
      
      // Check if file exists
      if (fs.existsSync(normalizedFilePath)) {
        console.log(`[Server] ✓ File exists, deleting...`);
        fs.unlinkSync(normalizedFilePath);
        console.log(`[Server] ✓ Successfully deleted file: ${normalizedFilePath}`);
        
        const eventName = data.eventName || `fileDeleted_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        socket.emit(eventName, {
          success: true,
          message: `File deleted successfully`
        });
      } else {
        console.warn(`[Server] ⚠ File not found: ${normalizedFilePath}`);
        const eventName = data.eventName || `fileDeleted_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        socket.emit(eventName, {
          success: false,
          message: `File not found: ${data.filePath}`
        });
      }
    } catch (error: any) {
      console.error(`[Server] ✗ Error deleting file:`, error);
      const eventName = data.eventName || `fileDeleted_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      socket.emit(eventName, {
        success: false,
        message: `Failed to delete file: ${error.message}`
      });
    }
  });

  /**
   * Delete a project
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted' }
   */
  socket.on("deleteProject", (data: { projectName: string; projectType: 'local' | 'hosted' }) => {
    try {
      console.log("🗑️ Deleting project:", data.projectName, "Type:", data.projectType);
      const result = project_handler.deleteProject(data.projectName, data.projectType);
      
      // Send confirmation to the user who deleted
      socket.emit("projectDeleted", result);
      
      // For hosted projects, broadcast the deletion to all connected clients
      if (data.projectType === 'hosted' && result.success) {
        console.log(`[Server] Broadcasting hosted project deletion: ${data.projectName}`);
        io.emit("hostedProjectDeleted", { 
          projectName: data.projectName,
          projectType: 'hosted'
        });
      }
    } catch (error: any) {
      console.error("Error in deleteProject handler:", error);
      socket.emit("projectDeleted", { success: false, message: `Error: ${error.message}` });
    }
  });

  socket.on("disconnect", () => {
    const username = userSessions.get(socket.id);
    if (username) {
      console.log(`[Server] User disconnected: ${username} (socket: ${socket.id})`);
      userSessions.delete(socket.id);
    } else {
      console.log("❌ User disconnected:", socket.id);
    }
  });
});


server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`🚀 Server running on http://${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`📡 Listening on all interfaces (0.0.0.0) - ready for external connections`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`\n📋 Port Forwarding Instructions:`);
  console.log(`   1. Forward external port ${SERVER_PORT} to ${SERVER_PORT} on this machine`);
  console.log(`   2. Use your public IP address for external connections`);
  console.log(`   3. Update client config to point to your public IP:PORT`);
});


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// === Additional Paths ===

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
// Frontend URL is now in config.ts
// Allow dynamic updates via API
app.post("/set-redirect-url", express.json(), (req, res) => {
  // Note: This would require making FRONTEND_URL mutable or using a different approach
  console.log("Frontend URL update requested (using config value):", FRONTEND_URL);
  res.json({ success: true, currentUrl: FRONTEND_URL });
});

// === Generate auth URL ===
app.get("/auth", (req:any, res:any) => {
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

// interface TokenStore 
// {  //used to avoid TS from throwing a fit
//   [email: string]: any; // or a more specific type for tokens
// }
export interface TokenStore {
  nextId: number;

  // Normal entries object
  entries: {
    [email: string]: {id: number; [key: string]: any};
  };

  // Additional dynamic keys at top level
  [email: string]: any;
}

// === Handle OAuth callback ===
app.get("/oauth2callback", async (req:any, res:any) => {
  const code = req.query.code;

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // === Get user info ===
    const oauth2 = google.oauth2({ version: "v2", auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();

    // === Read existing tokens ===
    let tokenStore:TokenStore = { nextId: 0, entries: {} };

    if (fs.existsSync(TOKEN_PATH)) {
      tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    }

    // === Save credentials for this user ===
    const email = userInfo.data.email;
    
    if (!email)   //ye hamza iqbal ko kisi din mei poochon ga
    {
        throw new Error("User email is missing");
    }
    tokenStore.entries[email] = {id:tokenStore.nextId++, ...tokens };

    // === Write back to file ===

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenStore, null, 2));
      return res.redirect(`${FRONTEND_URL}/settings?oauth=success&&id=${tokenStore.entries[email].id}`);
  } catch (err) {
    console.error("Error during OAuth callback:", err);
    res.status(500).send("Error retrieving access token");
  }
});
function loadTokenStore(): TokenStore {
  if (!fs.existsSync(TOKEN_PATH)) return { nextId: 0, entries: {} };
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
}

app.get("/gmail/user-info", (req, res) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: "Missing id" });

  const tokenStore = loadTokenStore();

  if (!tokenStore.entries)
    return res.status(404).json({ error: "No tokens found" });

  // Find email that matches the ID
  const email = Object.keys(tokenStore.entries).find(
    (key) => tokenStore.entries?.[key]?.id === id
  );
  console.log("Lookup for id:", id, "found email:", email);
  if (!email)
    return res.status(404).json({ error: "User not found for given id" });

  return res.json({
    email,
    tokens: tokenStore.entries[email],
  });
});

// === Example protected route ===
app.get("/profile", async (req:any, res:any) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.send("No tokens found. Please /auth first.");
  }

  const tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  const emails = Object.keys(tokenStore);
  res.json({ savedUsers: emails });
});

// Server is already listening via server.listen() above
// This duplicate was removed

import { calendar_v3 } from "googleapis"; //needed because typescript hates me
import { fileURLToPath } from "url";
app.get("/test", async (req:any, res:any) => {
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

    const upcoming: calendar_v3.Schema$Event[] = events.data.items || [];
    if (upcoming.length === 0) {
      res.send(`✅ Successfully reused tokens for ${testEmail}, but no upcoming events found.`);
    } else {
      res.send({
        message: `✅ Successfully reused tokens for ${testEmail}`,
        events: upcoming.map(e => e.summary || "No Title"),
      });
    }
  } catch (error:any) {
    console.error("Error reusing tokens:", error);
    res.status(500).send("❌ Failed to reuse tokens. Check console for details.");
  }
});


// //notification service
// const current_local_projects: any[] = listProjects("local")?.projects ?? [];
// const current_hosted_projects: any[] = listProjects("hosted")?.projects ?? [];

