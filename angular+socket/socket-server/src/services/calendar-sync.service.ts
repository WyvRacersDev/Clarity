/**
 * CalendarSyncService (SRP) — Google Calendar side-effects of saving a project.
 *
 * Behavior-preserving extraction of the ~100-line calendar block that used to sit
 * inside `ProjectHandler.saveProject`, mixing Calendar create/delete diffing with
 * persistence. `saveProject` now serializes + persists only; this owns the
 * calendar concern: create events for new timed ToDoLst tasks (stamping
 * `calendar_event_id` back onto the tasks in place so the caller persists them),
 * and delete events for tasks that disappeared since the previous save.
 *
 * The previous project is loaded lazily (only when the owner has calendar
 * integration enabled) via the injected `loadPrevious` — this both preserves the
 * original "don't touch the DB unless calendar is on" behavior and avoids a
 * circular dependency back onto ProjectHandler. Calendar failures are logged and
 * swallowed so a project save always proceeds.
 */
import type { Project } from "@models/project.model.js";
import type { UserHandler } from "./user.service.js";
import { createCalendarEvent, deleteCalendarEvent } from "./calendar.service.js";

type ProjectType = "local" | "hosted";

type LoadProject = (
  name: string,
  type: ProjectType
) => Promise<{ success: boolean; project?: Project; message: string }>;

export class CalendarSyncService {
  constructor(private readonly user_handler: UserHandler) {}

  async syncTasks(project: any, projectType: ProjectType, loadPrevious: LoadProject): Promise<void> {
    let old_task_ids: string[] = [];
    let new_Task_ids: string[] = [];

    // Get the username from the socket session
    const username = project?.owner_name;
    if (!(username && project)) return;

    // Check if user has calendar integration enabled and create calendar events
    // for new tasks. This reads the *previous* stored task ids (to diff/delete
    // stale calendar events) and writes new `calendar_event_id`s onto the incoming
    // object so they get persisted by the caller.
    try {
      // Load user to check calendar settings
      const userResult = await this.user_handler.loadUser(username);
      if (
        userResult.success &&
        userResult.user?.settings?.allow_google_calender &&
        userResult.user?.name !== "Demo User"
      ) {
        console.log(`[Server] 📅 Calendar integration enabled for ${username}, checking for new tasks...`);

        //load old version of project to compare tasks
        const existingProjectResult = await loadPrevious(project.name, projectType);
        if (existingProjectResult.success && existingProjectResult.project !== undefined) {
          for (let grid of existingProjectResult.project.grid) {
            if (grid.Screen_elements && Array.isArray(grid.Screen_elements)) {
              for (const element of grid.Screen_elements) {
                // Check if this is a ToDoLst
                if (element.type === "ToDoLst" || (element.scheduled_tasks && Array.isArray(element.scheduled_tasks))) {
                  const tasks = element.scheduled_tasks || [];
                  for (const task of tasks) {
                    // calendar_event_id is null until the task is synced to Calendar
                    if (task.calendar_event_id) old_task_ids.push(task.calendar_event_id);
                  }
                }
              }
            }
          }
        }

        // Find all tasks in the project
        let hasNewTasks = false;
        const projectData = project;

        if (projectData.grid && Array.isArray(projectData.grid)) {
          for (const grid of projectData.grid) {
            if (grid.Screen_elements && Array.isArray(grid.Screen_elements)) {
              for (const element of grid.Screen_elements) {
                // Check if this is a ToDoLst
                if (element.type === "ToDoLst" || (element.scheduled_tasks && Array.isArray(element.scheduled_tasks))) {
                  const tasks = element.scheduled_tasks || [];
                  for (const task of tasks) {
                    // Only create calendar events for tasks that don't have one yet
                    // and have a valid time
                    if (!task.calendar_event_id && task.time && task.taskname) {
                      console.log(`[Server] 📅 Creating calendar event for task: "${task.taskname}"`);

                      const calendarResult = await createCalendarEvent(username, task.taskname, task.time);

                      if (calendarResult.success && calendarResult.eventId) {
                        task.calendar_event_id = calendarResult.eventId;
                        hasNewTasks = true;
                        new_Task_ids.push(calendarResult.eventId);
                        console.log(`[Server] ✓ Calendar event created: ${calendarResult.eventId}`);
                      } else {
                        console.warn(`[Server] ⚠️ Failed to create calendar event: ${calendarResult.message}`);
                      }
                    }
                  }
                }
              }
            }
          }
        }

        if (hasNewTasks) {
          console.log(`[Server] 📅 Updated project with calendar event IDs`);
        }
      } else {
        console.log(`[Server] ℹ️ Calendar integration not enabled for ${username}`);
      }
      for (let id of old_task_ids) {
        if (!new_Task_ids.includes(id) && id !== null) {
          //delete calendar event
          const deleteResult = await deleteCalendarEvent(username, id);
          if (deleteResult.success) {
            console.log(`[ProjectHandler] Deleted calendar event: "${id}"`);
          } else {
            console.warn(`[ProjectHandler] Failed to delete calendar event: "${id}": ${deleteResult.message}`);
          }
        }
      }
    } catch (calendarError: any) {
      console.error(`[Server] ⚠️ Error processing calendar events (continuing with save):`, calendarError);
      // Continue with project save even if calendar integration fails
    }
  }
}
