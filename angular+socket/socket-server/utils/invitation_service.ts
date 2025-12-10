import cron from "node-cron";
// import { Project, Grid } from "../../shared_models/dist/project.model.js";
// import fs from "fs";
// import path from "path";
//import { objects_builder } from '../../shared_models/dist/screen_elements.model.js'; // incredible location ngl 
//import { ProjectHandler } from "./project_handler.ts";
import fs from "fs";
import { google } from "googleapis";
import axios from "axios";
import {SHARED_SERVER,SERVER_PORT} from "../config.ts";

import nodemailer from "nodemailer";

import { env, loadEnvFile } from "process";

import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CREDENTIALS_PATH = path.resolve(__dirname, "../credentials.json");
const TOKENS_PATH = path.resolve(__dirname, "../tokens.json");
// console.log("DIRNAME:", __dirname);
// console.log("RESOLVED PATH:", path.resolve(__dirname, "../.env"));

loadEnvFile(path.resolve(__dirname, "../.env")); //dynamic to bana lete bilal bro

//loadEnvFile("/home/thebestdev/Desktop/FAST/5sem/SDA/Project/Clarity-clean/angular+socket/socket-server/.env")

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.GOOGLE_APP_USER,
    pass: env.GOOGLE_APP_PASSWORD  // app password (not your real password)
  }
});

function getOAuthClient() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));

  return new google.auth.OAuth2(
    creds.web.client_id,
    creds.web.client_secret,
    creds.web.redirect_uris[0]
  );
}

function getAuthForUser(email: string) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));

  if (!tokens.entries[email]) {
    throw new Error("No OAuth token for " + email);
  }

  const client = getOAuthClient();
  client.setCredentials(tokens.entries[email]);

  return client;
}


async function sendEmailWithGmailAuth(auth: any, to: string, subject: string, message: string) {
  const gmail = google.gmail({ version: "v1", auth });

  const email = [
    `To: ${to}`,
    "Subject: " + subject,
    "Content-Type: text/html; charset=UTF-8",
    "",
    message,
  ].join("\n");

  const encodedMessage = Buffer.from(email)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
    },
  });
}
// async function generatePublicLink(): Promise<string> {
//   try {
//     // Fetch public IP
//     const res = await axios.get("https://api.ipify.org?format=json");
//     const publicIP = res.data.ip;

//     // Build URL using port 3000
//     const link = `http://${publicIP}:3000`;

//     //console.log("Public IP:", publicIP);
//    // console.log("Your accessible link:", link);
//     return link;
//   } catch (error: Error | any) {
//     console.error("[invitation_service] Could not fetch public IP:", error.message);
//   }
//   return ""
// }

export async function invite(from: string, to: string, subject: string) {
  let message=`<p>You have been invited to join the project. Enter ${SHARED_SERVER}:${SERVER_PORT} to accept the invitation.</p>`;
  await sendEmailWithGmailAuth(getAuthForUser(from), to, subject, message);
}
