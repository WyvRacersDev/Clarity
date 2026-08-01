import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { User, settings } from '../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../shared_models/models/project.model';
import { Screen_Element, objects_builder } from '../../../../shared_models/models/screen-elements.model';
import { getServerConfig } from '../config/server.config';

/**
 * R13: the (de)serialization / type-sniffing surface split out of the former
 * `DataService` god-service. Pure translation between wire payloads and the
 * shared domain models — no state, no I/O (aside from the platform-guarded
 * localhost URL rewrite). Long-term this ideally moves onto the models (R11).
 */
@Injectable({ providedIn: 'root' })
export class ProjectSerializer {
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  reconstructUser(userData: any): User {
    const userSettings = new settings();
    if (userData.settings) {
      userSettings.recieve_notifications = userData.settings.recieve_notifications !== undefined
        ? userData.settings.recieve_notifications : true;
      userSettings.allow_invite = userData.settings.allow_invite !== undefined
        ? userData.settings.allow_invite : true;
      userSettings.allow_google_calender = userData.settings.allow_google_calender !== undefined
        ? userData.settings.allow_google_calender : true;
    }

    const user = new User(userData.name, userSettings);

    if (userData.projects && Array.isArray(userData.projects)) {
      user.projects = userData.projects;
    }

    if (userData.contacts && Array.isArray(userData.contacts)) {
      user.contacts = userData.contacts;
    }

    return user;
  }

  serializeProjectForSaving(project: Project): any {
    return {
      owner_name: project.owner_name,
      name: project.name,
      project_type: (project as any).projectType || project.project_type || 'local',
      grid: project.grid.map((grid: Grid) => ({
        name: grid.name,
        Screen_elements: grid.Screen_elements.map((element: Screen_Element) => {
          const elem = element as any;
          console.log(`[ProjectSerializer] Serializing element:`, {
            name: elem.name,
            type: elem.type || elem.constructor?.name,
            hasToJSON: typeof elem.toJSON === 'function',
            imagepath: elem.imagepath,
            VideoPath: elem.VideoPath,
            allKeys: Object.keys(elem)
          });

          if (element && typeof elem.toJSON === 'function') {
            const serialized = elem.toJSON();
            console.log(`[ProjectSerializer] Serialized element via toJSON():`, serialized);
            return serialized;
          }

          // Single canonical detector (shared model) — replaces the
          // duplicated, minification-fragile constructor.name ladder.
          const elementType = objects_builder.typeOf(elem);

          const serialized: any = {
            type: elementType,
            name: element.name,
            x_pos: element.x_pos,
            y_pos: element.y_pos,
            x_scale: element.x_scale,
            y_scale: element.y_scale
          };

          if (elem.Text_field !== undefined || elem.text_field !== undefined) {
            serialized.Text_field = elem.Text_field || elem.text_field;
          }
          if (elem.imagepath !== undefined || elem.imagePath !== undefined) {
            serialized.imagepath = elem.imagepath || elem.imagePath;
            console.log(`[ProjectSerializer] Found imagepath: ${serialized.imagepath}`);
          }
          if (elem.VideoPath !== undefined || elem.videoPath !== undefined) {
            serialized.VideoPath = elem.VideoPath || elem.videoPath;
            console.log(`[ProjectSerializer] Found VideoPath: ${serialized.VideoPath}`);
          }
          if (elem.scheduled_tasks !== undefined) {
            serialized.scheduled_tasks = elem.scheduled_tasks.map((t: any) =>
              (t && typeof t.toJSON === 'function') ? t.toJSON() : t
            );
          }

          console.log(`[ProjectSerializer] Serialized element manually:`, serialized);
          return serialized;
        })
      }))
    };
  }

  private convertLocalhostUrls(element: Screen_Element): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const serverUrl = getServerConfig();
    const elem = element as any;

    if (elem.imagepath && typeof elem.imagepath === 'string') {
      if (elem.imagepath.startsWith('http://localhost:') || elem.imagepath.startsWith('https://localhost:')) {
        const pathMatch = elem.imagepath.match(/\/projects\/(.+)$/);
        if (pathMatch) {
          elem.imagepath = `${serverUrl}/projects/${pathMatch[1]}`;
          console.log(`[ProjectSerializer] Converted image URL from localhost to: ${elem.imagepath}`);
        }
      }
    }

    if (elem.VideoPath && typeof elem.VideoPath === 'string') {
      if (elem.VideoPath.startsWith('http://localhost:') || elem.VideoPath.startsWith('https://localhost:')) {
        const pathMatch = elem.VideoPath.match(/\/projects\/(.+)$/);
        if (pathMatch) {
          elem.VideoPath = `${serverUrl}/projects/${pathMatch[1]}`;
          console.log(`[ProjectSerializer] Converted video URL from localhost to: ${elem.VideoPath}`);
        }
      }
    }
  }

  deserializeProject(data: any): Project {
    console.log(`[ProjectSerializer] deserializeProject called with data.name="${data.name}", data.projectType="${data.projectType}"`);
    const project = new Project(data.name, data.owner_name, data.projectType);
    console.log(`[ProjectSerializer] Created project with name="${project.name}"`);
    (project as any).isLocal = data.projectType !== 'hosted';

    if (data.grid && Array.isArray(data.grid)) {
      data.grid.forEach((gridData: any) => {
        const grid = new Grid(gridData.name);
        if (gridData.Screen_elements && Array.isArray(gridData.Screen_elements)) {
          gridData.Screen_elements.forEach((elementData: any) => {
            const element = objects_builder.rebuild(elementData);
            if (element) {
              this.convertLocalhostUrls(element);
              grid.add_element(element as any);
            }
          });
        }
        project.grid.push(grid);
      });
    }

    return project;
  }

  serializeUserForSaving(user: User): any {
    if (user.toJSON && typeof user.toJSON === 'function') {
      return user.toJSON();
    }

    return {
      type: 'User',
      name: user.name,
      settings: this.serializeSettings(user.settings),
      contacts: user.contacts.map((c: any) => ({
        type: 'contact',
        name: c.name,
        contact_detail: c.contact_detail
      })),
      projectReferences: user.projects.map(p => ({
        name: p.name,
        projectType: (p as any).projectType || p.project_type || 'local'
      }))
    };
  }

  private serializeSettings(s: settings): any {
    if (s.toJSON && typeof s.toJSON === 'function') {
      return s.toJSON();
    }
    return {
      type: 'settings',
      recieve_notifications: s.recieve_notifications,
      allow_invite: s.allow_invite,
      allow_google_calender: s.allow_google_calender
    };
  }

  deserializeUser(data: any): User {
    const userSettings = new settings();
    if (data.settings) {
      userSettings.recieve_notifications = data.settings.recieve_notifications !== undefined ? data.settings.recieve_notifications : true;
      userSettings.allow_invite = data.settings.allow_invite !== undefined ? data.settings.allow_invite : true;
      userSettings.allow_google_calender = data.settings.allow_google_calender !== undefined ? data.settings.allow_google_calender : true;
    }

    const user = new User(data.name, userSettings);

    return user;
  }
}
