// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { ProjectHandler } from "./utils/project_handler.ts";


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
import { checkUpcomingTasks } from "./utils/notification_service.ts";


const app = express();
const PORT = 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:4200", // Angular dev server
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100MB - maximum buffer size for file uploads
});
const allowedOrigins: RegExp[] = [
  /^http:\/\/localhost:\d+$/
];

// Dynamic CORS middleware in TypeScript
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, CURL, mobile apps)
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some(pattern => pattern.test(origin));

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked origin: ${origin}`));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));

 checkUpcomingTasks();

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

io.on("connection", (socket:Socket) => {
  console.log("✅ User connected:", socket.id);

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
      console.log("💾 Saving project:", data.project?.name, "Type:", data.projectType);
      const result = project_handler.saveProject(data.project, data.projectType);
      
      if (result.success) {
        socket.emit("projectSaved", { success: true, message: result.message, projectName: data.project.name });
      } else {
        socket.emit("projectSaved", { success: false, message: result.message });
      }
    } catch (error: any) {
      console.error("Error in saveProject handler:", error);
      socket.emit("projectSaved", { success: false, message: `Error: ${error.message}` });
    }
  });

  /**
   * Load a project
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted' }
   */
  socket.on("loadProject", (data: { projectName: string; projectType: 'local' | 'hosted', eventName?: string }) => {
    try {
      const result = project_handler.loadProject(data.projectName, data.projectType);
      
      // Use the provided event name if available, otherwise use default
      const eventName = data.eventName || "projectLoaded";
      
      if (result.success && result.project) {
        const serialized = project_handler.serializeProject(result.project);
        serialized.projectType = data.projectType; // Ensure type matches directory
        console.log(`[Server] Sending project over socket: name="${serialized.name}", type="${serialized.projectType}", event="${eventName}"`);
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
   * Expected payload: { projectType: 'local' | 'hosted' }
   */
  socket.on("listProjects", (data: { projectType: 'local' | 'hosted', requestId?: string }) => {
    try {
      const result = project_handler.listProjects(data.projectType);
      // Emit to a type-specific event to avoid mix-ups
      socket.emit(`projectsListed_${data.projectType}`, result);
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
      socket.emit("projectDeleted", result);
    } catch (error: any) {
      console.error("Error in deleteProject handler:", error);
      socket.emit("projectDeleted", { success: false, message: `Error: ${error.message}` });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});


server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
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
//=== Store frontend URL ===
let FRONTEND_URL = "http://localhost:4200"; //default
app.post("/set-redirect-url", express.json(), (req, res) => {
  FRONTEND_URL = req.body.frontendUrl;
  console.log("Frontend URL updated:", FRONTEND_URL);
  res.json({ success: true });
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

interface TokenStore 
{  //used to avoid TS from throwing a fit
  [email: string]: any; // or a more specific type for tokens
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
    let tokenStore:TokenStore = {};

    if (fs.existsSync(TOKEN_PATH)) {
      tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    }

    // === Save credentials for this user ===
    const email = userInfo.data.email;
    
    if (!email)   //ye hamza iqbal ko kisi din mei poochon ga
    {
        throw new Error("User email is missing");
    }
    tokenStore[email] = tokens;

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenStore, null, 2));
      return res.redirect(`${FRONTEND_URL}/settings?oauth=success`);
  } catch (err) {
    console.error("Error during OAuth callback:", err);
    res.status(500).send("Error retrieving access token");
  }
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

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

