/**
 * E9 (slice 1) verification — project-aware AI context + summarize/find_blocked.
 *
 * Self-contained: builds an in-memory project with a mix of overdue / undated /
 * in-progress / done tasks, then:
 *   1. Asserts buildProjectContext() projects the right shape (counts, OVERDUE
 *      flag, "no due date", statuses) — deterministic, no LLM/DB needed.
 *   2. Asserts the tool registry exposes find_blocked.
 *   3. If a real GEMINI_API_KEY is set, runs the live summarise_project +
 *      find_blocked and checks the replies are grounded (non-empty, reference a
 *      real task / flag the overdue one).
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/verify-e9.ts
 */
import "../src/loadenv.js";
import { Project } from "@models/project.model.js";
import { ToDoLst, scheduled_task } from "@models/screen-elements.model.js";
import { buildProjectContext } from "../src/lib/project-context.js";
import { Chat_Agent } from "../src/services/agent.service.js";
import { AGENT_TOOLS_BY_NAME as TOOLS } from "../src/services/agent.tools.js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

function buildProject(): Project {
  const project = new Project("Website Redesign", "maya_x", "hosted");
  project.create_grid("Main");
  const grid = project.grid[0]!;

  const list = new ToDoLst("Launch", 0, 0);
  const overdue = new scheduled_task("Ship landing page", 1, iso(-3)); // high, 3 days late
  const undated = new scheduled_task("Write hero copy", 2, "");         // no due date
  const inProgress = new scheduled_task("QA pass", 2, iso(5));
  inProgress.set_status("in_progress");
  const done = new scheduled_task("Set up analytics", 3, iso(-1));
  done.toggle_done_status();

  list.add_task(overdue);
  list.add_task(undated);
  list.add_task(inProgress);
  list.add_task(done);
  grid.add_element(list);
  return project;
}

async function main(): Promise<void> {
  console.log("E9 verification — project-aware AI\n");

  const project = buildProject();

  // 1) Context assembly (pure, deterministic).
  console.log("Context assembly (buildProjectContext):");
  const ctx = buildProjectContext(project);
  console.log("\n--- context ---\n" + ctx + "\n---------------\n");
  check("names the project", ctx.includes("Website Redesign"));
  check("counts 4 total tasks", ctx.includes("4 total"));
  check("counts 1 done", ctx.includes("1 done"));
  check("counts 1 overdue", ctx.includes("1 overdue"));
  check("counts 1 with no due date", ctx.includes("1 with no due date"));
  check("flags the overdue task", ctx.includes("Ship landing page") && ctx.includes("(OVERDUE)"));
  check("marks the undated task", ctx.includes("Write hero copy") && ctx.includes("no due date"));
  check("shows in-progress status", ctx.includes("QA pass") && ctx.includes("status in progress"));
  check("shows done status", ctx.includes("Set up analytics") && ctx.includes("status done"));

  // 2) Tool registry.
  console.log("\nTool registry:");
  check("find_blocked tool registered", TOOLS.has("find_blocked"));
  check("thread_to_tasks tool registered", TOOLS.has("thread_to_tasks"));
  check("summarize_project tool still registered", TOOLS.has("summarize_project"));

  // 3) Live Gemini grounding (skipped without a valid key).
  console.log("\nLive AI actions:");
  const agent = new Chat_Agent(process.env.GEMINI_API_KEY ?? "");
  if (!agent.hasValidKey()) {
    console.log("  (skipped — no valid GEMINI_API_KEY configured)");
  } else {
    const summary = await agent.summarise_project(project);
    console.log("\n--- summary ---\n" + summary + "\n---------------\n");
    check("summary is non-empty", summary.trim().length > 20);
    check("summary references a real task", /landing page|hero copy|QA pass|analytics/i.test(summary));

    const blocked = await agent.find_blocked(project);
    console.log("\n--- find_blocked ---\n" + blocked + "\n--------------------\n");
    check("blocked reply is non-empty", blocked.trim().length > 20);
    check("blocked reply flags the overdue task", /ship landing page|overdue/i.test(blocked));

    // Slice 2 — thread → tasks (in-memory; no store needed).
    const thread = [
      "maya_x: The pricing page copy is still rough — someone needs to rewrite it before launch.",
      "leo_x: I'll take the SEO meta tags. Also we must fix the broken signup button, that's urgent.",
      "maya_x: Great. Let's also schedule a QA pass for Friday.",
      "leo_x: 👍 sounds good, thanks everyone!",
    ].join("\n");
    const countTasks = () =>
      project.grid[0]!.Screen_elements.flatMap((e: any) => e.scheduled_tasks ?? []).length;
    const beforeCount = countTasks();
    const t2t = await agent.thread_to_tasks(project, thread);
    console.log("\n--- thread_to_tasks ---\n" + t2t.message + "\n  created: " + JSON.stringify(t2t.created) + "\n-----------------------\n");
    check("thread_to_tasks created ≥ 2 tasks", t2t.created.length >= 2);
    check("thread_to_tasks ignored the non-actionable 'thanks' line", !t2t.created.some((n) => /thanks|sounds good/i.test(n)));
    const afterCtx = buildProjectContext(project);
    check("created tasks landed in the project", t2t.created.every((n) => afterCtx.includes(n)));
    check("project task count grew by the created amount", countTasks() === beforeCount + t2t.created.length);
  }

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-e9 failed:", err);
  process.exit(1);
});
