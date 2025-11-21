export class AI_Tools {
    constructor() {
        this.tool_prompt = "";
        this.parameter_scheme = "";
    }
    call_tool(prompt) {
    }
}
export class Scheduling_Ideas extends AI_Tools {
    constructor() {
        super(...arguments);
        this.current_events = [];
    }
}
export class Generating_reminder extends AI_Tools {
}
export class Task_Analysis extends AI_Tools {
}
export class Task_Bottleneck_identifier extends AI_Tools {
}
export class gmail_tool extends AI_Tools {
}
export class calendar_tool extends AI_Tools {
}
