/**
 * Tool (function-calling) definitions for the Clarity Chat_Agent.
 *
 * These replace the old brittle regex/phrase intent-routing in agent.service.ts.
 * Each entry pairs a Gemini function-call declaration (name + zod-typed schema)
 * with a handler that calls the SAME underlying service methods the regex path
 * used, so the observable side effects are unchanged — only intent *detection*
 * moved from regex to model-driven tool selection with structured arguments.
 *
 * SDK note: consumed via LangChain's `ChatGoogleGenerativeAI.bindTools()`
 * (@langchain/google-genai). LangChain converts each `zod` schema into the
 * Gemini function-declaration JSON schema for us; the model then returns
 * `AIMessage.tool_calls[]` with parsed `args` matching the schema below.
 */
import { z } from "zod";
import type { ProjectHandler } from "./project.service.js";
import type { UserHandler } from "./user.service.js";

/**
 * Everything a tool handler may need to perform its side effect. Passed in from
 * Chat_Agent so this module owns no singletons and stays easy to test.
 *
 * - summarise / suggestSchedule delegate back to the agent's own LLM helpers
 *   (which already know how to format a project via their dedicated prompts).
 * - sendInvite delegates to the agent's send_invite (contact lookup + email).
 */
export interface AgentToolContext {
  projectHandler: ProjectHandler;
  userHandler: UserHandler;
  username: string;
  summariseProject: (projectName: string) => Promise<string>;
  suggestSchedule: (projectName: string) => Promise<string>;
  // E9: analyze a project for blocked/at-risk work (overdue, undated, stalled,
  // list-level dependencies) and return a concise natural-language breakdown.
  findBlocked: (projectName: string) => Promise<string>;
  // E9 (slice 2): extract action items from a chat conversation and create them
  // as tasks in a project. Returns a user-facing summary of what was created.
  threadToTasks: (args: { project_name: string; thread: string }) => Promise<string>;
  sendInvite: (invitee: string, projectName: string) => Promise<string>;
  // N5: create a task in a project from natural language. Args are the raw
  // structured tool arguments (priority as a word, due_date as ISO/plain date).
  createTask: (args: {
    project_name: string;
    task_name: string;
    priority?: string;
    due_date?: string;
    list_name?: string;
    repeat?: string;
  }) => Promise<string>;
}

/**
 * A tool = its Gemini function declaration (name/description/zod schema) plus a
 * handler that executes the intent and returns a user-facing string.
 */
export interface AgentTool {
  name: string;
  description: string;
  // zod schema describing the structured arguments the model must supply.
  schema: z.ZodObject<any>;
  handler: (args: any, ctx: AgentToolContext) => Promise<string>;
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "summarize_project",
    description:
      "Summarize a project: given a project name, produce a concise summary of " +
      "its description and tasks, including a timeline of task creation, " +
      "deadlines, and completion status. Use when the user asks to summarize, " +
      "recap, or give an overview of a specific project.",
    schema: z.object({
      project_name: z
        .string()
        .describe("The exact name of the project to summarize."),
    }),
    handler: async (args, ctx) => {
      const name = String(args?.project_name ?? "").trim();
      if (!name) return "Please specify a project name to summarize.";
      return await ctx.summariseProject(name);
    },
  },
  {
    name: "suggest_schedule",
    description:
      "Suggest a schedule/plan for completing a project on time: break the " +
      "project's tasks into manageable steps with estimated timeframes. Use " +
      "when the user asks to schedule, plan out, or get a suggested timeline " +
      "for finishing a specific project.",
    schema: z.object({
      project_name: z
        .string()
        .describe("The exact name of the project to suggest a schedule for."),
    }),
    handler: async (args, ctx) => {
      const name = String(args?.project_name ?? "").trim();
      if (!name) return "Please specify a project name to suggest a schedule for.";
      return await ctx.suggestSchedule(name);
    },
  },
  {
    name: "find_blocked",
    description:
      "Analyze a project for what is blocked, overdue, or at risk. Use when the " +
      "user asks what's blocked, what's stuck, what's overdue, what's slipping, " +
      "or what needs attention in a specific project. Surfaces overdue tasks, " +
      "tasks with no due date, stalled in-progress work, and lists blocked by " +
      "other lists.",
    schema: z.object({
      project_name: z
        .string()
        .describe("The exact name of the project to check for blockers."),
    }),
    handler: async (args, ctx) => {
      const name = String(args?.project_name ?? "").trim();
      if (!name) return "Please specify a project name to check for blockers.";
      return await ctx.findBlocked(name);
    },
  },
  {
    name: "thread_to_tasks",
    description:
      "Turn a chat conversation into tasks: read the provided conversation text, " +
      "extract the actionable to-do items discussed, and create them as tasks in a " +
      "project. Use when the user asks to turn a thread/chat/discussion into tasks " +
      "or action items. The 'thread' argument must contain the conversation text.",
    schema: z.object({
      project_name: z
        .string()
        .describe("The exact name of the project to add the extracted tasks to."),
      thread: z
        .string()
        .describe(
          "The chat conversation text to extract action items from, e.g. lines of " +
            "\"author: message\"."
        ),
    }),
    handler: async (args, ctx) => {
      const projectName = String(args?.project_name ?? "").trim();
      const thread = String(args?.thread ?? "").trim();
      if (!projectName) return "Please tell me which project to add the tasks to.";
      if (!thread) return "Please provide the conversation to turn into tasks.";
      return await ctx.threadToTasks({ project_name: projectName, thread });
    },
  },
  {
    name: "send_invite",
    description:
      "Send a project invitation email to one of the user's saved contacts. " +
      "Use when the user asks to invite, send an invite to, or add someone " +
      "(by their contact name) to a project.",
    schema: z.object({
      invitee: z
        .string()
        .describe(
          "The name of the contact to invite. Must match a saved contact name."
        ),
      project_name: z
        .string()
        .optional()
        .describe(
          "The project to invite the contact to. If the user did not name a " +
            "project, omit this."
        ),
    }),
    handler: async (args, ctx) => {
      const invitee = String(args?.invitee ?? "").trim().replace(/[.!?]+$/, "");
      if (!invitee) return "Please specify a contact name to send an invite to.";
      // Preserve the legacy default project label used by the old regex path.
      const projectName = String(args?.project_name ?? "").trim() || "all Project";
      return await ctx.sendInvite(invitee, projectName);
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in a project from a natural-language request. Use when " +
      "the user asks to add, create, or schedule a task/to-do/reminder (e.g. " +
      "\"add a task to review the deck Friday, high priority\"). Resolve any " +
      "relative date (today, tomorrow, Friday, next week) to a concrete calendar " +
      "date using today's date given in the system prompt, and pass it as " +
      "due_date in ISO YYYY-MM-DD form.",
    schema: z.object({
      project_name: z
        .string()
        .describe("The exact name of the project to add the task to."),
      task_name: z
        .string()
        .describe("The task's title/description, e.g. \"Review the pitch deck\"."),
      priority: z
        .enum(["high", "medium", "low"])
        .optional()
        .describe("Task priority. Omit if the user didn't say; defaults to medium."),
      due_date: z
        .string()
        .optional()
        .describe(
          "The due date as an ISO date (YYYY-MM-DD) or full ISO timestamp. " +
            "Resolve relative phrases to a concrete date first. Omit if none given."
        ),
      list_name: z
        .string()
        .optional()
        .describe(
          "Name of the to-do list within the project to add the task to. Omit " +
            "to use the project's first list (one is created if the project has none)."
        ),
      repeat: z
        .enum(["none", "daily", "weekly", "monthly"])
        .optional()
        .describe("Recurrence. Omit for a one-off task (default 'none')."),
    }),
    handler: async (args, ctx) => {
      const projectName = String(args?.project_name ?? "").trim();
      const taskName = String(args?.task_name ?? "").trim();
      if (!projectName) return "Please tell me which project to add the task to.";
      if (!taskName) return "Please tell me what the task should be.";
      return await ctx.createTask({
        project_name: projectName,
        task_name: taskName,
        priority: args?.priority,
        due_date: args?.due_date,
        list_name: args?.list_name,
        repeat: args?.repeat,
      });
    },
  },
];

/** Fast lookup by tool name when dispatching a returned tool call. */
export const AGENT_TOOLS_BY_NAME: Map<string, AgentTool> = new Map(
  AGENT_TOOLS.map((t) => [t.name, t])
);
