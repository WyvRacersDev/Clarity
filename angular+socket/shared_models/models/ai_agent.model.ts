//pls bilal complete

import { User } from "./user.model";


export class AI_agent
{
    api_key:string
    prompt?:string; //can be empty (needs to be hardcoded)
    chat_history: string[]=[]
    
    constructor(api_key:string)
    {
        this.api_key=api_key
    }

    chat(user_input:string,user:User)
    {

    }
}
