//pls bilal complete

import { User } from "./user.model.js";


export class AI_agent
{
    api_key:string
    prompt?:string; //can be empty (needs to be hardcoded)
    chat_history: string[]=[]
    
    constructor(api_key:string)
    {
        this.api_key=api_key
    }

    // Signature intentionally permissive so subclasses (e.g. backend Chat_Agent)
    // may override with a narrower context arg (username: string) and an async
    // string return without violating base-type assignability.
    chat(user_input:string, user:User | string): void | Promise<string>
    {

    }
}
