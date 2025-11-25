import cron from "node-cron";
// import { Project, Grid } from "../../shared_models/dist/project.model.js";
// import fs from "fs";
// import path from "path";
//import { objects_builder } from '../../shared_models/dist/screen_elements.model.js'; // incredible location ngl 
import { ProjectHandler } from "./project_handler.ts";

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

                            if (diff > 0 && diff <= oneDay && task.is_done===false && task.notified===false) {
                                console.log("Task due soon:", task.taskname);
                                task.set_notified(true);
                                projectHandler.saveProject(data, "local");

                                // send email here
                            }
                        }
                    }
                }
            }

        }
    }

}
    cron.schedule("*/15 * * * *", checkUpcomingTasks);
// runs every hour