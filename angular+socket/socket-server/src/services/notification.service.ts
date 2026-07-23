import cron from "node-cron";
import { sql } from "../infrastructure/db.js";
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

loadEnvFile(path.resolve(__dirname, "../../.env")); //dynamic to bana lete bilal bro

//loadEnvFile("/home/thebestdev/Desktop/FAST/5sem/SDA/Project/Clarity-clean/angular+socket/socket-server/.env")

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.GOOGLE_APP_USER,
pass: env.GOOGLE_APP_PASSWORD  // app password (not your real password)
  }
});
async function sendEmail(userEmail: string,projectName: string, taskName: string) {
  console.log(`Sending email to ${userEmail} about task "${taskName}" in project "${projectName}"`);  
  await transporter.sendMail({
  from: `Clarity <${env.GOOGLE_APP_USER}>`,
  to: userEmail,
  subject: "Task Due Soon",
  html: `<p>You have a task "${taskName}" due in project "${projectName}" in 24 hours.</p>`
});
}

// function getOAuthClient() {
//   const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")).installed;

//   return new google.auth.OAuth2(
//     creds.client_id,
//     creds.client_secret,
//     creds.redirect_uris[0]
//   );
// }

// export function getAuthForUser(email: string) {
//   const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));

//   if (!tokens[email]) {
//     throw new Error("No OAuth token for " + email);
//   }

//   const client = getOAuthClient();
//   client.setCredentials(tokens[email]);

//   return client;
// }


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

export async function checkUpcomingTasks(): Promise<void> {
    // One SQL pass: all tasks due within the next 24h, not done, not yet notified.
    // Joins task -> element -> grid -> project -> owner so we can email the owner.
    const dueTasks = await sql<Array<{
        id: string;
        taskname: string;
        project_name: string;
        owner_username: string;
        owner_email: string;
    }>>`
        select t.id,
               t.taskname,
               p.name     as project_name,
               u.username as owner_username,
               u.email    as owner_email
        from tasks t
        join screen_elements se on se.id = t.element_id
        join grids g           on g.id  = se.grid_id
        join projects p        on p.id  = g.project_id
        join users u           on u.id  = p.owner_id
        where t.is_done = false
          and t.notified = false
          and t.time is not null
          and t.time > now()
          and t.time <= now() + interval '24 hours'
    `;

    for (const task of dueTasks) {
        console.log("Task due soon:", task.taskname);

        // Mark notified directly — no full-project rewrite.
        await sql`update tasks set notified = true where id = ${task.id}`;

        if (task.owner_username && task.owner_username !== "Demo User") {
            try {
                await sendEmail(task.owner_email, task.project_name, task.taskname);
            } catch (err) {
                console.error(`[NotificationService] Failed to email ${task.owner_email}:`, err);
            }
        }
    }
}
export function startNotificationService(): void {  
    cron.schedule("*/15 * * * *", () => { checkUpcomingTasks().catch(e => console.error('[NotificationService] Error in checkUpcomingTasks:', e)); });
   // checkUpcomingTasks();
}
// runs every 15 minutes