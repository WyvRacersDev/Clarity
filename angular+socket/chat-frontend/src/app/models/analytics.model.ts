//pls bilal complete
import {calender} from "../models/user.model"
import {Gmail} from "../models/Gmail.model"
import {scheduled_task} from "../models/screen_elements.model"

export abstract class AI_Tools
{
    tool_prompt:string = ""
    parameter_scheme:string= ""

    call_tool(prompt:string)
    {

    }
}

export class Scheduling_Ideas extends AI_Tools
{
    current_events:scheduled_task[]=[]


}

export class Generating_reminder extends AI_Tools
{

}

export class Task_Analysis extends AI_Tools
{

}

export class Task_Bottleneck_identifier extends AI_Tools
{

}

export class gmail_tool extends AI_Tools
{

}

export class calendar_tool extends AI_Tools
{
    
}