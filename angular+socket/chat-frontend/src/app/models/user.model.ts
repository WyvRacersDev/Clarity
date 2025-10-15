import { Project } from "../models/project.model";
import{ Gmail } from "../models/Gmail.model"  //ye bilal kere ga lol 

import {ToDoLst,scheduled_task} from "./screen_elements.model"
import dayjs from 'dayjs'; //for calender ki class 
// (does require doing npm install dayjs)

export class User
{
    user_id:number;
    name:string;
    password:string; //ye to encrypt kerna parhay ga lol
    
    projects:Project[]=[]; //projects jo user banaye ga to 
    
    //NEED TO FINISH THESE THREE
    settings:settings; // 
    contacts:contact[]=[];  //gmail se is ka kuch ho ga later on currently idk

    constructor(user_id:number,name:string,password:string,settings:settings)
    {
        console.log("user created")
        this.user_id=user_id;
        this.name=name;
        this.password=password;

        //NEED TO FINISH
        this.settings = settings;
    }

    create_project(name:string) //takes project name and adds to the list of the projects of the user
    {
        this.projects.push(new Project(name));
    }
}

//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS
export class settings
{
    recieve_notifications:boolean;

    constructor()
    {
        this.recieve_notifications=true;
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
}
//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS