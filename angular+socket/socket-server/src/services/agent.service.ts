import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ProjectHandler } from "./project.service.js";
import { UserHandler } from "./user.service.js";
import "dotenv/config";
import { Project } from "@models/project.model.js";
import { AI_agent } from "@models/ai-agent.model.js"
import { invite } from "./invitation.service.js";
import { User } from "@models/user.model.js";
import { text } from "stream/consumers";
import {
    AGENT_TOOLS,
    AGENT_TOOLS_BY_NAME,
    type AgentTool,
    type AgentToolContext,
} from "./agent.tools.js";
const projectHandler = new ProjectHandler();
const userHandler = new UserHandler();

/**
 * Placeholder / obviously-invalid API keys we should refuse to call Gemini with,
 * so a misconfigured .env degrades to a clear message instead of a raw 401/crash.
 */
function isPlaceholderApiKey(key: string | undefined | null): boolean {
    if (!key) return true;
    const k = key.trim();
    if (k.length < 10) return true;
    const lowered = k.toLowerCase();
    return (
        lowered.includes("your_") ||
        lowered.includes("placeholder") ||
        lowered.includes("changeme") ||
        lowered === "gemini_api_key" ||
        lowered === "undefined" ||
        lowered === "null"
    );
}
//let curr_user: User;

//first send an API call to set the user name
// export async function setUserName(email: string): Promise<boolean> {
//     console.log("[Chat_Agent] Setting user name to:", email);
//     let user = userHandler.loadUser(email);
//     curr_user = user.user!;
//     return user.success;
// }
export class Chat_Agent extends AI_agent {
    private model: ChatGoogleGenerativeAI;
    // Same model, but with the agent tools bound so Gemini can return structured
    // function calls (replaces the old regex intent-routing).
    private tool_model: ReturnType<ChatGoogleGenerativeAI["bindTools"]>;
    private summarise_prompt: ChatPromptTemplate;
    private suggest_schedule_prompt: ChatPromptTemplate;
    private default_prompt : ChatPromptTemplate;
    // True when GEMINI_API_KEY is missing/placeholder; makes chat() degrade
    // gracefully with a clear message rather than crashing on a live call.
    private readonly key_invalid: boolean;

    constructor(api_key: string) {
        super(api_key);
        this.key_invalid = isPlaceholderApiKey(api_key);
        if (this.key_invalid) {
            console.warn(
                "[Chat_Agent] GEMINI_API_KEY is missing or looks like a placeholder. " +
                "The AI assistant will return a configuration message instead of calling Gemini."
            );
        }
        this.model = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            apiKey: this.api_key,
        });
        // Pass plain tool-like objects ({ name, description, zod schema }) so
        // LangChain converts each zod schema into a Gemini function declaration.
        // NOTE: do NOT pre-wrap these in the OpenAI `{ type:"function", function }`
        // envelope — LangChain would then forward that shape (with the raw zod
        // schema) straight to Gemini, which rejects the `type`/`function` fields.
        this.tool_model = this.model.bindTools(
            AGENT_TOOLS.map((t) => ({
                name: t.name,
                description: t.description,
                schema: t.schema,
            }))
        );
        this.summarise_prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant that summarizes project details.Given the project name, description, and tasks, provide a concise summary. especially give a timeline of tasks showing how tasks are created, their deadlines, and their completion status as time passes"],
            ["human", "{input}"]
        ]);
        this.suggest_schedule_prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant that suggests project schedules.Given the project name, description, and tasks, provide a suggested schedule to complete the project on time. Break down the tasks into manageable steps with estimated timeframes."],
            ["human", "{input}"]
        ]);
        this.default_prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant for a productivity app called clarity.use the username given to address the user"],
            ["human", "{input}"]
        ]);
    }
    async summarise_project(project: Project): Promise<string> {

        const chain = RunnableSequence.from([this.summarise_prompt, this.model]);
        const response = await chain.invoke({ input: `here is the project: ${JSON.stringify(project)}` });

        // ---- FIX: Extract plain text from Gemini content blocks ----
        let textOutput = "";

        if (Array.isArray(response.content)) {
            textOutput = response.content
                .map(block => ("text" in block ? block.text : ""))
                .join("");
        } else if (typeof response.content === "string") {
            textOutput = response.content;
        } else {
            textOutput = "";
        }

        return textOutput;
    }

    async suggest_schedule(project: Project): Promise<string> {

        const chain = RunnableSequence.from([this.suggest_schedule_prompt, this.model]);
        const response = await chain.invoke({ input: `here is the project: ${JSON.stringify(project)}` });

        // ---- FIX: Extract plain text from Gemini content blocks ----
        let textOutput = "";

        if (Array.isArray(response.content)) {
            textOutput = response.content
                .map(block => ("text" in block ? block.text : ""))
                .join("");
        } else if (typeof response.content === "string") {
            textOutput = response.content;
        } else {
            textOutput = "";
        }

        return textOutput;
    }
    async send_invite(invitee: string, project_name: string, username: string): Promise<string> {
        let curr_user = (await userHandler.loadUser(username)).user!;
        console.log("[Chat_Agent] current user:", curr_user);
        if (curr_user === null) {
            console.error("[Chat_Agent] No current user set. Call setUserName() first.");
        }
        if (curr_user.contacts === undefined || curr_user.contacts.length === 0) {
            return `You have no contacts saved. Please add contacts before sending invites.`;
        }
        let contacts = curr_user.contacts;
        let contact_found = "";
        for (let contact of contacts) {
            console.log(`[Chat_Agent] checking contact: ${contact.name} with invitee: ${invitee}`);
            if (contact.name === invitee) {
                contact_found = contact.contact_detail;
                break;
            }
        }
        if (contact_found === "") {
            return `Contact "${invitee}" not found in your contacts.`;
        }
        await invite(curr_user.name, contact_found, `Invitation to join project ${project_name}`);
        return `Invite sent to ${contact_found} for project ${project_name}`;
    }


    // ----- Tool-backing helpers (shared by the regex-free tool handlers) -----
    // Load a project by name, trying local storage first then hosted, mirroring
    // the fallback the old regex path used before summarizing/scheduling.
    private async load_project_by_name(projectName: string): Promise<Project | null> {
        let curr_project = await projectHandler.loadProject(projectName, "local");
        if (!curr_project.success) {
            curr_project = await projectHandler.loadProject(projectName, "hosted");
        }
        return curr_project.success ? curr_project.project! : null;
    }

    // Named-project summary (used by the summarize_project tool). Same behavior
    // as the old regex branch: not-found -> friendly message.
    private async summarise_project_by_name(projectName: string): Promise<string> {
        const project = await this.load_project_by_name(projectName);
        if (!project) return `Project "${projectName}" not found.`;
        const summary = await this.summarise_project(project);
        console.log("summary:", summary);
        return summary;
    }

    // Named-project schedule suggestion (used by the suggest_schedule tool).
    private async suggest_schedule_by_name(projectName: string): Promise<string> {
        const project = await this.load_project_by_name(projectName);
        if (!project) return `Project "${projectName}" not found.`;
        return await this.suggest_schedule(project);
    }

    /**
     * Extract plain text from a LangChain AIMessage's `content`, which may be a
     * string or an array of Gemini content blocks.
     */
    private extract_text(content: unknown): string {
        if (Array.isArray(content)) {
            return content
                .map((block: any) => (block && typeof block === "object" && "text" in block ? block.text : ""))
                .join("");
        }
        if (typeof content === "string") return content;
        return "";
    }

    /**
     * Main entry point (signature UNCHANGED — called from ai.routes.ts via
     * `agent.chat(input, username)`).
     *
     * Flow:
     *   1. Guard against a missing/placeholder API key (graceful message).
     *   2. Send the user message + bound tool definitions to Gemini.
     *   3. If Gemini returns tool call(s), execute the matching handler(s) and
     *      return the handler result (natural-language / status string).
     *   4. If no tool call, return Gemini's plain text reply.
     *   5. On any failure, degrade to a plain (tool-free) answer, or a clear
     *      error message if that also fails.
     */
    async chat(user_input: string, username: string): Promise<string> {
        console.log("[Chat_Agent] Received user input:", user_input);

        if (this.key_invalid) {
            return "The AI assistant is not configured: a valid GEMINI_API_KEY is missing. " +
                "Please set GEMINI_API_KEY in the server environment.";
        }

        // Context handed to every tool handler; binds project/contact side
        // effects to THIS request's user without leaking singletons into tools.
        const toolCtx: AgentToolContext = {
            projectHandler,
            userHandler,
            username,
            summariseProject: (name) => this.summarise_project_by_name(name),
            suggestSchedule: (name) => this.suggest_schedule_by_name(name),
            sendInvite: (invitee, projectName) => this.send_invite(invitee, projectName, username),
        };

        const systemPrompt =
            "You are a helpful assistant for a productivity app called Clarity. " +
            `You are talking to the user named "${username}"; address them by name. ` +
            "When the user's request matches one of the available tools (summarizing a " +
            "project, suggesting a project schedule, or sending a project invite), call " +
            "that tool with the correct structured arguments. Otherwise, answer directly.";

        const messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [
            new SystemMessage(systemPrompt),
            new HumanMessage(user_input),
        ];

        try {
            const aiMsg = (await this.tool_model.invoke(messages)) as AIMessage;
            const toolCalls = aiMsg.tool_calls ?? [];

            // --- No tool call: return the model's plain text reply. ---
            if (toolCalls.length === 0) {
                const text = this.extract_text(aiMsg.content);
                return text || "I'm not sure how to help with that. Could you rephrase?";
            }

            // --- Tool call(s): execute each matching handler. ---
            const results: string[] = [];
            for (const call of toolCalls) {
                const tool: AgentTool | undefined = AGENT_TOOLS_BY_NAME.get(call.name);
                if (!tool) {
                    console.warn(`[Chat_Agent] Model requested unknown tool: ${call.name}`);
                    continue;
                }
                try {
                    // Validate/coerce args against the tool's zod schema; fall
                    // back to raw args if parsing fails so we still attempt it.
                    const parsed = tool.schema.safeParse(call.args ?? {});
                    const args = parsed.success ? parsed.data : (call.args ?? {});
                    const result = await tool.handler(args, toolCtx);
                    results.push(result);
                } catch (toolErr: any) {
                    console.error(`[Chat_Agent] Tool "${call.name}" failed:`, toolErr);
                    results.push(
                        `Sorry, I couldn't complete the "${call.name}" action. Please try again.`
                    );
                }
            }

            if (results.length > 0) return results.join("\n\n");

            // Model asked only for unknown tools — fall through to a plain reply.
            const text = this.extract_text(aiMsg.content);
            return text || "I'm not sure how to help with that. Could you rephrase?";
        } catch (err: any) {
            // Preserve HTTP status codes (429/400/401/...) so ai.routes.ts can
            // map them; rethrow those. For other errors, degrade to a plain,
            // tool-free answer rather than crashing the request.
            if (err && (err.status || err.code)) throw err;
            console.error("[Chat_Agent] Tool-calling flow failed, falling back to plain reply:", err);
            try {
                const chain = RunnableSequence.from([this.default_prompt, this.model]);
                const response = await chain.invoke({ input: `username is ${username}, ${user_input}` });
                const text = this.extract_text(response.content);
                return text || "Sorry, I ran into a problem. Please try again.";
            } catch (fallbackErr: any) {
                if (fallbackErr && (fallbackErr.status || fallbackErr.code)) throw fallbackErr;
                console.error("[Chat_Agent] Plain fallback also failed:", fallbackErr);
                return "Sorry, the AI assistant is temporarily unavailable. Please try again later.";
            }
        }
    }
}
//const agent = new Chat_Agent(process.env.GEMINI_API_KEY!);
//console.log(await agent.chat("suggest schedule for project Mobile App Development"));
//summarise_projects();
