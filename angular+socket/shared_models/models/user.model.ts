import { Project } from "../models/project.model";
import{ Gmail } from "../models/Gmail.model"  //ye bilal kere ga lol 

import {ToDoLst,scheduled_task} from "./screen_elements.model"

import dayjs from 'dayjs'; //for calender ki class (does require doing npm install dayjs)
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
dayjs.extend(isSameOrBefore); 

export class User
{
    name:string;
    //password:string; //ye to encrypt kerna parhay ga lol
    
    projects:Project[]=[]; //projects jo user banaye ga to 
    
    //NEED TO FINISH THESE THREE
    settings:settings; // 
    contacts:contact[]=[];  //gmail se is ka kuch ho ga later on currently idk

    constructor(name:string,settings:settings)
    {
        console.log("user created")
        this.name=name;
        //this.password=password;

        //NEED TO FINISH
        this.settings = settings;
    }

    create_project(name:string, project_type: "local" | "hosted") //takes project name and adds to the list of the projects of the user
    {
        this.projects.push(new Project(name, this.name, project_type));
    }

    delete_project(prj_index:number):boolean
    {
         if(prj_index>=0 && prj_index<this.projects.length)
        {
            this.projects.splice(prj_index,1)
            return true
        }
        else
        {
            return false
        }
    }

    create_contact(contact:contact)
    {
        this.contacts.push(contact)
    }

    remove_contact(contact_index:number):boolean
    {
         if(contact_index>=0 && contact_index<this.contacts.length)
        {
            this.contacts.splice(contact_index,1)
            return true
        }
        else
        {
            return false
        }
    }

    toJSON()
    {
        return {
            type: 'User',
            name: this.name,
            settings: this.settings.toJSON(),
            contacts: this.contacts.map(c => c.toJSON()),
            // Store project references (names and types) - actual projects are stored separately
            projectReferences: this.projects.map(p => ({
                name: p.name,
                projectType: (p as any).projectType || p.project_type || 'local'
            })),
            lastModified: new Date().toISOString()
        };
    }
    
    
}

//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS
export class settings
{
    recieve_notifications:boolean;
    allow_invite:boolean;
    allow_google_calender:boolean;

    constructor()
    {
        this.recieve_notifications=true;
        this.allow_invite=true
        this.allow_google_calender=true
    }

    toggle_notif()
    {
        this.recieve_notifications=!this.recieve_notifications
    }

    toggle_invite()
    {
        this.allow_invite=!this.allow_invite
    }

    toggle_calender()
    {
        this.allow_google_calender=!this.allow_google_calender
    }

    get_notif_status():boolean
    {
        return this.recieve_notifications
    }

    get_invite_status():boolean
    {
        return this.allow_invite
    }

    get_calender_status():boolean
    {
        return this.allow_google_calender
    }
     toJSON()
    {
        return {
            type: 'settings',
            recieve_notifications: this.recieve_notifications,
            allow_invite: this.allow_invite,
            allow_google_calender: this.allow_google_calender
        };
    }
} 

export class contact
{
    contact_detail:string
    
    constructor(detail:string)
    {
        this.contact_detail =detail 
    }   

    toJSON()
    {
        return {
            type: 'contact',
            contact_detail: this.contact_detail
        };
    }
}

export class calender
{
    //scheduled tasks ki list chahiye is mei woh jub woh element banay ga tub deikhein gei 
    scheduled_tasks: scheduled_task[]=[]

    constructor(ToDoLst:ToDoLst)
    {
       ToDoLst.scheduled_tasks.forEach(element => {
        this.scheduled_tasks.push(element);
       });
    }

    get_current_date(): string
    {
        return dayjs().toString(); 
    }

    calculate_due_tasks():scheduled_task[]
    {
        const now = dayjs();
        return this.scheduled_tasks.filter(task => {
            const taskTime = dayjs(task.get_time());
            return taskTime.isSameOrBefore(now) && !task.get_status();
        });
    }

    calculate_late_tasks():scheduled_task[]
    {
         const now = dayjs();
         return this.scheduled_tasks.filter(task => 
            {
                const t = dayjs(task.get_time());
                return t.isBefore(now) && !task.get_status();
            }
        );
    }
}
//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS
/**
 * Builder class for reconstructing User objects from JSON
 */
export class user_builder
{
    /**
     * Rebuild a User object from JSON data
     */
    static rebuild(obj: any): User | settings | contact | any
    {
        if (!obj) return obj;

        // Handle settings object
        if (obj.type === 'settings' || (obj.recieve_notifications !== undefined && obj.allow_invite !== undefined)) {
            const s = new settings();
            s.recieve_notifications = obj.recieve_notifications !== undefined ? obj.recieve_notifications : true;
            s.allow_invite = obj.allow_invite !== undefined ? obj.allow_invite : true;
            s.allow_google_calender = obj.allow_google_calender !== undefined ? obj.allow_google_calender : true;
            return s;
        }
             // Handle contact object
        if (obj.type === 'contact' || (obj.contact_detail !== undefined && !obj.name)) {
            return new contact(obj.contact_detail || '');
        }

        // Handle User object
        if (obj.type === 'User' || (obj.name !== undefined && obj.settings !== undefined)) {
            const userSettings = user_builder.rebuild(obj.settings);
            const user = new User(obj.name, userSettings);
            
            // Rebuild contacts
            if (obj.contacts && Array.isArray(obj.contacts)) {
                user.contacts = obj.contacts.map((c: any) => user_builder.rebuild(c));
            }
            
            // Note: projects are stored separately, projectReferences are just metadata
            // The actual projects will be loaded separately by the DataService
            
            return user;
        }

        return obj;
    }
     /**
     * Rebuild settings from JSON
     */
    static rebuildSettings(obj: any): settings
    {
        const s = new settings();
        if (obj) {
            s.recieve_notifications = obj.recieve_notifications !== undefined ? obj.recieve_notifications : true;
            s.allow_invite = obj.allow_invite !== undefined ? obj.allow_invite : true;
            s.allow_google_calender = obj.allow_google_calender !== undefined ? obj.allow_google_calender : true;
        }
        return s;
    }

    /**
     * Rebuild contact from JSON
     */
    static rebuildContact(obj: any): contact
    {
        return new contact(obj?.contact_detail || '');
    }
}