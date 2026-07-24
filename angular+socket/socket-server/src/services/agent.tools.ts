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
  sendInvite: (invitee: string, projectName: string) => Promise<string>;
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
];

/** Fast lookup by tool name when dispatching a returned tool call. */
export const AGENT_TOOLS_BY_NAME: Map<string, AgentTool> = new Map(
  AGENT_TOOLS.map((t) => [t.name, t])
);
