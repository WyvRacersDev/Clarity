import { Component,OnInit  } from '@angular/core';
import { CommonModule } from '@angular/common';
//import { ChatComponent } from './chat(depreciated)/chat.component';

//humari apni classes ki importing
import { User,settings,calender } from "../../../shared_models/models/user.model"
import { Project,Grid } from '../../../shared_models/models/project.model';
import { Screen_Element,Text_document,Image,Video,ToDoLst,scheduled_task} from '../../../shared_models/models/screen_elements.model';


//networking 
import { io } from "socket.io-client";
const socket = io("http://localhost:3000"); //SOCKET 

export function sendElement(element: Screen_Element) 
{
  socket.emit("screenElement", element.toJSON()); //test
}

export function onElementReceived(callback: (data: any) => void) 
{   
  socket.on("ack", (data) => {
    callback(data); // e.g., {status:"received", name:"todo1"}  //ye cn ka kam hiq ker rha hoon mei :sad:
  });
}



@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})

//basically this is humari main app ki class
export class AppComponent implements OnInit //this is the class that is sent to bootstrap by main.ts 
{

  all_elements:Screen_Element[]=[]
  test_index:number=0
  images:Image[]=[];
  videos:Video[]=[];
  //constructor()
  ngOnInit() 
  {
    // //testing classes ke objects banana
    // new User(5,"test_user_name","unencrypted_test_password",new settings());  //user creation
    // new Project ("test_project_name") //project creation test
    // new Grid("test_Grid") //grid creation test
    this.all_elements.push(new Text_document("document_name",0,0,"test_the_text")) //screen element <- text document
    //                  name         ,x_pos,y_pos, text_field
    this.images = 
    [
      new Image('test_content/test_image.png', 0,0 , 'Test Image 1', 'miata is always the answer'),
      new Image('test_content/test_image2.png', 0,0 , 'Test Image 2', 'yummy'),
    ];

    this.all_elements.push(this.images[0])
    this.all_elements.push(this.images[1])

    this.videos=
    [
      new Video('test_content/test_video.mp4', 0,0 , 'Test Video 1', 'mclaren f1'),
      new Video('test_content/test_video2.mp4', 0,0 , 'Test Video 2', 'vice city vibe')
    ]
    
    this.all_elements.push(this.videos[0])
    this.all_elements.push(this.videos[1])
    // console.log(new calender(new ToDoLst("to_do_list",0,0)).get_current_date()) //testing using calender class + to do list ka screen element
  }
  
//just a test function
sendtest()  //class mei i dont have to declare its a function but outside i do (what even) 
{
  if(this.test_index<this.all_elements.length)
  {
    sendElement(this.all_elements[this.test_index]);
    console.log('Button clicked');
    this.test_index+=1 //just a test
  }
}
}

