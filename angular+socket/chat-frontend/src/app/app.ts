import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
//import { ChatComponent } from './chat(depreciated)/chat.component';

//humari apni classes ki importing
import { User,settings,calender } from "./models/user.model"
import { Project,Grid } from './models/project.model';
import { Screen_Element,Text_document,Image,Video,ToDoLst} from './models/screen_elements.model';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})

//basically this is humari main app ki class
export class AppComponent  //this is the class that is sent to bootstrap by main.ts 
{
  images:Image[];
  videos:Video[];
  constructor()
  {
    //testing classes ke objects banana
    new User(5,"test_user_name","unencrypted_test_password",new settings());  //user creation
    new Project ("test_project_name") //project creation test
    new Grid("test_Grid") //grid creation test
    new Text_document("document_name",0,0,"test_the_text") //screen element <- text document
    //                  name         ,x_pos,y_pos, text_field
    this.images = 
    [
      new Image('test_content/test_image.png', 0,0 , 'Test Image 1', 'miata is always the answer'),
      new Image('test_content/test_image2.png', 0,0 , 'Test Image 2', 'yummy'),
    ];

    this.videos=
    [
      new Video('test_content/test_video.mp4', 0,0 , 'Test Video 1', 'mclaren f1'),
      new Video('test_content/test_video2.mp4', 0,0 , 'Test Video 2', 'vice city vibe')
    ]
    
    console.log(new calender(new ToDoLst("to_do_list",0,0)).get_current_date()) //testing using calender class + to do list ka screen element
  }

}

