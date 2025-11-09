
import dayjs from 'dayjs'; //for scheduled_task ki class 

export abstract class Screen_Element
{
    
    name:String;
    x_pos:number;  //BRUH WDYM "number", int/float better
    y_pos:number;

    constructor(name: string,x_pos:number,y_pos:number) 
  { 
    console.log("Screen_Element object created")
    this.name = name;
    this.x_pos=x_pos;
    this.y_pos=y_pos;
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
  }

  set_ypos(ypos:number)
  {
    this.y_pos=ypos
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

  toJSON() 
  {
    return {  //ye agli line per nahi ja rha :sob:
      name: this.name,
      x_pos: this.x_pos,
      y_pos: this.y_pos,
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

  toJSON() 
  {
    return {  //ye agli line per nahi ja rha :sob:
      name: this.name,
      x_pos: this.x_pos,
      y_pos: this.y_pos,
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
}