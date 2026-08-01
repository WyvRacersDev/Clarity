import cron from "node-cron";
import type { Server } from "socket.io";
import type { Chat_Agent } from "./agent.service.js";
import type { NotificationCenterService } from "./notification-center.service.js";
import { sendAppEmail } from "./email.service.js";
import {
  getDueTasks,
  markTaskNotified,
  getProblemTasksForUser,
  getAllProblemTasks,
} from "../repositories/notification.repository.js";

/** Optional durable-inbox sink (N2). When present, the cron ALSO records
 *  `due_soon` / `ai_suggestion` notifications alongside its email / live push. */
interface InboxSink {
  io: Server;
  notifications: NotificationCenterService;
}

async function sendEmail(userEmail: string, projectName: string, taskName: string) {
  console.log(`Sending email to ${userEmail} about task "${taskName}" in project "${projectName}"`);
  await sendAppEmail(
    userEmail,
    "Task Due Soon",
    `<p>You have a task "${taskName}" due in project "${projectName}" in 24 hours.</p>`
  );
}

export async function checkUpcomingTasks(inbox?: InboxSink): Promise<void> {
    // All tasks due within the next 24h, not done, not yet notified.
    const dueTasks = await getDueTasks();

    for (const task of dueTasks) {
        console.log("Task due soon:", task.taskname);

        // Mark notified directly — no full-project rewrite. Also naturally dedupes
        // the durable N2 entry: a task yields at most one `due_soon` notification.
        await markTaskNotified(task.id);

        if (task.owner_username && task.owner_username !== "Demo User") {
            try {
                await sendEmail(task.owner_email, task.project_name, task.taskname);
            } catch (err) {
                console.error(`[NotificationService] Failed to email ${task.owner_email}:`, err);
            }

            // N2: durable inbox entry (best-effort — never break the email loop).
            if (inbox) {
                try {
                    await inbox.notifications.notify(inbox.io, {
                        recipient: task.owner_username,
                        type: "due_soon",
                        projectName: task.project_name,
                        title: "Task due soon",
                        body: `"${task.taskname}" is due within 24 hours in "${task.project_name}".`,
                    });
                } catch (err) {
                    console.error(`[NotificationService] Failed to record due_soon for ${task.owner_username}:`, err);
                }
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

  const rows = await getProblemTasksForUser(username, MAX_SUGGESTION_TASKS);

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
  agent: Chat_Agent,
  inbox?: InboxSink
): Promise<void> {
  // One pass: not-done tasks that are either overdue or have no due date.
  const rows = await getAllProblemTasks();

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

    // N2: durable inbox entry. Gated by the same dedupe as the live push above,
    // so an unchanged suggestion set won't re-notify.
    if (inbox) {
      try {
        await inbox.notifications.notify(io, {
          recipient: username,
          type: "ai_suggestion",
          title: "New scheduling suggestion",
          body: payload.text,
          link: "/dashboard/ai-insights",
        });
      } catch (err) {
        console.error(`[NotificationService] Failed to record ai_suggestion for ${username}:`, err);
      }
    }
  }
}

/**
 * Start the cron. `deps` is optional so existing callers that pass nothing keep
 * working (task-due emails only). When `io` + `agent` are supplied, each run
 * ALSO computes and pushes proactive scheduling suggestions (C2).
 */
export function startNotificationService(deps?: {
    io: Server;
    agent: Chat_Agent;
    notifications?: NotificationCenterService;
}): void {
    // Build the optional durable-inbox sink once (N2) when both io + service exist.
    const inbox: InboxSink | undefined =
        deps?.notifications ? { io: deps.io, notifications: deps.notifications } : undefined;

    cron.schedule("*/15 * * * *", () => {
        checkUpcomingTasks(inbox).catch(e => console.error('[NotificationService] Error in checkUpcomingTasks:', e));
        if (deps) {
            computeProactiveSuggestions(deps.io, deps.agent, inbox)
                .catch(e => console.error('[NotificationService] Error in computeProactiveSuggestions:', e));
        }
    });
}
// runs every 15 minutes