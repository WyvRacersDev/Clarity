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
loadEnvFile("/home/thebestdev/Desktop/FAST/5sem/SDA/Project/Clarity-clean/angular+socket/socket-server/.env")

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

export function checkUpcomingTasks(): void {
    const projectHandler = new ProjectHandler();
    const local_projects = projectHandler.listProjects("local").projects;
    const hosted_projects = projectHandler.listProjects("hosted").projects;
    const all_projects = local_projects.concat(hosted_projects);
    for (let i: number = 0; i < all_projects.length; i++) {
        let result = projectHandler.loadProject(all_projects[i].name, "local");
        if (result && result.project) {
            const data = result.project;
            for (let grid of data.grid) {
                for (let element of grid.Screen_elements) {
                    if (element.scheduled_tasks && Array.isArray(element.scheduled_tasks)) {
                        for (const task of element.scheduled_tasks) {
                            const taskTime = new Date(task.time).getTime();
                            const now = Date.now();
                            const diff = taskTime - now;
                            const oneDay = 24 * 60 * 60 * 1000;
                            console.log(`Checking task: ${task.taskname}, due in ${diff / (60 * 1000)} minutes`);
                            if (diff > 0 && diff <= oneDay && task.is_done===false && task.notified===false) {
                                console.log("Task due soon:", task.taskname);
                                task.set_notified(true);
                                projectHandler.saveProject(data,data.project_type);
                                sendEmail(data.get_owner_name(), data.name, task.taskname);
                                // send email here
                            }
                        }
                    }
                }
            }

        }
    }

}
export function startNotificationService(): void {  
    //cron.schedule("*/1 * * * *", checkUpcomingTasks);
    checkUpcomingTasks();
}
// runs every hour