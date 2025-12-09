//pls bilal complete
import { AI_Tools } from "../models/analytics.model"  
import { User } from "./user.model";


export class AI_agent
{
    api_key:string
    prompt?:string; //can be empty (needs to be hardcoded)
    tools: AI_Tools[]=[] 
    chat_history: string[]=[]
    
    constructor(api_key:string)
    {
        this.api_key=api_key
    }

    chat(user_input:string,user:User)
    {

    }
}
