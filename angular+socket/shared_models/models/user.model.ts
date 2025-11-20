import { Project } from "../models/project.model";
import{ Gmail } from "../models/Gmail.model"  //ye bilal kere ga lol 

import {ToDoLst,scheduled_task} from "./screen_elements.model"

import dayjs from 'dayjs'; //for calender ki class (does require doing npm install dayjs)
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
dayjs.extend(isSameOrBefore); 

export class User
{
    user_id:number;
    name:string;
    //password:string; //ye to encrypt kerna parhay ga lol
    
    projects:Project[]=[]; //projects jo user banaye ga to 
    
    //NEED TO FINISH THESE THREE
    settings:settings; // 
    contacts:contact[]=[];  //gmail se is ka kuch ho ga later on currently idk

    constructor(user_id:number,name:string,settings:settings)
    {
        console.log("user created")
        this.user_id=user_id;
        this.name=name;
        //this.password=password;

        //NEED TO FINISH
        this.settings = settings;
    }

    create_project(name:string) //takes project name and adds to the list of the projects of the user
    {
        this.projects.push(new Project(name));
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

} 

class contact
{
    contact_detail:string
    
    constructor(detail:string)
    {
        this.contact_detail =detail 
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