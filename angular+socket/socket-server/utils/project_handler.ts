import { Project, Grid } from "../../shared_models/dist/project.model.js";
import fs from "fs";
import path from "path";
import { objects_builder } from '../../shared_models/dist/screen_elements.model.js'; // incredible location ngl 
import { fileURLToPath } from "url";

type ProjectType = "local" | "hosted";
export class ProjectHandler {

    private __dirname: string;
    private PROJECTS_BASE_PATH: string;
    private LOCAL_PROJECTS_PATH: string;
    private HOSTED_PROJECTS_PATH: string;
    constructor() {
        const __filename = fileURLToPath(import.meta.url);
        this.__dirname = path.dirname(__filename);
        this.PROJECTS_BASE_PATH = path.join(this.__dirname, "../projects");
        this.LOCAL_PROJECTS_PATH = path.join(this.PROJECTS_BASE_PATH, "/local");
        this.HOSTED_PROJECTS_PATH = path.join(this.PROJECTS_BASE_PATH, "/hosted");

        // === Ensure project directories exist ===
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
    getProjectFilePath(projectName: string, project_type:ProjectType): string {
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
                name: grid.name,
                Screen_elements: grid.Screen_elements.map((element: any) => {
                    // Use toJSON if available, otherwise serialize manually
                    if (element.toJSON && typeof element.toJSON === 'function') {
                        const serialized = element.toJSON();
                        console.log(`[ProjectHandler] Element serialized via toJSON():`, serialized);
                        return serialized;
                    }
                    
                    // Detect element type by properties if type is missing or wrong
                    let elementType = element.type || element.constructor?.name || 'Screen_Element';
                    
                    // Fix type detection for plain objects
                    if (elementType === 'Object' || elementType === 'Screen_Element') {
                        if (element.imagepath !== undefined || element.imagePath !== undefined || element.ImageBase64 !== undefined) {
                            elementType = 'Image';
                            console.log(`[ProjectHandler] Detected Image element by properties`);
                        } else if (element.VideoPath !== undefined || element.videoPath !== undefined || element.videoBase64 !== undefined) {
                            elementType = 'Video';
                            console.log(`[ProjectHandler] Detected Video element by properties`);
                        } else if (element.Text_field !== undefined || element.text_field !== undefined) {
                            elementType = 'Text_document';
                        } else if (element.scheduled_tasks !== undefined && Array.isArray(element.scheduled_tasks)) {
                            elementType = 'ToDoLst';
                        }
                    }
                    
                    const serialized: any = {
                        type: elementType,
                        name: element.name,
                        x_pos: element.x_pos,
                        y_pos: element.y_pos,
                        x_scale: element.x_scale,
                        y_scale: element.y_scale
                    };
                    
                    // Add type-specific properties - check all possible property names
                    if (element.Text_field !== undefined || element.text_field !== undefined) {
                        serialized.Text_field = element.Text_field || element.text_field;
                    }
                    if (element.imagepath !== undefined || element.imagePath !== undefined) {
                        serialized.imagepath = element.imagepath || element.imagePath;
                        console.log(`[ProjectHandler] Added imagepath: ${serialized.imagepath}`);
                    }
                    if (element.VideoPath !== undefined || element.videoPath !== undefined) {
                        serialized.VideoPath = element.VideoPath || element.videoPath;
                        console.log(`[ProjectHandler] Added VideoPath: ${serialized.VideoPath}`);
                    }
                    if (element.scheduled_tasks !== undefined) {
                        serialized.scheduled_tasks = element.scheduled_tasks.map((t: any) => t.toJSON ? t.toJSON() : t);
                    }
                    
                    console.log(`[ProjectHandler] Element serialized manually:`, serialized);
                    return serialized;
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
    saveProject(project: any, projectType: 'local' | 'hosted'): { success: boolean; message: string; path?: string } {
      try {
        const filePath = this.getProjectFilePath(project.name, projectType);
        const serialized = this.serializeProject(project);
        serialized.project_type = projectType; // Ensure type is set
        serialized.lastModified = new Date().toISOString();
        
        fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
        return { success: true, message: `Project "${project.name}" saved successfully`, path: filePath };
      } catch (error: any) {
        console.error('Error saving project:', error);
        return { success: false, message: `Failed to save project: ${error.message}` };
      }
    }
    


    loadProject(projectName: string, projectType: 'local' | 'hosted'): { success: boolean; project?: Project; message: string } {
        try {
            console.log(`[Server] loadProject called: projectName="${projectName}", projectType="${projectType}"`);
            const dir = this.getProjectDirectory(projectType);
            console.log(`[Server] Searching in directory: ${dir}`);

            if (!fs.existsSync(dir)) {
                return { success: false, message: `Directory does not exist: ${dir}` };
            }

            // Search through all files to find one with matching project name
            const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
            console.log(`[Server] Found ${files.length} files in ${projectType} directory:`, files);

            for (const file of files) {
                try {
                    const filePath = path.join(dir, file);
                    const fileContent = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(fileContent);

                    console.log(`[Server] Checking file ${file}: JSON name="${data.name}", looking for="${projectName}"`);

                    // Match by the actual project name in the JSON, not the filename
                    if (data.name === projectName) {
                        console.log(`[Server] ✓ MATCH! Found project "${projectName}" in file ${file}`);
                        const project = this.deserializeProject(data);
                        console.log(`[Server] Deserialized project name: "${project.name}"`);
                        (project as any).project_type = projectType;
                        (project as any).isLocal = projectType === 'local';
                        console.log(`[Server] Returning project with name="${project.name}", type="${(project as any).projectType}"`);
                        return { success: true, project, message: `Project "${projectName}" loaded from ${projectType} directory` };
                    }
                } catch (error) {
                    console.error(`[Server] Error reading file ${file}:`, error);
                    continue;
                }
            }

            console.error(`[Server] ✗ Project "${projectName}" NOT FOUND in ${projectType} directory after checking ${files.length} files`);
            return { success: false, message: `Project "${projectName}" not found in ${projectType} directory` };
        } catch (error: any) {
            console.error(`Error loading ${projectType} project "${projectName}":`, error);
            return { success: false, message: `Failed to load project: ${error.message}` };
        }
    }




    listProjects(projectType: 'local' | 'hosted'): { success: boolean; projects: any[]; message: string } {
        try {
            const dir = this.getProjectDirectory(projectType);

            if (!fs.existsSync(dir)) {
                return { success: false, projects: [], message: `Directory does not exist: ${dir}` };
            }

            const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
            const projects = files.map(file => {
                try {
                    const filePath = path.join(dir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(content);

                    const projectInfo = {
                        name: data.name, // Use the actual project name from JSON, not the filename
                        owner_name: data.owner_name,
                        filename: file, // Store the actual filename so we can load it later
                        projectType: projectType,
                        gridCount: data.grid?.length || 0,
                        lastModified: data.lastModified || fs.statSync(filePath).mtime.toISOString()
                    };
                    console.log(`[Server] Found ${projectType} project: "${projectInfo.name}" from file: ${file}`);
                    return projectInfo;
                } catch (error) {
                    console.error(`Error reading project file ${file}:`, error);
                    return null;
                }
            }).filter((p): p is any => p !== null);

            console.log(`[Server] Returning ${projects.length} ${projectType} projects:`, projects.map(p => p.name));
            return { success: true, projects, message: `Found ${projects.length} ${projectType} projects` };
        } catch (error: any) {
            console.error(`Error listing ${projectType} projects:`, error);
            return { success: false, projects: [], message: `Failed to list projects: ${error.message}` };
        }
    }
    deleteProject(projectName: string, projectType: 'local' | 'hosted'): { success: boolean; message: string } {
      try {
        const filePath = this.getProjectFilePath(projectName, projectType);
        
        if (!fs.existsSync(filePath)) {
          return { success: false, message: `Project "${projectName}" not found` };
        }
        
        // Delete the project JSON file
        fs.unlinkSync(filePath);
        
        // Delete the project's assets directory if it exists
        const assetsDir = this.getProjectAssetsDirectory(projectName, projectType);
        if (fs.existsSync(assetsDir)) {
          try {
            // Recursively delete the entire assets directory
            fs.rmSync(assetsDir, { recursive: true, force: true });
            console.log(`[ProjectHandler] Deleted assets directory: ${assetsDir}`);
          } catch (assetsError: any) {
            console.error(`[ProjectHandler] Error deleting assets directory:`, assetsError);
            // Continue even if assets deletion fails - project JSON is already deleted
          }
        }
        
        return { success: true, message: `Project "${projectName}" and its assets deleted successfully` };
      } catch (error: any) {
        console.error('Error deleting project:', error);
        return { success: false, message: `Failed to delete project: ${error.message}` };
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