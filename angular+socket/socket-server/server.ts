// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
import express from "express";
import http from "http";
import { Server } from "socket.io";


// const fs = require("fs");
// const path = require("path");
// const { google } = require("googleapis");
import fs from "fs";
import path from "path";
import { google } from "googleapis";

import { Socket } from "socket.io";
import {objects_builder} from '../shared_models/dist/screen_elements.model.js'; // incredible location ngl 
import { Project, Grid } from '../shared_models/dist/project.model.js';
import cors from "cors";
import type { CorsOptions } from "cors";


const app = express();
const PORT = 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:4200", // Angular dev server
    methods: ["GET", "POST"]
  }
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

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECTS_BASE_PATH = path.join(__dirname, "projects");
const LOCAL_PROJECTS_PATH = path.join(PROJECTS_BASE_PATH, "local");
const HOSTED_PROJECTS_PATH = path.join(PROJECTS_BASE_PATH, "hosted");

// === Ensure project directories exist ===
if (!fs.existsSync(PROJECTS_BASE_PATH)) {
  fs.mkdirSync(PROJECTS_BASE_PATH, { recursive: true });
}
if (!fs.existsSync(LOCAL_PROJECTS_PATH)) {
  fs.mkdirSync(LOCAL_PROJECTS_PATH, { recursive: true });
}
if (!fs.existsSync(HOSTED_PROJECTS_PATH)) {
  fs.mkdirSync(HOSTED_PROJECTS_PATH, { recursive: true });
}

// === Project Management Utilities ===

/**
 * Sanitize filename to prevent directory traversal and invalid characters
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-z0-9_\- ]/gi, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100); // Limit length
}

/**
 * Get the project directory path based on type
 */
function getProjectDirectory(projectType: 'local' | 'hosted'): string {
  return projectType === 'local' ? LOCAL_PROJECTS_PATH : HOSTED_PROJECTS_PATH;
}

/**
 * Get the full file path for a project
 */
function getProjectFilePath(projectName: string, projectType: 'local' | 'hosted'): string {
  const dir = getProjectDirectory(projectType);
  const safeName = sanitizeFilename(projectName);
  return path.join(dir, `${safeName}.json`);
}

/**
 * Serialize a Project object to JSON
 */
function serializeProject(project: any): any {
  return {
    owner_id: project.owner_id,
    name: project.name,
    projectType: project.projectType || 'local',
    grid: project.grid.map((grid: any) => ({
      name: grid.name,
      Screen_elements: grid.Screen_elements.map((element: any) => {
        // Use toJSON if available, otherwise serialize manually
        if (element.toJSON) {
          return element.toJSON();
        }
        return {
          type: element.constructor?.name || 'Screen_Element',
          name: element.name,
          x_pos: element.x_pos,
          y_pos: element.y_pos,
          x_scale: element.x_scale,
          y_scale: element.y_scale,
          ...(element.Text_field !== undefined && { Text_field: element.Text_field }),
          ...(element.imageDescription !== undefined && { imageDescription: element.imageDescription }),
          ...(element.VideoDescription !== undefined && { VideoDescription: element.VideoDescription }),
          ...(element.scheduled_tasks !== undefined && { 
            scheduled_tasks: element.scheduled_tasks.map((t: any) => t.toJSON ? t.toJSON() : t)
          })
        };
      })
    }))
  };
}

/**
 * Deserialize JSON to a Project object
 */
function deserializeProject(data: any): Project {
  const project = new Project(data.name,data.owner_id);
  (project as any).projectType = data.projectType || 'local';
  
  if (data.grid && Array.isArray(data.grid)) {
    data.grid.forEach((gridData: any) => {
      const grid = new Grid(gridData.name);
      if (gridData.Screen_elements && Array.isArray(gridData.Screen_elements)) {
        gridData.Screen_elements.forEach((elementData: any) => {
          const element = objects_builder.rebuild(elementData);
          if (element) {
            grid.add_element(element as any);
          }
        });
      }
      project.grid.push(grid);
    });
  }
  
  return project;
}

/**
 * Save a project to file
 */
function saveProject(project: any, projectType: 'local' | 'hosted'): { success: boolean; message: string; path?: string } {
  try {
    const filePath = getProjectFilePath(project.name, projectType);
    const serialized = serializeProject(project);
    serialized.projectType = projectType; // Ensure type is set
    serialized.lastModified = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
    return { success: true, message: `Project "${project.name}" saved successfully`, path: filePath };
  } catch (error: any) {
    console.error('Error saving project:', error);
    return { success: false, message: `Failed to save project: ${error.message}` };
  }
}

/**
 * Load a project from file - SIMPLE: search by project name in JSON, not filename
 */
function loadProject(projectName: string, projectType: 'local' | 'hosted'): { success: boolean; project?: Project; message: string } {
  try {
    console.log(`[Server] loadProject called: projectName="${projectName}", projectType="${projectType}"`);
    const dir = getProjectDirectory(projectType);
    console.log(`[Server] Searching in directory: ${dir}`);
    
    if (!fs.existsSync(dir)) {
      return { success: false, message: `Directory does not exist: ${dir}` };
    }
    
    // Search through all files to find one with matching project name
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
    console.log(`[Server] Found ${files.length} files in ${projectType} directory:`, files);
    
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        console.log(`[Server] Checking file ${file}: JSON name="${data.name}", looking for="${projectName}"`);
        
        // Match by the actual project name in the JSON, not the filename
        if (data.name === projectName) {
          console.log(`[Server] ✓ MATCH! Found project "${projectName}" in file ${file}`);
          const project = deserializeProject(data);
          console.log(`[Server] Deserialized project name: "${project.name}"`);
          (project as any).projectType = projectType;
          (project as any).isLocal = projectType === 'local';
          console.log(`[Server] Returning project with name="${project.name}", type="${(project as any).projectType}"`);
          return { success: true, project, message: `Project "${projectName}" loaded from ${projectType} directory` };
        }
      } catch (error) {
        console.error(`[Server] Error reading file ${file}:`, error);
        continue;
      }
    }
    
    console.error(`[Server] ✗ Project "${projectName}" NOT FOUND in ${projectType} directory after checking ${files.length} files`);
    return { success: false, message: `Project "${projectName}" not found in ${projectType} directory` };
  } catch (error: any) {
    console.error(`Error loading ${projectType} project "${projectName}":`, error);
    return { success: false, message: `Failed to load project: ${error.message}` };
  }
}

/**
 * List all projects in a directory - SIMPLE: just read from the directory
 */
function listProjects(projectType: 'local' | 'hosted'): { success: boolean; projects: any[]; message: string } {
  try {
    const dir = getProjectDirectory(projectType);
    
    if (!fs.existsSync(dir)) {
      return { success: false, projects: [], message: `Directory does not exist: ${dir}` };
    }
    
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
    const projects = files.map(file => {
      try {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        const projectInfo = {
          name: data.name, // Use the actual project name from JSON, not the filename
          owner_id: data.owner_id,
          filename: file, // Store the actual filename so we can load it later
          projectType: projectType,
          gridCount: data.grid?.length || 0,
          lastModified: data.lastModified || fs.statSync(filePath).mtime.toISOString()
        };
        console.log(`[Server] Found ${projectType} project: "${projectInfo.name}" from file: ${file}`);
        return projectInfo;
      } catch (error) {
        console.error(`Error reading project file ${file}:`, error);
        return null;
      }
    }).filter((p): p is any => p !== null);
    
    console.log(`[Server] Returning ${projects.length} ${projectType} projects:`, projects.map(p => p.name));
    return { success: true, projects, message: `Found ${projects.length} ${projectType} projects` };
  } catch (error: any) {
    console.error(`Error listing ${projectType} projects:`, error);
    return { success: false, projects: [], message: `Failed to list projects: ${error.message}` };
  }
}

/**
 * Delete a project file
 */
function deleteProject(projectName: string, projectType: 'local' | 'hosted'): { success: boolean; message: string } {
  try {
    const filePath = getProjectFilePath(projectName, projectType);
    
    if (!fs.existsSync(filePath)) {
      return { success: false, message: `Project "${projectName}" not found` };
    }
    
    fs.unlinkSync(filePath);
    return { success: true, message: `Project "${projectName}" deleted successfully` };
  } catch (error: any) {
    console.error('Error deleting project:', error);
    return { success: false, message: `Failed to delete project: ${error.message}` };
  }
}

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
      const result = saveProject(data.project, data.projectType);
      
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
      const result = loadProject(data.projectName, data.projectType);
      
      // Use the provided event name if available, otherwise use default
      const eventName = data.eventName || "projectLoaded";
      
      if (result.success && result.project) {
        const serialized = serializeProject(result.project);
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
      const result = listProjects(data.projectType);
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
   * Delete a project
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted' }
   */
  socket.on("deleteProject", (data: { projectName: string; projectType: 'local' | 'hosted' }) => {
    try {
      console.log("🗑️ Deleting project:", data.projectName, "Type:", data.projectType);
      const result = deleteProject(data.projectName, data.projectType);
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
