
import dayjs from 'dayjs'; //for scheduled_task ki class 

export abstract class Screen_Element {

  name: String;
  x_pos: number;  //BRUH WDYM "number", int/float better
  y_pos: number;
  x_scale: number;
  y_scale: number;

  constructor(name: string, x_pos: number, y_pos: number, x_scale: number = 1, y_scale: number = 1) {
    console.log("Screen_Element object created at position ", x_pos, " and ", y_pos)
    this.name = name;
    this.x_pos = x_pos;
    this.y_pos = y_pos;
    this.x_scale = x_scale;
    this.y_scale = y_scale;

  }

  get_name(): String {
    return this.name;
  }

  set_name(new_name: String) {
    this.name = new_name
    console.log("name changed to", new_name)
  }

  get_xpos(): number {
    return this.x_pos
  }

  get_ypos(): number {
    return this.y_pos
  }

  set_xpos(xpos: number) {
    this.x_pos = xpos
    console.log("x position modified to ", this.x_pos)
  }

  set_ypos(ypos: number) {
    this.y_pos = ypos
    console.log("y position modified to ", this.y_pos)
  }

  get_x_scale(): number {
    return this.x_scale;
  }

  get_y_scale(): number {
    return this.y_scale;
  }

  set_x_scale(scale: number) {
    this.x_scale = scale;
  }

  set_y_scale(scale: number) {
    this.y_scale = scale;
  }

  toJSON() //need to send json objects over the network
  {
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
  Text_field: string;

  constructor(name: string, x_pos: number, y_pos: number, text_field: string) {
    super(name, x_pos, y_pos);
    this.Text_field = text_field;
    console.log("Text object created")
  }

  set_field(text: string) {
    this.Text_field = text
  }

  get_field(): string {
    return this.Text_field
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      Text_field: this.Text_field
    };
  }

}

//TODO need to put all other screen element classes here as well

export class Image extends Screen_Element {
  imagepath: string;
  imageFile?: Buffer;  // The actual image data

  constructor(image_path: string, x_pos: number, y_pos: number, image_name: string) {
    super(image_name, x_pos, y_pos);
    this.imagepath = image_path;
    //this.imageFile = fs.readFileSync(image_path);
    console.log("Image object created")
  }

  override toJSON() {
    return {
      ...super.toJSON(), // Includes: type, name, x_pos, y_pos, x_scale, y_scale
      imagepath: this.imagepath, // Include the path (now points to local file URL)
      ImageBase64: this.imageFile || null, // Keep for backward compatibility (base64 data)
    };
  }
}

export class Video extends Screen_Element {
  VideoPath: string;
  VideoFile?: string;  // The actual image data 

  constructor(video_path: string, x_pos: number, y_pos: number, video_name: string) {
    super(video_name, x_pos, y_pos);
    this.VideoPath = video_path;
    //this.imageFile = fs.readFileSync(image_path);
    console.log("Video object created")
  }

  override toJSON() {
    return {
      ...super.toJSON(), // Includes: type, name, x_pos, y_pos, x_scale, y_scale
      VideoPath: this.VideoPath, // Include the path (now points to local file URL)
      videoBase64: this.VideoFile || null // Keep for backward compatibility (base64 data)
    };
  }
}

export class scheduled_task {
  taskname: string;
  priority: number;
  is_done: boolean;
  time: string; //will compare this with the dayjs thing on the fly
  completion_time: string | null; //time when task was completed
  creation_time: string = dayjs().toISOString(); //time when task was created
  completed_by: string | null; //username of who completed the task
  notified: boolean; //to check if notification has been sent for this task

  constructor(taskname: string, priority: number, time: string) {
    this.taskname = taskname;
    this.priority = priority;
    this.time = time;
    this.is_done = false;
    this.notified = false;
    this.completion_time = null;
    this.completed_by = null;
  }

  edit_priority(new_pr: number) {
    this.priority = new_pr
  }

  get_priority(): number {
    return this.priority
  }

  set_time(time: string) {
    this.time = time
  }

  get_time(): string {
    return this.time
  }
  get_notified(): boolean {
    return this.notified
  }

  set_notified(status: boolean) {
    this.notified = status
  }

  get_status(): boolean {
    return this.is_done
  }

  toggle_done_status() {
    this.is_done = !this.is_done;
  }
  mark_complete(completed_by_username: string) {
    this.is_done = true;
    this.completion_time = dayjs().toISOString();
    this.completed_by = completed_by_username;
  }
  mark_incomplete() {
    this.is_done = false;
    this.completion_time = null;
    this.completed_by = null;
  }

  get_completion_time() {
    return this.completion_time;
  }
  get_completed_by() {
    return this.completed_by;
  }
  get_creation_time() {
    return this.creation_time;
  }

  toJSON() {
    return {
      type: this.constructor.name,
      taskname: this.taskname,
      priority: this.priority,
      is_done: this.is_done,
      time: this.time,
      completion_time: this.completion_time,
      completed_by: this.completed_by,
      creation_time: this.creation_time
    };
  }

}

export class ToDoLst extends Screen_Element {
  scheduled_tasks: scheduled_task[] = [];
  collaborators: string[] = []; // list of usernames who can collaborate on this todo list
  tags: string[] = []; //tags for the todo list
  add_task(task: scheduled_task) {
    this.scheduled_tasks.push(task);
  }

  delete_task(task_index: number): boolean {
    if (task_index >= 0 && task_index < this.scheduled_tasks.length) {
      this.scheduled_tasks.splice(task_index, 1)
      return true
    }
    else {
      return false
    }
  }
  /**
   * Add a collaborator to the todo list
   */
  add_collaborator(username: string): boolean {
    if (!this.collaborators.includes(username)) {
      this.collaborators.push(username);
      return true;
    }
    return false;
  }

  /**
   * Remove a collaborator from the todo list
   */ remove_collaborator(username: string): boolean {
    const index = this.collaborators.indexOf(username);
    if (index !== -1) {
      this.collaborators.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if a user is a collaborator
   */
  is_collaborator(username: string): boolean {
    return this.collaborators.includes(username);
  }
  /**
   * Get all collaborators
   */
  get_collaborators(): string[] {
    return [...this.collaborators];
  }
  add_tag(tag: string): boolean {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      return true;
    }
    return false;
  }

  remove_tag(tag: string): boolean {
    const index = this.tags.indexOf(tag);
    if (index !== -1) {
      this.tags.splice(index, 1);
      return true;
    }
    return false;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      scheduled_tasks: this.scheduled_tasks.map(t => t.toJSON()),
      collaborators: this.collaborators,
      tags: this.tags
    };
  }
}

export class objects_builder {

  static rebuild(obj: any): Screen_Element | scheduled_task | any {
    if (!obj) return obj;

    // Fallback: Detect elements by their fields if type is missing or wrong
    // Check for ToDoLst first (by scheduled_tasks array)
    if (obj.scheduled_tasks !== undefined && Array.isArray(obj.scheduled_tasks)) {
      // This is a ToDoLst
      const list = new ToDoLst(obj.name, obj.x_pos, obj.y_pos);
      // Restore scale values if present
      if (obj.x_scale !== undefined) list.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) list.y_scale = obj.y_scale;
      list.scheduled_tasks = obj.scheduled_tasks.map((t: any) => objects_builder.rebuild(t));
      // Restore collaborators if present
      if (obj.collaborators !== undefined && Array.isArray(obj.collaborators)) {
        list.collaborators = obj.collaborators;
      }
      // ⭐ Restore tags
      if (obj.tags !== undefined && Array.isArray(obj.tags)) {
        list.tags = obj.tags;
      }
      return list;
    }

    // Check for Text_document (by Text_field)
    if (obj.Text_field !== undefined || obj.text_field !== undefined) {
      // This is a Text_document
      const textField = obj.Text_field || obj.text_field || '';
      const textDoc = new Text_document(obj.name, obj.x_pos, obj.y_pos, textField);
      // Restore scale values if present
      if (obj.x_scale !== undefined) textDoc.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) textDoc.y_scale = obj.y_scale;
      return textDoc;
    }

    // Check for Image (by imagepath, imagePath, or ImageBase64)
    if (obj.imagepath !== undefined || obj.imagePath !== undefined || obj.ImageBase64 !== undefined) {
      // This is an Image
      const imagePath = obj.imagepath || obj.imagePath || (obj.ImageBase64 ? `data:image/png;base64,${obj.ImageBase64}` : '');
      const img = new Image(imagePath, obj.x_pos, obj.y_pos, obj.name);
      // Restore scale values if present
      if (obj.x_scale !== undefined) img.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) img.y_scale = obj.y_scale;
      if (obj.ImageBase64) img.imageFile = Buffer.from(obj.ImageBase64, 'base64');
      return img;
    }

    // Check for Video (by VideoPath, videoPath, or videoBase64)
    if (obj.VideoPath !== undefined || obj.videoPath !== undefined || obj.videoBase64 !== undefined) {
      // This is a Video
      const videoPath = obj.VideoPath || obj.videoPath || (obj.videoBase64 ? `data:video/mp4;base64,${obj.videoBase64}` : '');
      const vid = new Video(videoPath, obj.x_pos, obj.y_pos, obj.name);
      // Restore scale values if present
      if (obj.x_scale !== undefined) vid.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) vid.y_scale = obj.y_scale;
      if (obj.videoBase64) vid.VideoFile = obj.videoBase64;
      return vid;
    }

    if (!obj.type) return obj;

    switch (obj.type) {
      case 'Text_document':
        const textDoc = new Text_document(obj.name, obj.x_pos, obj.y_pos, obj.Text_field || obj.text_field || '');
        // Restore scale values if present
        if (obj.x_scale !== undefined) textDoc.x_scale = obj.x_scale;
        if (obj.y_scale !== undefined) textDoc.y_scale = obj.y_scale;
        return textDoc;

      case 'Image':
        {
          // Handle both new file path system and old base64 system
          // Support both imagepath (new) and imagePath (alternative)
          const imagePath = obj.imagepath || obj.imagePath || (obj.ImageBase64 ? `data:image/png;base64,${obj.ImageBase64}` : '');
          const img = new Image(imagePath, obj.x_pos, obj.y_pos, obj.name);
          // Restore scale values if present
          if (obj.x_scale !== undefined) img.x_scale = obj.x_scale;
          if (obj.y_scale !== undefined) img.y_scale = obj.y_scale;
          // Keep base64 for backward compatibility if present
          if (obj.ImageBase64) img.imageFile = Buffer.from(obj.ImageBase64, 'base64');
          return img;
        }

      case 'Video':
        {
          // Handle both new file path system and old base64 system
          // Support both VideoPath (from toJSON) and videoPath (alternative)
          const videoPath = obj.VideoPath || obj.videoPath || (obj.videoBase64 ? `data:video/mp4;base64,${obj.videoBase64}` : '');
          const vid = new Video(videoPath, obj.x_pos, obj.y_pos, obj.name);
          // Restore scale values if present
          if (obj.x_scale !== undefined) vid.x_scale = obj.x_scale;
          if (obj.y_scale !== undefined) vid.y_scale = obj.y_scale;
          // Keep base64 for backward compatibility if present
          if (obj.videoBase64) vid.VideoFile = obj.videoBase64;
          return vid;
        }

      case 'scheduled_task': //not really an element but needs to be rebuilt too lol
        {
          // Handle priority as both string and number (JSON might serialize numbers as strings)
          const priority = typeof obj.priority === 'string' ? parseInt(obj.priority, 10) : (obj.priority || 2);
          const t = new scheduled_task(obj.taskname, priority, obj.time || '');
          t.is_done = obj.is_done !== undefined ? obj.is_done : false;
          // Restore completion info if present
          if (obj.completion_time !== undefined) t.completion_time = obj.completion_time;
          if (obj.completed_by !== undefined) t.completed_by = obj.completed_by;
          if (obj.notified !== undefined) t.notified = obj.notified;
          return t;
        }

      case 'ToDoLst':
        {
          const list = new ToDoLst(obj.name, obj.x_pos, obj.y_pos);
          // Restore scale values if present
          if (obj.x_scale !== undefined) list.x_scale = obj.x_scale;
          if (obj.y_scale !== undefined) list.y_scale = obj.y_scale;
          list.scheduled_tasks = obj.scheduled_tasks.map((t: any) =>
            objects_builder.rebuild(t)
          );
          // ⭐ Restore tags
          if (obj.tags !== undefined && Array.isArray(obj.tags)) {
            list.tags = obj.tags;
          }
          return list;
        }

      default:
        return obj;
    }
  }
}