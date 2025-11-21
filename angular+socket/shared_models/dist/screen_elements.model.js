export class Screen_Element {
    constructor(name, x_pos, y_pos, x_scale = 1, y_scale = 1) {
        console.log("Screen_Element object created at position ", x_pos, " and ", y_pos);
        this.name = name;
        this.x_pos = x_pos;
        this.y_pos = y_pos;
        this.x_scale = x_scale;
        this.y_scale = y_scale;
    }
    get_name() {
        return this.name;
    }
    set_name(new_name) {
        this.name = new_name;
        console.log("name changed to", new_name);
    }
    get_xpos() {
        return this.x_pos;
    }
    get_ypos() {
        return this.y_pos;
    }
    set_xpos(xpos) {
        this.x_pos = xpos;
        console.log("x position modified to ", this.x_pos);
    }
    set_ypos(ypos) {
        this.y_pos = ypos;
        console.log("y position modified to ", this.y_pos);
    }
    get_x_scale() {
        return this.x_scale;
    }
    get_y_scale() {
        return this.y_scale;
    }
    set_x_scale(scale) {
        this.x_scale = scale;
    }
    set_y_scale(scale) {
        this.y_scale = scale;
    }
    toJSON() {
        return {
            type: this.constructor.name,
            name: this.name,
            x_pos: this.x_pos,
            y_pos: this.y_pos,
            x_scale: this.x_scale,
            y_scale: this.y_scale
        };
    }
}
export class Text_document extends Screen_Element {
    constructor(name, x_pos, y_pos, text_field) {
        super(name, x_pos, y_pos);
        this.Text_field = text_field;
        console.log("Text object created");
    }
    set_field(text) {
        this.Text_field = text;
    }
    get_field() {
        return this.Text_field;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            Text_field: this.Text_field
        };
    }
}
//TODO need to put all other screen element classes here as well
export class Image extends Screen_Element {
    constructor(image_path, x_pos, y_pos, image_name, image_desc) {
        super(image_name, x_pos, y_pos);
        this.imageDescription = image_desc;
        this.imagepath = image_path;
        //this.imageFile = fs.readFileSync(image_path);
        console.log("Image object created");
    }
    toJSON() {
        return {
            ...super.toJSON(),
            name: this.name,
            x_pos: this.x_pos,
            y_pos: this.y_pos,
            //imagepath:this.imagepath,
            ImageDescription: this.imageDescription,
            ImageBase64: this.imageFile || null,
        };
    }
}
export class Video extends Screen_Element {
    constructor(video_path, x_pos, y_pos, video_name, video_desc) {
        super(video_name, x_pos, y_pos);
        this.VideoDescription = video_desc;
        this.VideoPath = video_path;
        this.VideoFile = video_desc;
        //this.imageFile = fs.readFileSync(image_path);
        console.log("Video object created");
    }
    toJSON() {
        return {
            ...super.toJSON(),
            name: this.name,
            x_pos: this.x_pos,
            y_pos: this.y_pos,
            //VideoPath:this.VideoPath,
            VideoDescription: this.VideoDescription,
            videoBase64: this.VideoFile || null
        };
    }
}
export class scheduled_task {
    constructor(taskname, priority, time) {
        this.taskname = taskname;
        this.priority = priority;
        this.time = time;
        this.is_done = false;
    }
    edit_priority(new_pr) {
        this.priority = new_pr;
    }
    get_priority() {
        return this.priority;
    }
    set_time(time) {
        this.time = time;
    }
    get_time() {
        return this.time;
    }
    get_status() {
        return this.is_done;
    }
    toggle_done_status() {
        this.is_done = !this.is_done;
    }
    toJSON() {
        return {
            type: this.constructor.name,
            taskname: this.taskname,
            priority: this.priority,
            is_done: this.is_done,
            time: this.time
        };
    }
}
export class ToDoLst extends Screen_Element {
    constructor() {
        super(...arguments);
        this.scheduled_tasks = [];
    }
    add_task(task) {
        this.scheduled_tasks.push(task);
    }
    delete_task(task_index) {
        if (task_index >= 0 && task_index < this.scheduled_tasks.length) {
            this.scheduled_tasks.splice(task_index, 1);
            return true;
        }
        else {
            return false;
        }
    }
    toJSON() {
        return {
            ...super.toJSON(),
            scheduled_tasks: this.scheduled_tasks.map(t => t.toJSON())
        };
    }
}
export class objects_builder {
    static rebuild(obj) {
        if (!obj || !obj.type)
            return obj;
        switch (obj.type) {
            case 'Text_document':
                return new Text_document(obj.name, obj.x_pos, obj.y_pos, obj.Text_field);
            case 'Image':
                {
                    const img = new Image(obj.imagepath, obj.x_pos, obj.y_pos, obj.name, obj.imageDescription);
                    if (obj.ImageBase64)
                        img.imageFile = Buffer.from(obj.ImageBase64, 'base64');
                    return img;
                }
            case 'Video':
                {
                    const vid = new Video(obj.VideoPath, obj.x_pos, obj.y_pos, obj.name, obj.VideoDescription);
                    if (obj.videoBase64)
                        vid.VideoFile = obj.videoBase64;
                    return vid;
                }
            case 'scheduled_task': //not really an element but needs to be rebuilt too lol
                {
                    const t = new scheduled_task(obj.taskname, obj.priority, obj.time);
                    t.is_done = obj.is_done;
                    return t;
                }
            case 'ToDoLst':
                {
                    const list = new ToDoLst(obj.name, obj.x_pos, obj.y_pos);
                    list.scheduled_tasks = obj.scheduled_tasks.map((t) => objects_builder.rebuild(t));
                    return list;
                }
            default:
                return obj;
        }
    }
}
