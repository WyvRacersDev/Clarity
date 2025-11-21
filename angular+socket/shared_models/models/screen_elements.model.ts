
import dayjs from 'dayjs'; //for scheduled_task ki class 

export abstract class Screen_Element
{
    
    name:String;
    x_pos:number;  //BRUH WDYM "number", int/float better
    y_pos:number;
    x_scale:number;
    y_scale:number;

    constructor(name: string,x_pos:number,y_pos:number,x_scale:number=1,y_scale:number=1) 
  { 
    console.log("Screen_Element object created at position ",x_pos," and ",y_pos)
    this.name = name;
    this.x_pos=x_pos;
    this.y_pos=y_pos;
    this.x_scale=x_scale;
    this.y_scale=y_scale;

  }

  get_name():String
  {
    return this.name;
  }

  set_name(new_name:String)
  {
    this.name=new_name
    console.log("name changed to",new_name)
  }

  get_xpos():number
  {
    return this.x_pos
  }

  get_ypos():number
  {
    return this.y_pos
  }

  set_xpos(xpos:number)
  {
    this.x_pos=xpos
    console.log("x position modified to ",this.x_pos)
  }

  set_ypos(ypos:number)
  {
    this.y_pos=ypos
    console.log("y position modified to ",this.y_pos)
  }

  get_x_scale():number
  {
    return this.x_scale;
  }

   get_y_scale():number
  {
    return this.y_scale;
  }

  set_x_scale(scale:number)
  {
    this.x_scale=scale;
  }

  set_y_scale(scale:number)
  {
    this.y_scale=scale;
  }

   toJSON() //need to send json objects over the network
   {
    return {
      type: this.constructor.name, 
      name: this.name,
      x_pos: this.x_pos,
      y_pos: this.y_pos,
      x_scale: this.x_scale,
      y_scale:this.y_scale
    };
  }
}

export class Text_document extends Screen_Element
{
  Text_field:string;

  constructor(name: string,x_pos:number,y_pos:number,text_field:string)
  {
    super(name,x_pos,y_pos);
    this.Text_field=text_field;
    console.log("Text object created")
  }

  set_field(text:string)
  {
    this.Text_field=text
  }

  get_field():string
  {
    return this.Text_field
  }

  override toJSON() 
  {
    return {
      ...super.toJSON(),
      Text_field: this.Text_field
    };
  }

}

//TODO need to put all other screen element classes here as well

export class Image extends Screen_Element
{
  imagepath:string;
  imageFile?: Buffer;  // The actual image data
  imageDescription: string;

  constructor(image_path:string,x_pos:number,y_pos:number,image_name:string,image_desc:string)
  {
    super(image_name,x_pos,y_pos);
    this.imageDescription=image_desc;
    this.imagepath=image_path;
    //this.imageFile = fs.readFileSync(image_path);
    console.log("Image object created")
  }

  override toJSON() 
  {
    return {  
       ...super.toJSON(),
      name: this.name,
      x_pos: this.x_pos,
      y_pos: this.y_pos,
      //imagepath:this.imagepath,
      ImageDescription: this.imageDescription,
      ImageBase64: this.imageFile||null,
    };
  }
}

export class Video extends Screen_Element
{
  VideoPath:string;
  VideoFile?: string;  // The actual image data 
  VideoDescription: string;

  constructor(video_path:string,x_pos:number,y_pos:number,video_name:string,video_desc:string)
  {
    super(video_name,x_pos,y_pos);
    this.VideoDescription=video_desc;
    this.VideoPath=video_path;
    this.VideoFile=video_desc;
    //this.imageFile = fs.readFileSync(image_path);
    console.log("Video object created")
  }

  override toJSON() 
  {
    return {  
       ...super.toJSON(),
      name: this.name,
      x_pos: this.x_pos,
      y_pos: this.y_pos,
      //VideoPath:this.VideoPath,
      VideoDescription: this.VideoDescription,
      videoBase64: this.VideoFile ||null
    };
  }
}

export class scheduled_task
{
  taskname:string;
  priority:number;
  is_done:boolean;
  time:string; //will compare this with the dayjs thing on the fly

  constructor(taskname:string,priority:number,time:string)
  {
    this.taskname=taskname;
    this.priority=priority;
    this.time=time;
    this.is_done=false;
  }
  
  edit_priority(new_pr:number)
  {
    this.priority=new_pr
  }

  get_priority():number
  {
    return this.priority
  }

  set_time(time:string)
  {
    this.time=time
  }

  get_time():string
  {
    return this.time
  }

  get_status():boolean
  {
    return this.is_done
  }

  toggle_done_status()
  {
    this.is_done=!this.is_done;
  }

  toJSON() 
  {
    return {
      type: this.constructor.name,
      taskname: this.taskname,
      priority: this.priority,
      is_done: this.is_done,
      time: this.time
    };
  }

}

export class ToDoLst extends Screen_Element
{
  scheduled_tasks:scheduled_task[]=[];

  add_task(task:scheduled_task)
  {
    this.scheduled_tasks.push(task);
  }

  delete_task(task_index:number):boolean
  {
     if(task_index>=0 && task_index<this.scheduled_tasks.length)
        {
            this.scheduled_tasks.splice(task_index,1)
            return true
        }
        else
        {
            return false
        }
  }

  override toJSON() 
  {
    return {
      ...super.toJSON(),
      scheduled_tasks: this.scheduled_tasks.map(t => t.toJSON()) 
    };
  }
}

export class objects_builder 
{

  static rebuild(obj: any): Screen_Element | scheduled_task | any 
  {
    if (!obj || !obj.type) return obj;

    switch(obj.type) {
      case 'Text_document':
        return new Text_document(obj.name, obj.x_pos, obj.y_pos, obj.Text_field);

      case 'Image': 
      {
        const img = new Image(obj.imagepath, obj.x_pos, obj.y_pos, obj.name, obj.imageDescription);
        if (obj.ImageBase64) img.imageFile = Buffer.from(obj.ImageBase64, 'base64');
        return img;
      }

      case 'Video': 
      {
        const vid = new Video(obj.VideoPath, obj.x_pos, obj.y_pos, obj.name, obj.VideoDescription);
        if (obj.videoBase64) vid.VideoFile = obj.videoBase64;
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
        list.scheduled_tasks = obj.scheduled_tasks.map((t: any) =>
          objects_builder.rebuild(t)
        );
        return list;
      }

      default:
        return obj;
    }
  }
}