import cron from "node-cron";
import { sql } from "../infrastructure/db.js";
import fs from "fs";
import { google } from "googleapis";
import type { Server } from "socket.io";
import type { Chat_Agent } from "./agent.service.js";



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
// ============================================================================
// C2 — Proactive scheduling suggestions
// ============================================================================
//
// Alongside the task-due emails, the cron computes a short suggested ordering
// for each user's problematic tasks (overdue, or missing a due date) and pushes
// it over Socket.IO as `ai:suggestion` so it surfaces in AI Insights without
// the user asking. Kept cheap and non-spammy: capped per user, and de-duped so
// we don't re-emit an identical suggestion set on every run.

/** Per-user room name used for targeted `ai:suggestion` delivery. */
export function userRoom(username: string): string {
  return `user:${username}`;
}

/** How many problem tasks we surface per user (keeps prompts + UI bounded). */
const MAX_SUGGESTION_TASKS = 6;

/** Last emitted suggestion signature per user — suppresses duplicate pushes. */
const lastSuggestionSig = new Map<string, string>();

type ProblemTask = {
  taskname: string;
  priority: number;
  project_name: string;
  owner_username: string;
  due: string | null;
  kind: "overdue" | "no_due_date";
};

/**
 * Deterministic priority/deadline heuristic used when no valid Gemini key is
 * configured (or the LLM call fails). Orders overdue-by-earliest-deadline and
 * highest-priority first, then flags tasks missing a due date.
 */
function heuristicSchedule(tasks: ProblemTask[]): string {
  const withDue = tasks
    .filter((t) => t.kind === "overdue" && t.due)
    .sort((a, b) => {
      const byDate = new Date(a.due!).getTime() - new Date(b.due!).getTime();
      if (byDate !== 0) return byDate;
      return a.priority - b.priority; // lower number = higher priority
    });
  const noDue = tasks.filter((t) => t.kind === "no_due_date");

  const lines: string[] = [];
  if (withDue.length > 0) {
    lines.push("Tackle overdue tasks in this order (earliest deadline first):");
    withDue.forEach((t, i) => {
      lines.push(`${i + 1}. "${t.taskname}" (${t.project_name})`);
    });
  }
  if (noDue.length > 0) {
    const names = noDue.map((t) => `"${t.taskname}"`).join(", ");
    lines.push(`Set a due date for: ${names}.`);
  }
  return lines.join("\n");
}

/**
 * Compute proactive suggestions for ONE user, on demand (used by the GET
 * `/ai-assistant/suggestions` fallback so the UI can pull without waiting for
 * the cron). Returns null when the user has no overdue/undated tasks.
 * Does NOT touch the dedupe cache — pulls are always allowed to return current
 * state.
 */
export async function computeSuggestionsForUser(
  agent: Chat_Agent,
  username: string
): Promise<{
  type: "proactive_schedule";
  text: string;
  taskCount: number;
  overdueCount: number;
  missingDueCount: number;
  generatedAt: string;
} | null> {
  if (!username || username === "Demo User") return null;

  const rows = await sql<Array<{
    taskname: string;
    priority: number;
    project_name: string;
    due: string | null;
  }>>`
    select t.taskname, t.priority, p.name as project_name, t.time as due
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    join users u           on u.id  = p.owner_id
    where t.is_done = false
      and (t.time is null or t.time < now())
      and u.username = ${username}
    order by t.time asc nulls last, t.priority asc
    limit ${MAX_SUGGESTION_TASKS}
  `;

  const tasks: ProblemTask[] = rows.map((r) => ({
    ...r,
    owner_username: username,
    kind: (r.due ? "overdue" : "no_due_date") as ProblemTask["kind"],
  }));
  if (tasks.length === 0) return null;

  let text = "";
  if (agent.hasValidKey()) {
    text = await agent.suggest_task_ordering(
      tasks.map((t) => ({ taskname: t.taskname, priority: t.priority, due: t.due }))
    );
  }
  if (!text) text = heuristicSchedule(tasks);
  if (!text) return null;

  return {
    type: "proactive_schedule",
    text,
    taskCount: tasks.length,
    overdueCount: tasks.filter((t) => t.kind === "overdue").length,
    missingDueCount: tasks.filter((t) => t.kind === "no_due_date").length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compute + deliver proactive suggestions to each affected user.
 *
 * @param io     Socket.IO server used to emit `ai:suggestion` to `user:<name>`.
 * @param agent  Chat_Agent; used for an LLM-authored ordering when a real key
 *               exists, otherwise we fall back to `heuristicSchedule`.
 */
export async function computeProactiveSuggestions(
  io: Server,
  agent: Chat_Agent
): Promise<void> {
  // One pass: not-done tasks that are either overdue or have no due date.
  const rows = await sql<Array<{
    taskname: string;
    priority: number;
    project_name: string;
    owner_username: string;
    due: string | null;
  }>>`
    select t.taskname,
           t.priority,
           p.name     as project_name,
           u.username as owner_username,
           t.time     as due
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    join users u           on u.id  = p.owner_id
    where t.is_done = false
      and (t.time is null or t.time < now())
    order by u.username, t.time asc nulls last, t.priority asc
  `;

  // Group problem tasks by owner (skip the anonymous demo owner).
  const byUser = new Map<string, ProblemTask[]>();
  for (const r of rows) {
    if (!r.owner_username || r.owner_username === "Demo User") continue;
    const kind: ProblemTask["kind"] = r.due ? "overdue" : "no_due_date";
    const list = byUser.get(r.owner_username) ?? [];
    if (list.length < MAX_SUGGESTION_TASKS) {
      list.push({ ...r, kind });
    }
    byUser.set(r.owner_username, list);
  }

  for (const [username, tasks] of byUser) {
    if (tasks.length === 0) continue;

    // Dedupe: skip if the exact same problem-set was pushed last run.
    const sig = tasks
      .map((t) => `${t.taskname}|${t.kind}|${t.due ?? ""}`)
      .join("~~");
    if (lastSuggestionSig.get(username) === sig) continue;

    // Prefer an LLM ordering when a real key exists; else heuristic.
    let text = "";
    if (agent.hasValidKey()) {
      text = await agent.suggest_task_ordering(
        tasks.map((t) => ({ taskname: t.taskname, priority: t.priority, due: t.due }))
      );
    }
    if (!text) text = heuristicSchedule(tasks);
    if (!text) continue;

    lastSuggestionSig.set(username, sig);

    const payload = {
      type: "proactive_schedule" as const,
      text,
      taskCount: tasks.length,
      overdueCount: tasks.filter((t) => t.kind === "overdue").length,
      missingDueCount: tasks.filter((t) => t.kind === "no_due_date").length,
      generatedAt: new Date().toISOString(),
    };

    console.log(`[NotificationService] Proactive suggestion -> ${username} (${tasks.length} tasks)`);
    io.to(userRoom(username)).emit("ai:suggestion", payload);
  }
}

/**
 * Start the cron. `deps` is optional so existing callers that pass nothing keep
 * working (task-due emails only). When `io` + `agent` are supplied, each run
 * ALSO computes and pushes proactive scheduling suggestions (C2).
 */
export function startNotificationService(deps?: { io: Server; agent: Chat_Agent }): void {
    cron.schedule("*/15 * * * *", () => {
        checkUpcomingTasks().catch(e => console.error('[NotificationService] Error in checkUpcomingTasks:', e));
        if (deps) {
            computeProactiveSuggestions(deps.io, deps.agent)
                .catch(e => console.error('[NotificationService] Error in computeProactiveSuggestions:', e));
        }
    });
}
// runs every 15 minutes