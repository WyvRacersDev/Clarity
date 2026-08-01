import { Project, Grid } from "@models/project.model.js";
import fs from "fs";
import path from "path";
import { objects_builder } from '@models/screen-elements.model.js';
import { deleteCalendarEvent } from "./calendar.service.js";
import { UserHandler } from "./user.service.js";
import { CalendarSyncService } from "./calendar-sync.service.js";
import { fileURLToPath } from "url";
import * as projectRepo from "../repositories/project.repository.js";
import { maybeAutoSnapshot } from "../repositories/snapshot.repository.js";
import { clientError } from "../lib/clientError.js";
import { getAuthoritativeContent } from "../realtime/ydoc-registry.js";
import { preferLiveContent } from "../lib/ydoc-reconcile.js";

const user_handler = new UserHandler();
const calendarSync = new CalendarSyncService(user_handler);

type ProjectType = "local" | "hosted";

/**
 * The path/filename responsibility of ProjectHandler, as a narrow collaborator
 * interface. DiskStorageService depends on THIS (DIP) rather than the concrete
 * ProjectHandler, so it only sees the asset-path helpers it actually uses.
 */
export interface ProjectPaths {
    getProjectDirectory(projectType: ProjectType): string;
    getProjectAssetsDirectory(projectName: string, projectType: ProjectType): string;
    sanitizeFilename(name: string): string;
    get_base_path(): string;
}
export class ProjectHandler implements ProjectPaths {

    private __dirname: string;
    private PROJECTS_BASE_PATH: string;
    private LOCAL_PROJECTS_PATH: string;
    private HOSTED_PROJECTS_PATH: string;
    constructor() {
        const __filename = fileURLToPath(import.meta.url);
        this.__dirname = path.dirname(__filename);
        this.PROJECTS_BASE_PATH = path.join(this.__dirname, "../../projects");
        this.LOCAL_PROJECTS_PATH = path.join(this.PROJECTS_BASE_PATH, "/local");
        this.HOSTED_PROJECTS_PATH = path.join(this.PROJECTS_BASE_PATH, "/hosted");

        // === Ensure project asset directories exist (assets stay on disk) ===
        if (!fs.existsSync(this.PROJECTS_BASE_PATH)) {
            fs.mkdirSync(this.PROJECTS_BASE_PATH, { recursive: true });
        }
        if (!fs.existsSync(this.LOCAL_PROJECTS_PATH)) {
            fs.mkdirSync(this.LOCAL_PROJECTS_PATH, { recursive: true });
        }
        if (!fs.existsSync(this.HOSTED_PROJECTS_PATH)) {
            fs.mkdirSync(this.HOSTED_PROJECTS_PATH, { recursive: true });
        }
    }

    getProjectDirectory(projectType: 'local' | 'hosted'): string {
        return projectType === 'local' ? this.LOCAL_PROJECTS_PATH : this.HOSTED_PROJECTS_PATH;
    }
    sanitizeFilename(name: string): string {
        return name
            .replace(/[^a-z0-9_\- ]/gi, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100); // Limit length
    }
    getProjectFilePath(projectName: string, project_type: ProjectType): string {
        const dir = this.getProjectDirectory(project_type);
        const safeName = this.sanitizeFilename(projectName);
        return path.join(dir, `${safeName}.json`);
    }

    serializeProject(project: any): any {
        console.log(`[ProjectHandler] serializeProject called for project: ${project.name}`);
        return {
            owner_name: project.owner_name,
            name: project.name,
            projectType: project.project_type || 'local',
            grid: project.grid.map((grid: any) => ({
                // Include the stable grid id only when present (additive).
                ...(grid.id !== undefined ? { id: grid.id } : {}),
                name: grid.name,
                Screen_elements: grid.Screen_elements.map((element: any) => {
                    // Serialize canonically via the model. Live instances have
                    // toJSON(); plain (socket-received) objects are rebuilt into an
                    // instance first, so BOTH paths produce the complete per-type
                    // shape. This replaced a manual duck-typing block that dropped
                    // fields it didn't know about (e.g. ToDoLst.dependsOn).
                    if (element && typeof element.toJSON === 'function') {
                        return element.toJSON();
                    }
                    const rebuilt = objects_builder.rebuild(element);
                    return rebuilt && typeof (rebuilt as any).toJSON === 'function'
                        ? (rebuilt as any).toJSON()
                        : element;
                })
            }))
        };
    }

    /**
     * Deserialize JSON to a Project object
     */
    deserializeProject(data: any): Project {
        const project = new Project(data.name, data.owner_name, data.projectType || 'local');
        //        (project as any).project_type = data.projectType || 'local';

        if (data.grid && Array.isArray(data.grid)) {
            data.grid.forEach((gridData: any) => {
                const grid = new Grid(gridData.name);
                if (gridData.id !== undefined) grid.id = gridData.id; // restore stable grid id (additive)
                if (gridData.Screen_elements && Array.isArray(gridData.Screen_elements)) {
                    gridData.Screen_elements.forEach((elementData: any) => {
                        const element = objects_builder.rebuild(elementData);
                        if (element) {
                            grid.add_element(element as any);
                        }
                    });
                }
                project.grid.push(grid);
            });
        }

        return project;
    }
    async saveProject(project: any, projectType: 'local' | 'hosted'): Promise<{ success: boolean; message: string; path?: string }> {
        try {
            // Sync ToDoLst tasks to Google Calendar first (create/delete events,
            // stamping calendar_event_id onto the tasks so they persist below).
            // Owns the whole calendar concern; never throws.
            await calendarSync.syncTasks(project, projectType, (name, type) => this.loadProject(name, type));

            // Serialize via the shared serializer (keeps field-name casing correct),
            // then persist through the repository full-replace transaction.
            const serialized = this.serializeProject(project);
            serialized.projectType = projectType;
            // N8: the server Y.Doc is authoritative for any Text_document under a
            // live co-editing session, so reconcile this (possibly stale) snapshot
            // against the registry BEFORE persisting — no out-of-band whole-project
            // save can clobber newer collaborative rich-text edits (closes B3).
            await this.reconcileWithLiveDocs(serialized);
            await projectRepo.saveProject(serialized, projectType);
            // E8: capture this saved state as an (auto) version. Throttled +
            // de-duplicated inside the repo, and best-effort — never fails a save.
            await maybeAutoSnapshot(serialized, projectType);
            return { success: true, message: `Project "${project.name}" saved successfully` };
        } catch (error: any) {
            console.error('Error saving project:', error);
            return { success: false, message: clientError("save the project") };
        }
    }

    /**
     * N8 — replace each Text_document's snapshot content with the authoritative
     * server Y.Doc state whenever a live co-editing session is resident for it, so
     * an out-of-band whole-project save can't overwrite newer collaborative edits
     * with a stale snapshot (the B3 stale-snapshot limit). Operates on the already
     * -serialized (plain-object) project in place; only elements with a stable id
     * can have a resident doc, and the `preferLiveContent` guard ensures a transient
     * empty doc never wipes non-empty snapshot text.
     */
    private async reconcileWithLiveDocs(serialized: any): Promise<void> {
        const grids = Array.isArray(serialized.grid) ? serialized.grid : [];
        for (const grid of grids) {
            const elements = Array.isArray(grid.Screen_elements) ? grid.Screen_elements : [];
            for (const el of elements) {
                if (el?.type !== "Text_document") continue;
                if (typeof el.id !== "string" || el.id.length === 0) continue;
                const live = await getAuthoritativeContent(el.id);
                if (!live) continue;
                const preferred = preferLiveContent(el, live);
                if (preferred) {
                    el.Text_field = preferred.Text_field;
                    el.ydoc = preferred.ydoc;
                }
            }
        }
    }



    async loadProject(projectName: string, projectType: 'local' | 'hosted'): Promise<{ success: boolean; project?: Project; message: string }> {
        try {
            const data = await projectRepo.loadProject(projectName, projectType);
            if (!data) {
                return { success: false, message: `Project "${projectName}" not found in ${projectType} directory` };
            }
            const project = this.deserializeProject(data);
            (project as any).project_type = projectType;
            (project as any).isLocal = projectType === 'local';
            return { success: true, project, message: `Project "${projectName}" loaded from ${projectType} directory` };
        } catch (error: any) {
            console.error(`Error loading ${projectType} project "${projectName}":`, error);
            return { success: false, message: clientError("load the project") };
        }
    }




    async listProjects(projectType: 'local' | 'hosted'): Promise<{ success: boolean; projects: any[]; message: string }> {
        try {
            const projects = await projectRepo.listProjects(projectType);
            return { success: true, projects, message: `Found ${projects.length} ${projectType} projects` };
        } catch (error: any) {
            console.error(`Error listing ${projectType} projects:`, error);
            return { success: false, projects: [], message: clientError("list projects") };
        }
    }

    /**
     * N1: projects of a type the user can reach as owner OR collaborator, each
     * annotated with the user's effective role. Backs the local-project list so
     * shared-with-me projects appear alongside owned ones.
     */
    async listProjectsForUser(
        projectType: 'local' | 'hosted',
        username: string
    ): Promise<{ success: boolean; projects: any[]; message: string }> {
        try {
            const projects = await projectRepo.listProjectsForUser(projectType, username);
            return { success: true, projects, message: `Found ${projects.length} ${projectType} projects` };
        } catch (error: any) {
            console.error(`Error listing ${projectType} projects for ${username}:`, error);
            return { success: false, projects: [], message: clientError("list projects") };
        }
    }
    async deleteProject(projectName: string, projectType: 'local' | 'hosted'): Promise<{ success: boolean; message: string }> {
        try {
            // Remove calendar events for all tasks that have one (before deleting the rows).
            const project = await this.loadProject(projectName, projectType);
            if (project.project !== undefined) {
                for (let grid of project.project.grid) {
                    for (let element of grid.Screen_elements) {
                        if (element.scheduled_tasks && Array.isArray(element.scheduled_tasks)) {
                            for (const task of element.scheduled_tasks) {
                                if (task.calendar_event_id) {
                                    deleteCalendarEvent(
                                        project.project.owner_name,
                                        task.calendar_event_id
                                    ).then((result) => {
                                        if (result.success) {
                                            console.log(`[ProjectHandler] Deleted calendar event for task: "${task.taskname}"`);
                                        } else {
                                            console.warn(`[ProjectHandler] Failed to delete calendar event for task: "${task.taskname}": ${result.message}`);
                                        }
                                    }).catch((error) => {
                                        console.error(`[ProjectHandler] Error deleting calendar event for task: "${task.taskname}":`, error);
                                    });
                                }
                            }
                        }
                    }
                }
            }

            const removed = await projectRepo.deleteProject(projectName, projectType);
            if (!removed) {
                return { success: false, message: `Project "${projectName}" not found` };
            }

            // Delete the project's assets directory if it exists (assets stay on disk).
            const assetsDir = this.getProjectAssetsDirectory(projectName, projectType);
            if (fs.existsSync(assetsDir)) {
                try {
                    fs.rmSync(assetsDir, { recursive: true, force: true });
                    console.log(`[ProjectHandler] Deleted assets directory: ${assetsDir}`);
                } catch (assetsError: any) {
                    console.error(`[ProjectHandler] Error deleting assets directory:`, assetsError);
                }
            }

            return { success: true, message: `Project "${projectName}" and its assets deleted successfully` };
        } catch (error: any) {
            console.error('Error deleting project:', error);
            return { success: false, message: clientError("delete the project") };
        }
    }
    getProjectAssetsDirectory(projectName: string, projectType: 'local' | 'hosted'): string {
        const projectDir = this.getProjectDirectory(projectType);
        const safeProjectName = this.sanitizeFilename(projectName);
        const assetsDir = path.join(projectDir, `${safeProjectName}_assets`);

        // Ensure directory exists
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
        }

        return assetsDir;
    }
    get_base_path(): string {
        return this.PROJECTS_BASE_PATH;
    }
}
