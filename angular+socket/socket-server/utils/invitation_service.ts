import cron from "node-cron";
// import { Project, Grid } from "../../shared_models/dist/project.model.js";
// import fs from "fs";
// import path from "path";
//import { objects_builder } from '../../shared_models/dist/screen_elements.model.js'; // incredible location ngl 
import { ProjectHandler } from "./project_handler.ts";
import fs from "fs";
import { google } from "googleapis";



const CREDENTIALS_PATH = "../credentials.json";
const TOKENS_PATH = "../tokens.json";

import nodemailer from "nodemailer";

import { env, loadEnvFile } from "process";

import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
async function sendEmail(userEmail: string,projectName: string, taskName: string) {
    await transporter.sendMail({
  from: `Clarity <${env.GOOGLE_APP_USER}>`,
  to: userEmail,
  subject: "Task Due Soon",
  html: `<p>You have a task "${taskName}" due in project "${projectName}" in 24 hours.</p>`
});
}

function getOAuthClient() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")).installed;

  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris[0]
  );
}

export function getAuthForUser(email: string) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));

  if (!tokens[email]) {
    throw new Error("No OAuth token for " + email);
  }

  const client = getOAuthClient();
  client.setCredentials(tokens[email]);

  return client;
}


async function sendEmailWithGmailAuth(auth: any, to:string, subject:string, message:string) {
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
