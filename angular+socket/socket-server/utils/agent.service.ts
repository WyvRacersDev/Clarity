import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { ProjectHandler } from "./project_handler.ts";
import { UserHandler } from "./user_handler.ts";
import "dotenv/config";
import { Project } from "../../shared_models/dist/project.model.js";
import { AI_agent } from "../../shared_models/dist/ai_agent.model.js"
import { invite } from "./invitation_service.ts";
import { User } from "../../shared_models/dist/user.model.js";
const projectHandler = new ProjectHandler();
const userHandler = new UserHandler();
let curr_user: User;

//first send an API call to set the user name
export async function setUserName(email: string): Promise<boolean> {
    let user = userHandler.loadUser(email);
    curr_user = user.user!;
    return user.success;
}
class Chat_Agent extends AI_agent {
    private model: ChatGoogleGenerativeAI;
    private summarise_prompt: ChatPromptTemplate;
    private suggest_schedule_prompt: ChatPromptTemplate;
    constructor(api_key: string) {
        super(api_key);
        this.model = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            apiKey: this.api_key,
        });
        this.summarise_prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant that summarizes project details.Given the project name, description, and tasks, provide a concise summary. especially give a timeline of tasks showing how tasks are created, their deadlines, and their completion status as time passes"],
            ["human", "{input}"]
        ]);
        this.suggest_schedule_prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are a helpful assistant that suggests project schedules.Given the project name, description, and tasks, provide a suggested schedule to complete the project on time. Break down the tasks into manageable steps with estimated timeframes."],
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
    async send_invite(user_email: string, project_name: string): Promise<string> {
        if(curr_user===null){
        console.error("[Chat_Agent] No current user set. Call setUserName() first.");
        }
        let contacts= curr_user.get_contacts();
        let contact_found=false;
        for(let contact of contacts){
            if(contact.email===user_email){
                contact_found=true;
                break;
            }
        return `Invite sent to ${user_email} for project ${project_name}`;
    }

    async chat(user_input: string): Promise<string> {
        const summarise_match = user_input.match(/summarize project[:\s]+(.+)/i);

        if (summarise_match) {
            const projectName = summarise_match[1].trim();
            let curr_project = projectHandler.loadProject(projectName, "local");
            if (!curr_project.success) {
                curr_project = projectHandler.loadProject(projectName, "hosted");
            }
            if (curr_project.success) {
                let summary = await this.summarise_project(curr_project.project!);
                return summary;
            } else {
                return `Project "${projectName}" not found.`;
            }
        }
        const suggest_schedule_match = user_input.match(/suggest schedule for project[:\s]+(.+)/i);
        if (suggest_schedule_match) {
            const projectName = suggest_schedule_match[1].trim();
            let curr_project = projectHandler.loadProject(projectName, "local");
            if (!curr_project.success) {
                curr_project = projectHandler.loadProject(projectName, "hosted");
            }
            if (curr_project.success) {
                let schedule = await this.suggest_schedule(curr_project.project!);
                return schedule;
            } else {
                return `Project "${projectName}" not found.`;
            }
        }
        // ---- NEW: detect "send invite to {person}" ----
        const send_invite_match = user_input.match(/send (an )?invite to\s+(.+)/i);
        if (send_invite_match) {
            const personName = send_invite_match[2].trim();

            // clean up trailing punctuation
            const cleanedName = personName.replace(/[.!?]+$/, "");
            
            return `Extracted invite target: ${cleanedName}`;
        }

        return "No valid command found in the input.";
    }
}
const agent = new Chat_Agent(process.env.GEMINI_API_KEY!);
console.log(await agent.chat("suggest schedule for project Mobile App Development"));
//summarise_projects();
